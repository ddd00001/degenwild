//! Jackpot: players add SOL to one shared pot. Each lamport is one ticket, so a player's
//! chance to win equals their share of the pot. Once JACKPOT_MIN_PLAYERS distinct players
//! are in, a JACKPOT_COUNTDOWN_SECS countdown starts; after it, anyone can request ORAO
//! randomness ("draw"), and once it lands anyone can settle: the winner gets the pot minus
//! the platform fee.

use anchor_lang::prelude::*;

use crate::{
    constants::{
        COINFLIP_FEE_BPS, JACKPOT_COUNTDOWN_SECS, JACKPOT_MAX_ENTRY_LAMPORTS, JACKPOT_MAX_PLAYERS,
        JACKPOT_MIN_ENTRY_LAMPORTS, JACKPOT_MIN_PLAYERS, JACKPOT_ROUND_SEED, JACKPOT_STATE_SEED,
        PLATFORM_CONFIG_SEED, REFUND_TIMEOUT_SLOTS,
    },
    error::ErrorCode,
    events::{JackpotRefunded, JackpotSettled},
    fee::calculate_coinflip_fee,
    state::{JackpotEntry, JackpotRound, JackpotState, JackpotStatus, PlatformConfig},
};

const ORAO_CONFIG_SEED: &[u8] = b"orao-vrf-network-configuration";
const ORAO_RANDOMNESS_SEED: &[u8] = b"orao-vrf-randomness-request";

// ---------------------------------------------------------------- init (once)

#[derive(Accounts)]
pub struct InitJackpot<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + JackpotState::INIT_SPACE,
        seeds = [JACKPOT_STATE_SEED],
        bump
    )]
    pub jackpot_state: Account<'info, JackpotState>,

    pub system_program: Program<'info, System>,
}

pub fn handle_init_jackpot(ctx: Context<InitJackpot>) -> Result<()> {
    let state = &mut ctx.accounts.jackpot_state;
    state.current_round = 1;
    state.bump = ctx.bumps.jackpot_state;
    Ok(())
}

// ---------------------------------------------------------------- enter

#[derive(Accounts)]
pub struct EnterJackpot<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(seeds = [JACKPOT_STATE_SEED], bump = jackpot_state.bump)]
    pub jackpot_state: Account<'info, JackpotState>,

    /// The current round. Created by its first entrant, who pays (and later gets back) the rent.
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + JackpotRound::INIT_SPACE,
        seeds = [JACKPOT_ROUND_SEED, &jackpot_state.current_round.to_le_bytes()],
        bump
    )]
    pub round: Account<'info, JackpotRound>,

    pub system_program: Program<'info, System>,
}

pub fn handle_enter_jackpot(ctx: Context<EnterJackpot>, amount: u64) -> Result<()> {
    require!(amount >= JACKPOT_MIN_ENTRY_LAMPORTS, ErrorCode::StakeTooLow);
    require!(amount <= JACKPOT_MAX_ENTRY_LAMPORTS, ErrorCode::StakeTooHigh);

    let now = Clock::get()?.unix_timestamp;
    let player = ctx.accounts.player.key();
    let round_id = ctx.accounts.jackpot_state.current_round;
    let round = &mut ctx.accounts.round;

    if round.entries.is_empty() {
        // Fresh (or re-created) round.
        round.round_id = round_id;
        round.status = JackpotStatus::Open;
        round.total = 0;
        round.countdown_end = 0;
        round.bump = ctx.bumps.round;
    }

    require!(round.status == JackpotStatus::Open, ErrorCode::JackpotNotOpen);
    require!(
        round.countdown_end == 0 || now < round.countdown_end,
        ErrorCode::JackpotClosed
    );

    match round.entries.iter_mut().find(|e| e.player == player) {
        Some(entry) => {
            entry.amount = entry
                .amount
                .checked_add(amount)
                .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
            require!(entry.amount <= JACKPOT_MAX_ENTRY_LAMPORTS, ErrorCode::StakeTooHigh);
        }
        None => {
            require!(round.entries.len() < JACKPOT_MAX_PLAYERS, ErrorCode::JackpotFull);
            round.entries.push(JackpotEntry { player, amount });
        }
    }

    round.total = round
        .total
        .checked_add(amount)
        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;

    if round.countdown_end == 0 && round.entries.len() >= JACKPOT_MIN_PLAYERS {
        round.countdown_end = now
            .checked_add(JACKPOT_COUNTDOWN_SECS)
            .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
    }

    let transfer = anchor_lang::system_program::Transfer {
        from: ctx.accounts.player.to_account_info(),
        to: ctx.accounts.round.to_account_info(),
    };
    anchor_lang::system_program::transfer(
        CpiContext::new(anchor_lang::system_program::ID, transfer),
        amount,
    )?;

    Ok(())
}

// ---------------------------------------------------------------- leave (alone, before countdown)

#[derive(Accounts)]
pub struct LeaveJackpot<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(seeds = [JACKPOT_STATE_SEED], bump = jackpot_state.bump)]
    pub jackpot_state: Account<'info, JackpotState>,

    /// Closed: the stake and the rent both go back to the only player.
    #[account(
        mut,
        close = player,
        seeds = [JACKPOT_ROUND_SEED, &jackpot_state.current_round.to_le_bytes()],
        bump = round.bump
    )]
    pub round: Account<'info, JackpotRound>,
}

pub fn handle_leave_jackpot(ctx: Context<LeaveJackpot>) -> Result<()> {
    let round = &ctx.accounts.round;
    require!(
        round.status == JackpotStatus::Open
            && round.countdown_end == 0
            && round.entries.len() == 1
            && round.entries[0].player == ctx.accounts.player.key(),
        ErrorCode::JackpotCannotLeave
    );
    // `close = player` returns every lamport (stake + rent).
    Ok(())
}

// ---------------------------------------------------------------- draw (request randomness)

#[derive(Accounts)]
pub struct DrawJackpot<'info> {
    /// Anyone can draw once the countdown is over; they pay ORAO's small request fee.
    #[account(mut)]
    pub drawer: Signer<'info>,

    #[account(seeds = [JACKPOT_STATE_SEED], bump = jackpot_state.bump)]
    pub jackpot_state: Account<'info, JackpotState>,

    #[account(
        mut,
        seeds = [JACKPOT_ROUND_SEED, &jackpot_state.current_round.to_le_bytes()],
        bump = round.bump
    )]
    pub round: Account<'info, JackpotRound>,

    #[account(
        mut,
        seeds = [ORAO_CONFIG_SEED],
        bump,
        seeds::program = orao_solana_vrf::ID
    )]
    pub orao_network_state: Account<'info, orao_solana_vrf::state::NetworkState>,

    /// CHECK: Must match the SOL treasury configured in ORAO's network state.
    #[account(mut, constraint = orao_network_state.config.treasury == orao_treasury.key())]
    pub orao_treasury: UncheckedAccount<'info>,

    /// CHECK: Address is checked against the PDA derived from our seed.
    #[account(mut)]
    pub randomness_request: UncheckedAccount<'info>,

    /// CHECK: Must be the official ORAO executable program account.
    #[account(address = orao_solana_vrf::ID)]
    pub orao_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Deterministic, unique ORAO seed for a round (the seed does not decide the winner).
pub fn jackpot_seed(round: &Pubkey, round_id: u64) -> [u8; 32] {
    Pubkey::find_program_address(
        &[b"degenwild-jackpot-v1", round.as_ref(), &round_id.to_le_bytes()],
        &crate::ID,
    )
    .0
    .to_bytes()
}

pub fn handle_draw_jackpot(ctx: Context<DrawJackpot>) -> Result<()> {
    let round = &ctx.accounts.round;
    require!(round.status == JackpotStatus::Open, ErrorCode::JackpotNotOpen);
    require!(
        round.countdown_end != 0 && Clock::get()?.unix_timestamp >= round.countdown_end,
        ErrorCode::JackpotCountdownRunning
    );

    let seed = jackpot_seed(&ctx.accounts.round.key(), round.round_id);
    let expected_request =
        Pubkey::find_program_address(&[ORAO_RANDOMNESS_SEED, &seed], &orao_solana_vrf::ID).0;
    require_keys_eq!(ctx.accounts.randomness_request.key(), expected_request);

    let orao_accounts = orao_solana_vrf::cpi::accounts::RequestV2 {
        payer: ctx.accounts.drawer.to_account_info(),
        network_state: ctx.accounts.orao_network_state.to_account_info(),
        treasury: ctx.accounts.orao_treasury.to_account_info(),
        request: ctx.accounts.randomness_request.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };
    let orao_ctx = CpiContext::new(orao_solana_vrf::ID, orao_accounts)
        .with_remaining_accounts(vec![ctx.accounts.orao_program.to_account_info()]);
    orao_solana_vrf::cpi::request_v2(orao_ctx, seed)?;

    let round = &mut ctx.accounts.round;
    round.status = JackpotStatus::Drawing;
    round.drawer = ctx.accounts.drawer.key();
    round.randomness_seed = seed;
    round.randomness_account = expected_request;
    round.drawn_slot = Clock::get()?.slot;

    Ok(())
}

// ---------------------------------------------------------------- settle

/// Which entry owns lamport `ticket` (entries laid out in join order).
pub fn jackpot_winner_index(entries: &[JackpotEntry], ticket: u64) -> Option<usize> {
    let mut cumulative: u64 = 0;
    for (i, e) in entries.iter().enumerate() {
        cumulative = cumulative.checked_add(e.amount)?;
        if ticket < cumulative {
            return Some(i);
        }
    }
    None
}

/// Maps 64 bytes of ORAO randomness to a ticket in [0, total).
pub fn jackpot_ticket(randomness: &[u8; 64], total: u64) -> Option<u64> {
    if total == 0 {
        return None;
    }
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&randomness[0..16]);
    // u128 mod u64 keeps the bias below 2^-64.
    Some((u128::from_le_bytes(bytes) % total as u128) as u64)
}

#[derive(Accounts)]
pub struct SettleJackpot<'info> {
    #[account(mut, seeds = [JACKPOT_STATE_SEED], bump = jackpot_state.bump)]
    pub jackpot_state: Account<'info, JackpotState>,

    #[account(
        mut,
        seeds = [JACKPOT_ROUND_SEED, &jackpot_state.current_round.to_le_bytes()],
        bump = round.bump
    )]
    pub round: Account<'info, JackpotRound>,

    #[account(
        seeds = [ORAO_RANDOMNESS_SEED, &round.randomness_seed],
        bump,
        seeds::program = orao_solana_vrf::ID,
        address = round.randomness_account
    )]
    pub randomness_request: Account<'info, orao_solana_vrf::state::RandomnessV2>,

    #[account(seeds = [PLATFORM_CONFIG_SEED], bump = platform_config.bump)]
    pub platform_config: Account<'info, PlatformConfig>,

    #[account(mut, address = platform_config.treasury)]
    pub treasury: SystemAccount<'info>,
    // remaining_accounts (writable): the winner, then the first entrant (rent payer).
    // They may be the same wallet; pass it once in that case.
}

/// Finds `key` among the given infos.
fn find_info<'a, 'info>(infos: &'a [AccountInfo<'info>], key: &Pubkey) -> Option<&'a AccountInfo<'info>> {
    infos.iter().find(|a| a.key == key)
}

fn credit(info: &AccountInfo, lamports: u64) -> Result<()> {
    require!(info.is_writable, ErrorCode::JackpotWrongWinner);
    let balance = info
        .lamports()
        .checked_add(lamports)
        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
    **info.try_borrow_mut_lamports()? = balance;
    Ok(())
}

fn debit(info: &AccountInfo, lamports: u64) -> Result<()> {
    let balance = info
        .lamports()
        .checked_sub(lamports)
        .ok_or(error!(ErrorCode::InsufficientEscrow))?;
    **info.try_borrow_mut_lamports()? = balance;
    Ok(())
}

pub fn handle_settle_jackpot<'info>(ctx: Context<'info, SettleJackpot<'info>>) -> Result<()> {
    let round = &ctx.accounts.round;
    require!(round.status == JackpotStatus::Drawing, ErrorCode::JackpotNotDrawing);
    require!(
        ctx.accounts.platform_config.coinflip_fee_bps as u64 == COINFLIP_FEE_BPS,
        ErrorCode::InvalidPlatformFee
    );

    let request = &ctx.accounts.randomness_request;
    require!(
        request.client() == &round.drawer && request.seed() == &round.randomness_seed,
        ErrorCode::RandomnessRequestMismatch
    );
    let fulfilled = request
        .fulfilled()
        .ok_or(error!(ErrorCode::RandomnessNotFulfilled))?;

    let total = round.total;
    let ticket =
        jackpot_ticket(&fulfilled.randomness, total).ok_or(error!(ErrorCode::InsufficientEscrow))?;
    let idx = jackpot_winner_index(&round.entries, ticket)
        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
    let winner = round.entries[idx].player;
    let rent_payer = round.entries[0].player;
    let players = round.entries.len() as u8;
    let round_id = round.round_id;

    let (fee, payout) = calculate_coinflip_fee(total).ok_or(error!(ErrorCode::ArithmeticOverflow))?;

    let round_info = ctx.accounts.round.to_account_info();
    let rent_reserve = Rent::get()?.minimum_balance(round_info.data_len());
    let available = round_info
        .lamports()
        .checked_sub(rent_reserve)
        .ok_or(error!(ErrorCode::InsufficientEscrow))?;
    require!(available >= total, ErrorCode::InsufficientEscrow);

    // The treasury may itself be the winner; otherwise look in remaining_accounts.
    let treasury_info = ctx.accounts.treasury.to_account_info();
    let pool: Vec<AccountInfo<'info>> = ctx
        .remaining_accounts
        .iter()
        .cloned()
        .chain(std::iter::once(treasury_info.clone()))
        .collect();
    let winner_info = find_info(&pool, &winner).ok_or(error!(ErrorCode::JackpotWrongWinner))?;
    let rent_info = find_info(&pool, &rent_payer).ok_or(error!(ErrorCode::JackpotWrongWinner))?;

    debit(&round_info, total)?;
    credit(winner_info, payout)?;
    credit(&treasury_info, fee)?;

    // Close the round by hand (rent back to the first entrant).
    let rest = round_info.lamports();
    debit(&round_info, rest)?;
    credit(rent_info, rest)?;

    let state = &mut ctx.accounts.jackpot_state;
    state.last_round = round_id;
    state.last_winner = winner;
    state.last_total = total;
    state.last_payout = payout;
    state.last_ticket = ticket;
    state.current_round = round_id
        .checked_add(1)
        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;

    emit!(JackpotSettled {
        round: ctx.accounts.round.key(),
        round_id,
        winner,
        total,
        payout,
        fee,
        ticket,
        players,
    });

    round_info.assign(&anchor_lang::system_program::ID);
    round_info.resize(0)?;
    Ok(())
}

// ---------------------------------------------------------------- refund (randomness never arrived)

#[derive(Accounts)]
pub struct RefundJackpot<'info> {
    #[account(mut, seeds = [JACKPOT_STATE_SEED], bump = jackpot_state.bump)]
    pub jackpot_state: Account<'info, JackpotState>,

    #[account(
        mut,
        seeds = [JACKPOT_ROUND_SEED, &jackpot_state.current_round.to_le_bytes()],
        bump = round.bump
    )]
    pub round: Account<'info, JackpotRound>,

    #[account(address = round.randomness_account)]
    pub randomness_request: Account<'info, orao_solana_vrf::state::RandomnessV2>,
    // remaining_accounts (writable): every player, in entry order.
}

pub fn handle_refund_jackpot<'info>(ctx: Context<'info, RefundJackpot<'info>>) -> Result<()> {
    let round = &ctx.accounts.round;
    require!(round.status == JackpotStatus::Drawing, ErrorCode::JackpotNotDrawing);
    require!(
        ctx.accounts.randomness_request.fulfilled().is_none(),
        ErrorCode::RandomnessAlreadyFulfilled
    );
    let deadline = round
        .drawn_slot
        .checked_add(REFUND_TIMEOUT_SLOTS)
        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
    require!(Clock::get()?.slot >= deadline, ErrorCode::RefundTooEarly);

    let entries = round.entries.clone();
    let total = round.total;
    let round_id = round.round_id;
    require!(
        ctx.remaining_accounts.len() == entries.len(),
        ErrorCode::JackpotRefundAccountsMismatch
    );

    let round_info = ctx.accounts.round.to_account_info();
    for (entry, info) in entries.iter().zip(ctx.remaining_accounts.iter()) {
        require_keys_eq!(*info.key, entry.player, ErrorCode::JackpotRefundAccountsMismatch);
        debit(&round_info, entry.amount)?;
        credit(info, entry.amount)?;
    }

    let rest = round_info.lamports();
    debit(&round_info, rest)?;
    credit(&ctx.remaining_accounts[0], rest)?;

    let state = &mut ctx.accounts.jackpot_state;
    state.current_round = round_id
        .checked_add(1)
        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;

    emit!(JackpotRefunded { round: ctx.accounts.round.key(), round_id, total });

    round_info.assign(&anchor_lang::system_program::ID);
    round_info.resize(0)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(amount: u64) -> JackpotEntry {
        JackpotEntry { player: Pubkey::new_unique(), amount }
    }

    #[test]
    fn winner_index_follows_stake_ranges() {
        // 1 SOL, 2 SOL, 0.5 SOL -> tickets [0,1), [1,3), [3,3.5) in SOL.
        let entries = [e(1_000_000_000), e(2_000_000_000), e(500_000_000)];
        assert_eq!(jackpot_winner_index(&entries, 0), Some(0));
        assert_eq!(jackpot_winner_index(&entries, 999_999_999), Some(0));
        assert_eq!(jackpot_winner_index(&entries, 1_000_000_000), Some(1));
        assert_eq!(jackpot_winner_index(&entries, 2_999_999_999), Some(1));
        assert_eq!(jackpot_winner_index(&entries, 3_000_000_000), Some(2));
        assert_eq!(jackpot_winner_index(&entries, 3_499_999_999), Some(2));
        assert_eq!(jackpot_winner_index(&entries, 3_500_000_000), None);
    }

    #[test]
    fn ticket_is_always_inside_the_pot() {
        let mut r = [0u8; 64];
        for b in 0..=255u8 {
            r[0] = b;
            r[7] = b.wrapping_mul(31);
            r[15] = 0xff;
            let t = jackpot_ticket(&r, 3_500_000_000).unwrap();
            assert!(t < 3_500_000_000);
        }
        assert_eq!(jackpot_ticket(&r, 0), None);
    }
}
