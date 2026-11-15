use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Stake is below the minimum")]
    StakeTooLow,

    #[msg("Stake is above the maximum")]
    StakeTooHigh,

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

    #[msg("Side must be 0 (Heads) or 1 (Tails)")]
    InvalidSide,

    #[msg("ORAO randomness is already fulfilled; settle instead of refunding")]
    RandomnessAlreadyFulfilled,

    #[msg("Refund timeout has not passed yet")]
    RefundTooEarly,

    #[msg("Username must be 3-16 characters")]
    UsernameLength,

    #[msg("Username may only contain letters, numbers and underscores")]
    UsernameInvalidChars,

    #[msg("That username is reserved")]
    UsernameReserved,

    #[msg("Jackpot entries are closed for this round")]
    JackpotClosed,

    #[msg("This jackpot round is full")]
    JackpotFull,

    #[msg("Jackpot round is not open")]
    JackpotNotOpen,

    #[msg("The jackpot countdown has not finished yet")]
    JackpotCountdownRunning,

    #[msg("Jackpot round is not drawing")]
    JackpotNotDrawing,

    #[msg("Winner account does not match the drawn ticket")]
    JackpotWrongWinner,

    #[msg("You can only leave a round you are alone in, before the countdown starts")]
    JackpotCannotLeave,

    #[msg("Refund accounts do not match the round's players")]
    JackpotRefundAccountsMismatch,
}
