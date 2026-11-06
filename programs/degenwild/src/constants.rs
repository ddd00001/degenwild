use anchor_lang::prelude::*;

#[constant]
pub const BATTLE_SEED: &[u8] = b"battle";

/// Minimum stake: 0.01 SOL
#[constant]
pub const MIN_STAKE_LAMPORTS: u64 = 10_000_000;

/// Coinflip platform fee: 2.5% (250 basis points)
#[constant]
pub const COINFLIP_FEE_BPS: u64 = 250;
