use crate::{
    constants::BATTLE_SEED,
    error::ErrorCode,
    state::{Battle, BattleStatus},
};
use anchor_lang::prelude::*;

const ORAO_CONFIG_SEED: &[u8] = b"orao-vrf-network-configuration";
const ORAO_RANDOMNESS_SEED: &[u8] = b"orao-vrf-randomness-request";

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

    #[account(
        mut,
        seeds = [ORAO_CONFIG_SEED],
        bump,
        seeds::program = orao_solana_vrf::ID
    )]
    pub orao_network_state: Account<'info, orao_solana_vrf::state::NetworkState>,

    /// CHECK: Must match the SOL treasury configured in ORAO's network state.
    #[account(
        mut,
        constraint = orao_network_state.config.treasury == orao_treasury.key()
    )]
    pub orao_treasury: UncheckedAccount<'info>,

    /// CHECK: Address is checked against the PDA derived from our seed.
    #[account(mut)]
    pub randomness_request: UncheckedAccount<'info>,

    /// CHECK: Must be the official ORAO executable program account.
    #[account(address = orao_solana_vrf::ID)]
    pub orao_program: UncheckedAccount<'info>,

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

    // Create a unique, deterministic seed for this battle and opponent.
    // The seed does not determine the winner; ORAO supplies the randomness.
    let battle_key = ctx.accounts.battle.key();
    let battle_id_bytes = battle.battle_id.to_le_bytes();
    let opponent_key = ctx.accounts.opponent.key();

    let seed = Pubkey::find_program_address(
        &[
            b"degenwild-coinflip-v1",
            battle_key.as_ref(),
            &battle_id_bytes,
            opponent_key.as_ref(),
        ],
        &crate::ID,
    )
    .0
    .to_bytes();
    // Derive the official ORAO randomness request PDA.
    let expected_request =
        Pubkey::find_program_address(&[ORAO_RANDOMNESS_SEED, &seed], &orao_solana_vrf::ID).0;

    require_keys_eq!(ctx.accounts.randomness_request.key(), expected_request);

    // Transfer the opponent's stake into escrow.
    let transfer_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.opponent.to_account_info(),
        to: ctx.accounts.battle.to_account_info(),
    };

    let transfer_ctx = CpiContext::new(anchor_lang::system_program::ID, transfer_accounts);
    anchor_lang::system_program::transfer(transfer_ctx, amount)?;

    // Ask ORAO to create the randomness request.
    // The opponent pays ORAO's request fee separately from the battle pot.
    let orao_accounts = orao_solana_vrf::cpi::accounts::RequestV2 {
        payer: ctx.accounts.opponent.to_account_info(),
        network_state: ctx.accounts.orao_network_state.to_account_info(),
        treasury: ctx.accounts.orao_treasury.to_account_info(),
        request: ctx.accounts.randomness_request.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };

    let orao_ctx = CpiContext::new(orao_solana_vrf::ID, orao_accounts)
        .with_remaining_accounts(vec![ctx.accounts.orao_program.to_account_info()]);
    orao_solana_vrf::cpi::request_v2(orao_ctx, seed)?;

    // Record the opponent and randomness request.
    let battle = &mut ctx.accounts.battle;
    battle.opponent = Some(opponent_key);
    battle.randomness_seed = seed;
    battle.randomness_account = expected_request;
    battle.status = BattleStatus::RandomnessPending;

    Ok(())
}
