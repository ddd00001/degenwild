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

/// Stores the authorized DEGEN WILD platform settings.
#[account]
#[derive(InitSpace)]
pub struct PlatformConfig {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub coinflip_fee_bps: u16,
    pub bump: u8,
}

/// A wallet's DEGEN WILD display name. PDA: [PROFILE_SEED, owner].
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
