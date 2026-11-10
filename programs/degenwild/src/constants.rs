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

/// Public wallet authorized to initialize DEGEN WILD platform settings.
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
