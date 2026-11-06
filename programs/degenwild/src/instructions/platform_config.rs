use anchor_lang::prelude::*;

use crate::{
    constants::{COINFLIP_FEE_BPS, PLATFORM_ADMIN, PLATFORM_CONFIG_SEED},
    state::PlatformConfig,
};

#[derive(Accounts)]
pub struct InitializePlatformConfig<'info> {
    #[account(
        mut,
        address = PLATFORM_ADMIN
    )]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + PlatformConfig::INIT_SPACE,
        seeds = [PLATFORM_CONFIG_SEED],
        bump
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_platform_config(
    ctx: Context<InitializePlatformConfig>,
) -> Result<()> {
    let config = &mut ctx.accounts.platform_config;

    config.admin = ctx.accounts.admin.key();
    config.treasury = ctx.accounts.admin.key();
    config.coinflip_fee_bps = COINFLIP_FEE_BPS as u16;
    config.bump = ctx.bumps.platform_config;

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateTreasury<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PLATFORM_CONFIG_SEED],
        bump = platform_config.bump,
        has_one = admin
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    pub new_treasury: SystemAccount<'info>,
}

pub fn handle_update_treasury(ctx: Context<UpdateTreasury>) -> Result<()> {
    ctx.accounts.platform_config.treasury = ctx.accounts.new_treasury.key();

    Ok(())
}
