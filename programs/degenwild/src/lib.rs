pub mod constants;
pub mod error;
pub mod events;
pub mod fee;
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

    pub fn create_battle(
        ctx: Context<CreateBattle>,
        battle_id: u64,
        amount: u64,
        creator_side: u8,
    ) -> Result<()> {
        crate::instructions::create_battle::handle_create_battle(ctx, battle_id, amount, creator_side)
    }

    pub fn join_battle(ctx: Context<JoinBattle>, amount: u64) -> Result<()> {
        crate::instructions::join_battle::handle_join_battle(ctx, amount)
    }

    pub fn cancel_battle(ctx: Context<CancelBattle>) -> Result<()> {
        crate::instructions::cancel_battle::handle_cancel_battle(ctx)
    }

    pub fn settle_battle(ctx: Context<SettleBattle>) -> Result<()> {
        crate::instructions::settle_battle::handle_settle_battle(ctx)
    }

    pub fn refund_expired_battle(ctx: Context<RefundExpiredBattle>) -> Result<()> {
        crate::instructions::refund_expired_battle::handle_refund_expired_battle(ctx)
    }

    pub fn initialize_platform_config(ctx: Context<InitializePlatformConfig>) -> Result<()> {
        crate::instructions::platform_config::handle_initialize_platform_config(ctx)
    }

    pub fn update_treasury(ctx: Context<UpdateTreasury>) -> Result<()> {
        crate::instructions::platform_config::handle_update_treasury(ctx)
    }

    pub fn create_profile(ctx: Context<CreateProfile>, username: String) -> Result<()> {
        crate::instructions::username::handle_create_profile(ctx, username)
    }

    pub fn change_username(ctx: Context<ChangeUsername>, new_username: String) -> Result<()> {
        crate::instructions::username::handle_change_username(ctx, new_username)
    }

    pub fn delete_profile(ctx: Context<DeleteProfile>) -> Result<()> {
        crate::instructions::username::handle_delete_profile(ctx)
    }

    pub fn admin_remove_username(ctx: Context<AdminRemoveUsername>) -> Result<()> {
        crate::instructions::username::handle_admin_remove_username(ctx)
    }
}
