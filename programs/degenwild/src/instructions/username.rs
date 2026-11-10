use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Profile, UsernameClaim},
};

/// Checks a requested username and returns its lowercase claim key.
pub fn username_key(username: &str) -> Result<String> {
    require!(
        (USERNAME_MIN_LEN..=USERNAME_MAX_LEN).contains(&username.len()),
        ErrorCode::UsernameLength
    );
    require!(
        username.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'),
        ErrorCode::UsernameInvalidChars
    );
    let key = username.to_ascii_lowercase();
    require!(
        !RESERVED_USERNAMES.contains(&key.as_str())
            && !RESERVED_FRAGMENTS.iter().any(|f| key.contains(f)),
        ErrorCode::UsernameReserved
    );
    Ok(key)
}

// ---------------------------------------------------------------- create

#[derive(Accounts)]
#[instruction(username: String)]
pub struct CreateProfile<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Profile::INIT_SPACE,
        seeds = [PROFILE_SEED, owner.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, Profile>,

    /// `init` fails if another wallet already holds this name.
    #[account(
        init,
        payer = owner,
        space = 8 + UsernameClaim::INIT_SPACE,
        seeds = [USERNAME_SEED, username.to_ascii_lowercase().as_bytes()],
        bump
    )]
    pub username_claim: Account<'info, UsernameClaim>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_profile(ctx: Context<CreateProfile>, username: String) -> Result<()> {
    username_key(&username)?;

    let profile = &mut ctx.accounts.profile;
    profile.owner = ctx.accounts.owner.key();
    profile.username = username;
    profile.bump = ctx.bumps.profile;

    let claim = &mut ctx.accounts.username_claim;
    claim.owner = ctx.accounts.owner.key();
    claim.bump = ctx.bumps.username_claim;
    Ok(())
}

// ---------------------------------------------------------------- change

#[derive(Accounts)]
#[instruction(new_username: String)]
pub struct ChangeUsername<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [PROFILE_SEED, owner.key().as_ref()],
        bump = profile.bump,
        has_one = owner
    )]
    pub profile: Account<'info, Profile>,

    /// The old name is released and its rent returned.
    #[account(
        mut,
        close = owner,
        seeds = [USERNAME_SEED, profile.username.to_ascii_lowercase().as_bytes()],
        bump = old_claim.bump,
        has_one = owner
    )]
    pub old_claim: Account<'info, UsernameClaim>,

    #[account(
        init,
        payer = owner,
        space = 8 + UsernameClaim::INIT_SPACE,
        seeds = [USERNAME_SEED, new_username.to_ascii_lowercase().as_bytes()],
        bump
    )]
    pub new_claim: Account<'info, UsernameClaim>,

    pub system_program: Program<'info, System>,
}

pub fn handle_change_username(ctx: Context<ChangeUsername>, new_username: String) -> Result<()> {
    username_key(&new_username)?;

    ctx.accounts.profile.username = new_username;

    let claim = &mut ctx.accounts.new_claim;
    claim.owner = ctx.accounts.owner.key();
    claim.bump = ctx.bumps.new_claim;
    Ok(())
}

// ---------------------------------------------------------------- delete

#[derive(Accounts)]
pub struct DeleteProfile<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        close = owner,
        seeds = [PROFILE_SEED, owner.key().as_ref()],
        bump = profile.bump,
        has_one = owner
    )]
    pub profile: Account<'info, Profile>,

    #[account(
        mut,
        close = owner,
        seeds = [USERNAME_SEED, profile.username.to_ascii_lowercase().as_bytes()],
        bump = username_claim.bump,
        has_one = owner
    )]
    pub username_claim: Account<'info, UsernameClaim>,
}

pub fn handle_delete_profile(_ctx: Context<DeleteProfile>) -> Result<()> {
    Ok(())
}

// ---------------------------------------------------------------- moderation

/// Lets the platform admin take down an offensive or impersonating name.
/// Rent goes back to the wallet that paid it.
#[derive(Accounts)]
pub struct AdminRemoveUsername<'info> {
    #[account(address = PLATFORM_ADMIN)]
    pub admin: Signer<'info>,

    /// CHECK: receives the rent; must be the profile's owner.
    #[account(mut, address = profile.owner)]
    pub owner: UncheckedAccount<'info>,

    #[account(
        mut,
        close = owner,
        seeds = [PROFILE_SEED, profile.owner.as_ref()],
        bump = profile.bump
    )]
    pub profile: Account<'info, Profile>,

    #[account(
        mut,
        close = owner,
        seeds = [USERNAME_SEED, profile.username.to_ascii_lowercase().as_bytes()],
        bump = username_claim.bump,
        constraint = username_claim.owner == profile.owner
    )]
    pub username_claim: Account<'info, UsernameClaim>,
}

pub fn handle_admin_remove_username(_ctx: Context<AdminRemoveUsername>) -> Result<()> {
    Ok(())
}
