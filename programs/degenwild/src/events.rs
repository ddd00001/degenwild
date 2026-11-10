use anchor_lang::prelude::*;

/// Emitted when a battle is settled. The battle account is closed in the same
/// instruction, so this log is the permanent record of the outcome.
#[event]
pub struct BattleSettled {
    pub battle: Pubkey,
    pub battle_id: u64,
    pub creator: Pubkey,
    pub opponent: Pubkey,
    pub winner: Pubkey,
    /// 0 = Heads, 1 = Tails.
    pub coin: u8,
    pub payout: u64,
    pub fee: u64,
}

/// Emitted when a joined battle is refunded after the ORAO timeout.
#[event]
pub struct BattleRefunded {
    pub battle: Pubkey,
    pub battle_id: u64,
    pub creator: Pubkey,
    pub opponent: Pubkey,
    pub amount: u64,
}
