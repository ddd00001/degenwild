use anchor_lang::prelude::*;

#[constant]
pub const BATTLE_SEED: &[u8] = b"battle";

/// Minimum stake: 0.05 SOL
#[constant]
pub const MIN_STAKE_LAMPORTS: u64 = 50_000_000;

/// Maximum stake: 10 SOL
pub const MAX_STAKE_LAMPORTS: u64 = 10_000_000_000;

/// Coinflip platform fee: 3.5% (350 basis points)
#[constant]
pub const COINFLIP_FEE_BPS: u64 = 350;

/// Public wallet authorized to initialize DegenWild platform settings.
pub const PLATFORM_ADMIN: Pubkey = pubkey!("4VUJ1pCqT1TWQhKFSyDC7EP9HkEAUSGrcaBpYhCEfx7b");

/// Platform configuration PDA seed.
pub const PLATFORM_CONFIG_SEED: &[u8] = b"platform_config";

/// Slots to wait for ORAO before a joined battle can be refunded (~5 min).
pub const REFUND_TIMEOUT_SLOTS: u64 = 750;

/// Profile PDA seed: [PROFILE_SEED, wallet].
pub const PROFILE_SEED: &[u8] = b"profile";

/// Username claim PDA seed: [USERNAME_SEED, lowercase(username)]. Makes names unique case-insensitively.
pub const USERNAME_SEED: &[u8] = b"username";

pub const USERNAME_MIN_LEN: usize = 3;
pub const USERNAME_MAX_LEN: usize = 16;

/// Names that would let someone pose as staff. Matched case-insensitively.
pub const RESERVED_USERNAMES: &[&str] = &[
    "support", "mod", "moderator", "official", "team", "staff", "system", "dev", "owner", "help",
];
/// Fragments that may not appear anywhere in a name.
pub const RESERVED_FRAGMENTS: &[&str] = &["degenwild", "degen_wild", "admin"];

// ---------------------------------------------------------------- jackpot

/// Singleton jackpot state PDA: [JACKPOT_STATE_SEED].
pub const JACKPOT_STATE_SEED: &[u8] = b"jackpot_state";

/// Jackpot round PDA: [JACKPOT_ROUND_SEED, round_id (u64 LE)].
pub const JACKPOT_ROUND_SEED: &[u8] = b"jackpot_round";

/// Smallest single jackpot entry: 0.01 SOL.
pub const JACKPOT_MIN_ENTRY_LAMPORTS: u64 = 10_000_000;

/// Largest single jackpot entry: 10 SOL.
pub const JACKPOT_MAX_ENTRY_LAMPORTS: u64 = 10_000_000_000;

/// Most distinct players in one round (keeps the account and the payout loop small).
pub const JACKPOT_MAX_PLAYERS: usize = 30;

/// Distinct players needed before the countdown starts.
pub const JACKPOT_MIN_PLAYERS: usize = 2;

/// Countdown length once enough players joined.
pub const JACKPOT_COUNTDOWN_SECS: i64 = 120;
