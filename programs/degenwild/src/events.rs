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

/// Emitted when a jackpot round pays out. The round account is closed in the same instruction.
#[event]
pub struct JackpotSettled {
    pub round: Pubkey,
    pub round_id: u64,
    pub winner: Pubkey,
    pub total: u64,
    pub payout: u64,
    pub fee: u64,
    /// Lamport index in [0, total) picked by the randomness.
    pub ticket: u64,
    pub players: u8,
}

/// Emitted when a jackpot round is refunded after the ORAO timeout.
#[event]
pub struct JackpotRefunded {
    pub round: Pubkey,
    pub round_id: u64,
    pub total: u64,
}
