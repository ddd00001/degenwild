pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("6Gv48CrXyPgqNtJsPgAW95ynm6CvbvjkB5x2p3ru2dYV");

#[program]
pub mod degenwild {
    use super::*;

    pub fn create_battle(ctx: Context<CreateBattle>, battle_id: u64, amount: u64) -> Result<()> {
        crate::instructions::create_battle::handle_create_battle(ctx, battle_id, amount)
    }

    pub fn join_battle(ctx: Context<JoinBattle>, amount: u64) -> Result<()> {
        crate::instructions::join_battle::handle_join_battle(ctx, amount)
    }

    pub fn cancel_battle(ctx: Context<CancelBattle>) -> Result<()> {
        crate::instructions::cancel_battle::handle_cancel_battle(ctx)
    }
}
