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
}
