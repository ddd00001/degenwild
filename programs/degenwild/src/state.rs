use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum BattleStatus {
    Open,
    Joined,
    RandomnessPending,
    Settled,
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
    pub bump: u8,
}

/// Stores the authorized DEGEN WILD platform settings.
#[account]
#[derive(InitSpace)]
pub struct PlatformConfig {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub coinflip_fee_bps: u16,
    pub bump: u8,
}
