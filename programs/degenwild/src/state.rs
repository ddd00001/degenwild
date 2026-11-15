use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum BattleStatus {
    Open,
    Joined,
    RandomnessPending,
    Settled,
    Refunded,
}

#[account]
#[derive(InitSpace)]
pub struct Battle {
    pub creator: Pubkey,
    pub opponent: Option<Pubkey>,
    pub amount: u64,
    pub battle_id: u64,
    pub status: BattleStatus,
    pub randomness_seed: [u8; 32],
    pub randomness_account: Pubkey,
    pub winner: Option<Pubkey>,
    /// 0 = Heads, 1 = Tails (the creator's pick).
    pub creator_side: u8,
    /// Slot at which the opponent joined (used for the refund timeout).
    pub joined_slot: u64,
    pub bump: u8,
}

/// Stores the authorized DegenWild platform settings.
#[account]
#[derive(InitSpace)]
pub struct PlatformConfig {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub coinflip_fee_bps: u16,
    pub bump: u8,
}

/// A wallet's DegenWild display name. PDA: [PROFILE_SEED, owner].
#[account]
#[derive(InitSpace)]
pub struct Profile {
    pub owner: Pubkey,
    #[max_len(16)]
    pub username: String,
    pub bump: u8,
}

/// Reserves a lowercase username for one wallet. PDA: [USERNAME_SEED, lowercase(username)].
#[account]
#[derive(InitSpace)]
pub struct UsernameClaim {
    pub owner: Pubkey,
    pub bump: u8,
}

// ---------------------------------------------------------------- jackpot

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum JackpotStatus {
    /// Taking entries (until the countdown ends).
    Open,
    /// Entries closed, waiting for ORAO randomness.
    Drawing,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct JackpotEntry {
    pub player: Pubkey,
    /// Total lamports this player put in this round.
    pub amount: u64,
}

/// Points at the current round and remembers the last result. PDA: [JACKPOT_STATE_SEED].
#[account]
#[derive(InitSpace)]
pub struct JackpotState {
    pub current_round: u64,
    pub last_round: u64,
    pub last_winner: Pubkey,
    pub last_total: u64,
    pub last_payout: u64,
    /// Winning ticket in [0, last_total): the lamport the wheel landed on.
    pub last_ticket: u64,
    pub bump: u8,
}

/// One jackpot round. PDA: [JACKPOT_ROUND_SEED, round_id]. Holds every entry in escrow.
/// The first entrant pays its rent and gets it back when the round closes.
#[account]
#[derive(InitSpace)]
pub struct JackpotRound {
    pub round_id: u64,
    pub status: JackpotStatus,
    pub total: u64,
    /// Unix time when entries close; 0 until JACKPOT_MIN_PLAYERS have joined.
    pub countdown_end: i64,
    /// Wallet that requested the randomness (the ORAO request's client).
    pub drawer: Pubkey,
    pub randomness_seed: [u8; 32],
    pub randomness_account: Pubkey,
    pub drawn_slot: u64,
    #[max_len(30)]
    pub entries: Vec<JackpotEntry>,
    pub bump: u8,
}
