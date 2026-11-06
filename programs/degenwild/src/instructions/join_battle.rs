use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Battle, BattleStatus},
};

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct JoinBattle<'info> {
    #[account(mut)]
    pub opponent: Signer<'info>,

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

    pub system_program: Program<'info, System>,
}

pub fn handle_join_battle(ctx: Context<JoinBattle>, amount: u64) -> Result<()> {
    let battle = &ctx.accounts.battle;

    require!(
        battle.status == BattleStatus::Open,
        ErrorCode::BattleNotOpen
    );

    require!(battle.opponent.is_none(), ErrorCode::BattleAlreadyJoined);

    require!(
        ctx.accounts.opponent.key() != battle.creator,
        ErrorCode::CreatorCannotJoin
    );

    require!(amount == battle.amount, ErrorCode::IncorrectStake);

    // Transfer the matching stake into the battle escrow.
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.opponent.to_account_info(),
        to: ctx.accounts.battle.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(anchor_lang::system_program::ID, cpi_accounts);

    anchor_lang::system_program::transfer(cpi_ctx, amount)?;

    // Record the opponent and update the battle.
    let battle = &mut ctx.accounts.battle;
    battle.opponent = Some(ctx.accounts.opponent.key());
    battle.status = BattleStatus::Joined;

    Ok(())
}
