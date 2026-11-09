use anchor_lang::prelude::*;

use crate::{
    constants::{BATTLE_SEED, COINFLIP_FEE_BPS, PLATFORM_CONFIG_SEED},
    error::ErrorCode,
    fee::calculate_coinflip_fee,
    state::{Battle, BattleStatus, PlatformConfig},
};

const ORAO_RANDOMNESS_SEED: &[u8] = b"orao-vrf-randomness-request";

#[derive(Accounts)]
pub struct SettleBattle<'info> {
    #[account(
        mut,
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

    #[account(
        seeds = [ORAO_RANDOMNESS_SEED, &battle.randomness_seed],
        bump,
        seeds::program = orao_solana_vrf::ID,
        address = battle.randomness_account
    )]
    pub randomness_request: Account<'info, orao_solana_vrf::state::RandomnessV2>,

    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = platform_config.bump
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    #[account(mut, address = platform_config.treasury)]
    pub treasury: SystemAccount<'info>,
}

pub fn handle_settle_battle(ctx: Context<SettleBattle>) -> Result<()> {
    let battle = &ctx.accounts.battle;

    require!(
        battle.status == BattleStatus::RandomnessPending,
        ErrorCode::BattleNotReady
    );

    require!(
        ctx.accounts.platform_config.coinflip_fee_bps as u64 == COINFLIP_FEE_BPS,
        ErrorCode::InvalidPlatformFee
    );

    // Verify that the ORAO request belongs to this opponent and battle.
    let request = &ctx.accounts.randomness_request;

    require!(
        request.client() == &ctx.accounts.opponent.key()
            && request.seed() == &battle.randomness_seed,
        ErrorCode::RandomnessRequestMismatch
    );

    // Only fulfilled, ORAO-owned randomness can determine the winner.
    let fulfilled = request
        .fulfilled()
        .ok_or(error!(ErrorCode::RandomnessNotFulfilled))?;

    let randomness = fulfilled.randomness;

    // Fixed mapping: 0 = creator, 1 = opponent.
    let winner_is_opponent = randomness[0] & 1 == 1;

    let winner_info = if winner_is_opponent {
        ctx.accounts.opponent.to_account_info()
    } else {
        ctx.accounts.creator.to_account_info()
    };

    // Calculate the pot and fee with checked integer arithmetic.
    let pot = battle
        .amount
        .checked_mul(2)
        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;

    let (platform_fee, winner_payout) =
        calculate_coinflip_fee(pot).ok_or(error!(ErrorCode::ArithmeticOverflow))?;

    let battle_info = ctx.accounts.battle.to_account_info();
    let rent_reserve = Rent::get()?.minimum_balance(battle_info.data_len());

    let available_escrow = battle_info
        .lamports()
        .checked_sub(rent_reserve)
        .ok_or(error!(ErrorCode::InsufficientEscrow))?;

    require!(available_escrow >= pot, ErrorCode::InsufficientEscrow);

    // Debit the battle escrow while preserving its rent reserve.
    let remaining = battle_info
        .lamports()
        .checked_sub(pot)
        .ok_or(error!(ErrorCode::InsufficientEscrow))?;

    **battle_info.try_borrow_mut_lamports()? = remaining;

    // Credit the winner.
    let winner_balance = winner_info
        .lamports()
        .checked_add(winner_payout)
        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;

    **winner_info.try_borrow_mut_lamports()? = winner_balance;

    // Credit the platform treasury.
    let treasury_info = ctx.accounts.treasury.to_account_info();
    let treasury_balance = treasury_info
        .lamports()
        .checked_add(platform_fee)
        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;

    **treasury_info.try_borrow_mut_lamports()? = treasury_balance;

    // Store the verified outcome.
    let battle = &mut ctx.accounts.battle;
    battle.winner = Some(if winner_is_opponent {
        ctx.accounts.opponent.key()
    } else {
        ctx.accounts.creator.key()
    });
    battle.status = BattleStatus::Settled;

    Ok(())
}
