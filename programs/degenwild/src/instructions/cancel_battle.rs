use anchor_lang::prelude::*;

use crate::{
    constants::BATTLE_SEED,
    error::ErrorCode,
    state::{Battle, BattleStatus},
};

#[derive(Accounts)]
pub struct CancelBattle<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        close = creator,
        seeds = [
            BATTLE_SEED,
            battle.creator.as_ref(),
            &battle.battle_id.to_le_bytes()
        ],
        bump = battle.bump,
        has_one = creator
    )]
    pub battle: Account<'info, Battle>,
}

pub fn handle_cancel_battle(ctx: Context<CancelBattle>) -> Result<()> {
    let battle = &ctx.accounts.battle;

    require!(
        battle.status == BattleStatus::Open,
        ErrorCode::BattleNotOpen
    );

    require!(battle.opponent.is_none(), ErrorCode::BattleAlreadyJoined);

    Ok(())
}
