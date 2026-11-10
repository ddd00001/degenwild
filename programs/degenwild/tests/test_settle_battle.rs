use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::instruction::Instruction,
        AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas,
    },
    degenwild::state::{Battle, BattleStatus, PlatformConfig},
    litesvm::LiteSVM,
    orao_solana_vrf::state::{FulfilledRequest, PendingRequest, RandomnessV2, RequestAccount},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const STAKE: u64 = 1_000_000_000; // 1 SOL each, 2 SOL pot
const FEE: u64 = 70_000_000; // 3.5% of 2 SOL
const PAYOUT: u64 = 1_930_000_000; // 96.5% of 2 SOL
const SEED: [u8; 32] = [7u8; 32];
const BATTLE_ID: u64 = 1;

#[derive(Clone, Copy)]
enum Req {
    Fulfilled,
    Pending,
    WrongClient,
}

struct Env {
    svm: LiteSVM,
    caller: Keypair,
    creator: Pubkey,
    opponent: Pubkey,
    treasury: Pubkey,
    battle: Pubkey,
    request: Pubkey,
    config: Pubkey,
    battle_rent: u64,
}

fn key() -> Pubkey {
    Keypair::new().pubkey()
}

fn account_with<T: AccountSerialize>(state: &T, lamports: u64, owner: Pubkey, min_len: usize) -> Account {
    let mut data = Vec::new();
    state.try_serialize(&mut data).unwrap();
    if data.len() < min_len {
        data.resize(min_len, 0);
    }
    Account { lamports, data, owner, executable: false, rent_epoch: 0 }
}

fn setup(first_byte: u8, kind: Req, status: BattleStatus) -> Env {
    setup_side(first_byte, kind, status, 0, 0)
}

fn setup_side(
    first_byte: u8,
    kind: Req,
    status: BattleStatus,
    creator_side: u8,
    joined_slot: u64,
) -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/degenwild.so"
    ));
    svm.add_program(degenwild::id(), bytes).unwrap();

    let caller = Keypair::new();
    svm.airdrop(&caller.pubkey(), 1_000_000_000).unwrap();

    let creator = key();
    let opponent = key();
    let treasury = key();

    let (battle, bump) = Pubkey::find_program_address(
        &[
            degenwild::constants::BATTLE_SEED,
            creator.as_ref(),
            &BATTLE_ID.to_le_bytes(),
        ],
        &degenwild::id(),
    );
    let (request, _) = Pubkey::find_program_address(
        &[b"orao-vrf-randomness-request", &SEED],
        &orao_solana_vrf::ID,
    );
    let (config, config_bump) = Pubkey::find_program_address(
        &[degenwild::constants::PLATFORM_CONFIG_SEED],
        &degenwild::id(),
    );

    // Battle escrow: rent reserve + both stakes.
    let battle_state = Battle {
        creator,
        opponent: Some(opponent),
        amount: STAKE,
        battle_id: BATTLE_ID,
        status,
        randomness_seed: SEED,
        randomness_account: request,
        winner: None,
        creator_side,
        joined_slot,
        bump,
    };
    let battle_len = 8 + Battle::INIT_SPACE;
    let battle_rent = svm.minimum_balance_for_rent_exemption(battle_len);
    svm.set_account(
        battle,
        account_with(&battle_state, battle_rent + 2 * STAKE, degenwild::id(), battle_len),
    )
    .unwrap();

    // Platform config with the real fee constant.
    let cfg = PlatformConfig {
        admin: key(),
        treasury,
        coinflip_fee_bps: degenwild::constants::COINFLIP_FEE_BPS as u16,
        bump: config_bump,
    };
    let cfg_len = 8 + PlatformConfig::INIT_SPACE;
    svm.set_account(config, account_with(&cfg, 10_000_000, degenwild::id(), cfg_len))
        .unwrap();

    // Fake ORAO randomness account, owned by the ORAO program.
    let mut randomness = [0u8; 64];
    randomness[0] = first_byte;
    let client = match kind {
        Req::WrongClient => key(),
        _ => opponent,
    };
    let orao_state = match kind {
        Req::Pending => RandomnessV2 {
            request: RequestAccount::Pending(PendingRequest {
                client,
                seed: SEED,
                responses: vec![],
            }),
        },
        _ => RandomnessV2 {
            request: RequestAccount::Fulfilled(FulfilledRequest {
                client,
                seed: SEED,
                randomness,
            }),
        },
    };
    svm.set_account(request, account_with(&orao_state, 10_000_000, orao_solana_vrf::ID, 0))
        .unwrap();

    Env { svm, caller, creator, opponent, treasury, battle, request, config, battle_rent }
}

fn settle_tx(env: &Env) -> VersionedTransaction {
    let ix = Instruction::new_with_bytes(
        degenwild::id(),
        &degenwild::instruction::SettleBattle {}.data(),
        degenwild::accounts::SettleBattle {
            battle: env.battle,
            creator: env.creator,
            opponent: env.opponent,
            randomness_request: env.request,
            platform_config: env.config,
            treasury: env.treasury,
        }
        .to_account_metas(None),
    );
    let blockhash = env.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&env.caller.pubkey()), &blockhash);
    VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&env.caller]).unwrap()
}

fn settle(env: &mut Env) -> bool {
    let tx = settle_tx(env);
    env.svm.send_transaction(tx).is_ok()
}

fn balance(svm: &LiteSVM, who: &Pubkey) -> u64 {
    svm.get_account(who).map(|a| a.lamports).unwrap_or(0)
}

fn battle_state(svm: &LiteSVM, battle: &Pubkey) -> Battle {
    let acc = svm.get_account(battle).unwrap();
    let mut data: &[u8] = &acc.data;
    Battle::try_deserialize(&mut data).unwrap()
}

/// The battle account is closed (no lamports, no data) once settled or refunded.
fn is_closed(svm: &LiteSVM, battle: &Pubkey) -> bool {
    svm.get_account(battle).map_or(true, |a| a.lamports == 0 && a.data.is_empty())
}

fn assert_nothing_moved(env: &Env) {
    assert_eq!(balance(&env.svm, &env.creator), 0);
    assert_eq!(balance(&env.svm, &env.opponent), 0);
    assert_eq!(balance(&env.svm, &env.treasury), 0);
    assert_eq!(balance(&env.svm, &env.battle), env.battle_rent + 2 * STAKE);
}

#[test]
fn winner_follows_lowest_bit_of_randomness() {
    for b in [0u8, 1, 2, 3, 254, 255] {
        let mut env = setup(b, Req::Fulfilled, BattleStatus::RandomnessPending);
        assert!(settle(&mut env), "settle failed for byte {b}");

        let opponent_wins = b & 1 == 1;
        let (winner, loser) = if opponent_wins {
            (env.opponent, env.creator)
        } else {
            (env.creator, env.opponent)
        };

        // The creator always gets the battle's rent reserve back on close.
        let rent_back = |who: Pubkey| if who == env.creator { env.battle_rent } else { 0 };
        assert_eq!(balance(&env.svm, &winner), PAYOUT + rent_back(winner));
        assert_eq!(balance(&env.svm, &loser), rent_back(loser));
        assert_eq!(balance(&env.svm, &env.treasury), FEE);
        assert!(is_closed(&env.svm, &env.battle), "battle account should be closed");
    }
}

#[test]
fn payout_and_fee_add_up_to_the_pot() {
    let mut env = setup(0, Req::Fulfilled, BattleStatus::RandomnessPending);
    assert!(settle(&mut env));
    let total = balance(&env.svm, &env.creator)
        + balance(&env.svm, &env.opponent)
        + balance(&env.svm, &env.treasury);
    assert_eq!(total, 2 * STAKE + env.battle_rent);
    assert_eq!(balance(&env.svm, &env.battle), 0);
}

#[test]
fn cannot_settle_before_randomness_is_fulfilled() {
    let mut env = setup(0, Req::Pending, BattleStatus::RandomnessPending);
    assert!(!settle(&mut env));
    assert_nothing_moved(&env);
    assert_eq!(
        battle_state(&env.svm, &env.battle).status,
        BattleStatus::RandomnessPending
    );
}

#[test]
fn cannot_settle_with_request_from_wrong_client() {
    let mut env = setup(0, Req::WrongClient, BattleStatus::RandomnessPending);
    assert!(!settle(&mut env));
    assert_nothing_moved(&env);
}

#[test]
fn cannot_settle_battle_that_is_not_pending() {
    let mut env = setup(0, Req::Fulfilled, BattleStatus::Open);
    assert!(!settle(&mut env));
    assert_nothing_moved(&env);
}

#[test]
fn cannot_settle_twice() {
    let mut env = setup(0, Req::Fulfilled, BattleStatus::RandomnessPending);
    assert!(settle(&mut env));
    env.svm.expire_blockhash();
    assert!(!settle(&mut env));
    // Still exactly one payout (plus the rent refund from closing).
    assert_eq!(balance(&env.svm, &env.creator), PAYOUT + env.battle_rent);
    assert_eq!(balance(&env.svm, &env.treasury), FEE);
}

#[test]
fn cannot_redirect_payout_to_wrong_treasury_or_opponent() {
    let mut env = setup(0, Req::Fulfilled, BattleStatus::RandomnessPending);
    let real_treasury = env.treasury;
    env.treasury = key();
    assert!(!settle(&mut env));
    env.treasury = real_treasury;

    let real_opponent = env.opponent;
    env.opponent = key();
    assert!(!settle(&mut env));
    env.opponent = real_opponent;

    assert_nothing_moved(&env);
}

fn refund_tx(env: &Env) -> VersionedTransaction {
    let ix = Instruction::new_with_bytes(
        degenwild::id(),
        &degenwild::instruction::RefundExpiredBattle {}.data(),
        degenwild::accounts::RefundExpiredBattle {
            battle: env.battle,
            creator: env.creator,
            opponent: env.opponent,
            randomness_request: env.request,
        }
        .to_account_metas(None),
    );
    let blockhash = env.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&env.caller.pubkey()), &blockhash);
    VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&env.caller]).unwrap()
}

fn refund(env: &mut Env) -> bool {
    let tx = refund_tx(env);
    env.svm.send_transaction(tx).is_ok()
}

const JOINED_AT: u64 = 100;
const TIMEOUT: u64 = degenwild::constants::REFUND_TIMEOUT_SLOTS;

#[test]
fn creator_side_decides_the_winner() {
    // Creator picked Tails (1): coin 1 -> creator wins.
    let mut env = setup_side(1, Req::Fulfilled, BattleStatus::RandomnessPending, 1, 0);
    assert!(settle(&mut env));
    assert_eq!(balance(&env.svm, &env.creator), PAYOUT + env.battle_rent);
    assert_eq!(balance(&env.svm, &env.opponent), 0);

    // Creator picked Tails (1): coin 0 -> opponent wins.
    let mut env = setup_side(0, Req::Fulfilled, BattleStatus::RandomnessPending, 1, 0);
    assert!(settle(&mut env));
    assert_eq!(balance(&env.svm, &env.opponent), PAYOUT);
    assert_eq!(balance(&env.svm, &env.creator), env.battle_rent);

    // Creator picked Heads (0): coin 0 -> creator wins.
    let mut env = setup_side(0, Req::Fulfilled, BattleStatus::RandomnessPending, 0, 0);
    assert!(settle(&mut env));
    assert_eq!(balance(&env.svm, &env.creator), PAYOUT + env.battle_rent);
}

#[test]
fn refund_returns_both_stakes_after_timeout() {
    let mut env = setup_side(0, Req::Pending, BattleStatus::RandomnessPending, 0, JOINED_AT);
    env.svm.warp_to_slot(JOINED_AT + TIMEOUT);
    assert!(refund(&mut env));

    assert_eq!(balance(&env.svm, &env.creator), STAKE + env.battle_rent);
    assert_eq!(balance(&env.svm, &env.opponent), STAKE);
    assert_eq!(balance(&env.svm, &env.treasury), 0);
    assert!(is_closed(&env.svm, &env.battle), "battle account should be closed");
}

#[test]
fn cannot_refund_before_timeout() {
    let mut env = setup_side(0, Req::Pending, BattleStatus::RandomnessPending, 0, JOINED_AT);
    env.svm.warp_to_slot(JOINED_AT + TIMEOUT - 1);
    assert!(!refund(&mut env));
    assert_nothing_moved(&env);
}

#[test]
fn cannot_refund_when_randomness_is_fulfilled() {
    let mut env = setup_side(0, Req::Fulfilled, BattleStatus::RandomnessPending, 0, JOINED_AT);
    env.svm.warp_to_slot(JOINED_AT + TIMEOUT + 10_000);
    assert!(!refund(&mut env));
    assert_nothing_moved(&env);

    // Settlement still works.
    env.svm.expire_blockhash();
    assert!(settle(&mut env));
    assert_eq!(balance(&env.svm, &env.creator), PAYOUT + env.battle_rent);
}

#[test]
fn cannot_refund_twice() {
    let mut env = setup_side(0, Req::Pending, BattleStatus::RandomnessPending, 0, JOINED_AT);
    env.svm.warp_to_slot(JOINED_AT + TIMEOUT);
    assert!(refund(&mut env));
    env.svm.expire_blockhash();
    assert!(!refund(&mut env));
    assert_eq!(balance(&env.svm, &env.creator), STAKE + env.battle_rent);
    assert_eq!(balance(&env.svm, &env.opponent), STAKE);
}
