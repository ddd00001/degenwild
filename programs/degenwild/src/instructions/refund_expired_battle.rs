use anchor_lang::prelude::*;

use crate::{
    constants::{BATTLE_SEED, REFUND_TIMEOUT_SLOTS},
    error::ErrorCode,
    events::BattleRefunded,
    state::{Battle, BattleStatus},
};

#[derive(Accounts)]
pub struct RefundExpiredBattle<'info> {
    /// Closed after both stakes are returned; rent goes back to the creator.
    #[account(
        mut,
        close = creator,
        seeds = [
            BATTLE_SEED,
            battle.creator.as_ref(),
            &battle.battle_id.to_le_bytes()
        ],
        bump = battle.bump
    )]
    pub battle: Account<'info, Battle>,

    #[account(mut, address = battle.creator)]
    pub creator: SystemAccount<'info>,

    #[account(
        mut,
        constraint = battle.opponent == Some(opponent.key())
    )]
    pub opponent: SystemAccount<'info>,

    #[account(address = battle.randomness_account)]
    pub randomness_request: Account<'info, orao_solana_vrf::state::RandomnessV2>,
}

pub fn handle_refund_expired_battle(ctx: Context<RefundExpiredBattle>) -> Result<()> {
    let battle = &ctx.accounts.battle;

    require!(
        battle.status == BattleStatus::RandomnessPending,
        ErrorCode::BattleNotReady
    );

    // Once ORAO has fulfilled, the battle must be settled, never refunded.
    require!(
        ctx.accounts.randomness_request.fulfilled().is_none(),
        ErrorCode::RandomnessAlreadyFulfilled
    );

    let deadline = battle
        .joined_slot
        .checked_add(REFUND_TIMEOUT_SLOTS)
        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
    require!(Clock::get()?.slot >= deadline, ErrorCode::RefundTooEarly);

    let amount = battle.amount;
    let total = amount
        .checked_mul(2)
        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;

    let battle_info = ctx.accounts.battle.to_account_info();
    let rent_reserve = Rent::get()?.minimum_balance(battle_info.data_len());
    let available = battle_info
        .lamports()
        .checked_sub(rent_reserve)
        .ok_or(error!(ErrorCode::InsufficientEscrow))?;
    require!(available >= total, ErrorCode::InsufficientEscrow);

    let remaining = battle_info
        .lamports()
        .checked_sub(total)
        .ok_or(error!(ErrorCode::InsufficientEscrow))?;
    **battle_info.try_borrow_mut_lamports()? = remaining;

    let creator_info = ctx.accounts.creator.to_account_info();
    let creator_balance = creator_info
        .lamports()
        .checked_add(amount)
        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
    **creator_info.try_borrow_mut_lamports()? = creator_balance;

    let opponent_info = ctx.accounts.opponent.to_account_info();
    let opponent_balance = opponent_info
        .lamports()
        .checked_add(amount)
        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
    **opponent_info.try_borrow_mut_lamports()? = opponent_balance;

    ctx.accounts.battle.status = BattleStatus::Refunded;

    emit!(BattleRefunded {
        battle: ctx.accounts.battle.key(),
        battle_id: ctx.accounts.battle.battle_id,
        creator: ctx.accounts.battle.creator,
        opponent: ctx.accounts.opponent.key(),
        amount,
    });

    Ok(())
}
