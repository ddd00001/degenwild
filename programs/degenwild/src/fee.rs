use crate::constants::COINFLIP_FEE_BPS;

/// Returns (platform_fee, winner_payout) in lamports.
/// The fee is calculated from the entire pot.
pub fn calculate_coinflip_fee(pot: u64) -> Option<(u64, u64)> {
    let fee = (pot as u128)
        .checked_mul(COINFLIP_FEE_BPS as u128)?
        .checked_div(10_000)?;

    let fee = u64::try_from(fee).ok()?;
    let payout = pot.checked_sub(fee)?;

    Some((fee, payout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculates_2_5_percent_fee_from_entire_pot() {
        let pot = 2_000_000_000; // 2 SOL

        let (fee, payout) = calculate_coinflip_fee(pot).unwrap();

        assert_eq!(fee, 50_000_000);       // 0.05 SOL
        assert_eq!(payout, 1_950_000_000); // 1.95 SOL
    }

    #[test]
    fn handles_small_pots_with_integer_rounding() {
        let (fee, payout) = calculate_coinflip_fee(1).unwrap();

        assert_eq!(fee, 0);
        assert_eq!(payout, 1);
    }

    #[test]
    fn fee_and_payout_always_add_up_to_the_pot() {
        let pot = 123_456_789;

        let (fee, payout) = calculate_coinflip_fee(pot).unwrap();

        assert_eq!(fee + payout, pot);
    }
}
