use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Battle, BattleStatus},
};

#[derive(Accounts)]
#[instruction(battle_id: u64)]
pub struct CreateBattle<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Battle::INIT_SPACE,
        seeds = [BATTLE_SEED, creator.key().as_ref(), &battle_id.to_le_bytes()],
        bump
    )]
    pub battle: Account<'info, Battle>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_battle(ctx: Context<CreateBattle>, battle_id: u64, amount: u64, creator_side: u8) -> Result<()> {
    require!(amount >= MIN_STAKE_LAMPORTS, ErrorCode::StakeTooLow);
    require!(
        amount <= crate::constants::MAX_STAKE_LAMPORTS,
        ErrorCode::StakeTooHigh
    );

    ctx.accounts.battle.creator = ctx.accounts.creator.key();
    ctx.accounts.battle.opponent = None;
    ctx.accounts.battle.amount = amount;
    ctx.accounts.battle.battle_id = battle_id;
    ctx.accounts.battle.status = BattleStatus::Open;
    ctx.accounts.battle.creator_side = creator_side;
    ctx.accounts.battle.joined_slot = 0;
    require!(creator_side <= 1, ErrorCode::InvalidSide);
    ctx.accounts.battle.randomness_seed = [0; 32];
    ctx.accounts.battle.randomness_account = Pubkey::default();
    ctx.accounts.battle.winner = None;
    ctx.accounts.battle.bump = ctx.bumps.battle;

    // Move the creator's stake into the battle account (escrow).
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.creator.to_account_info(),
        to: ctx.accounts.battle.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(anchor_lang::system_program::ID, cpi_accounts);
    anchor_lang::system_program::transfer(cpi_ctx, amount)?;

    Ok(())
}
