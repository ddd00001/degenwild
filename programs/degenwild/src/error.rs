use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Stake is below the minimum")]
    StakeTooLow,

    #[msg("Battle is not open")]
    BattleNotOpen,

    #[msg("Battle already has an opponent")]
    BattleAlreadyJoined,

    #[msg("The creator cannot join their own battle")]
    CreatorCannotJoin,

    #[msg("Opponent stake must exactly match the creator's stake")]
    IncorrectStake,

    #[msg("ORAO randomness has not been fulfilled yet")]
    RandomnessNotFulfilled,

    #[msg("ORAO randomness request does not match this battle")]
    RandomnessRequestMismatch,

    #[msg("Battle is not ready for settlement")]
    BattleNotReady,

    #[msg("Platform fee configuration is invalid")]
    InvalidPlatformFee,

    #[msg("Battle escrow does not contain the expected pot")]
    InsufficientEscrow,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
}
