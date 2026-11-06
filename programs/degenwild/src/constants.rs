use anchor_lang::prelude::*;

#[constant]
pub const BATTLE_SEED: &[u8] = b"battle";

/// Minimum stake: 0.01 SOL
#[constant]
pub const MIN_STAKE_LAMPORTS: u64 = 10_000_000;
