use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{
            instruction::{AccountMeta, Instruction},
            system_program,
        },
        AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas,
    },
    degenwild::{
        constants::{JACKPOT_COUNTDOWN_SECS, JACKPOT_ROUND_SEED, JACKPOT_STATE_SEED, PLATFORM_CONFIG_SEED},
        state::{JackpotEntry, JackpotRound, JackpotState, JackpotStatus, PlatformConfig},
    },
    litesvm::LiteSVM,
    orao_solana_vrf::state::{FulfilledRequest, PendingRequest, RandomnessV2, RequestAccount},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const SOL: u64 = 1_000_000_000;

fn svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/degenwild.so"));
    svm.add_program(degenwild::id(), bytes).unwrap();
    svm
}

fn funded(svm: &mut LiteSVM, sol: u64) -> Keypair {
    let k = Keypair::new();
    svm.airdrop(&k.pubkey(), sol * SOL).unwrap();
    k
}

fn state_pda() -> Pubkey {
    Pubkey::find_program_address(&[JACKPOT_STATE_SEED], &degenwild::id()).0
}

fn round_pda(id: u64) -> Pubkey {
    Pubkey::find_program_address(&[JACKPOT_ROUND_SEED, &id.to_le_bytes()], &degenwild::id()).0
}

fn send(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair) -> Result<(), String> {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.err))
}

fn init(svm: &mut LiteSVM, payer: &Keypair) {
    let ix = Instruction::new_with_bytes(
        degenwild::id(),
        &degenwild::instruction::InitJackpot {}.data(),
        degenwild::accounts::InitJackpot {
            payer: payer.pubkey(),
            jackpot_state: state_pda(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, ix, payer).unwrap();
}

fn enter(svm: &mut LiteSVM, player: &Keypair, round_id: u64, amount: u64) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        degenwild::id(),
        &degenwild::instruction::EnterJackpot { amount }.data(),
        degenwild::accounts::EnterJackpot {
            player: player.pubkey(),
            jackpot_state: state_pda(),
            round: round_pda(round_id),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, ix, player)
}

fn leave(svm: &mut LiteSVM, player: &Keypair, round_id: u64) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        degenwild::id(),
        &degenwild::instruction::LeaveJackpot {}.data(),
        degenwild::accounts::LeaveJackpot {
            player: player.pubkey(),
            jackpot_state: state_pda(),
            round: round_pda(round_id),
        }
        .to_account_metas(None),
    );
    send(svm, ix, player)
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, key: &Pubkey) -> T {
    let acc = svm.get_account(key).unwrap();
    T::try_deserialize(&mut &acc.data[..]).unwrap()
}

fn balance(svm: &LiteSVM, key: &Pubkey) -> u64 {
    svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
}

fn closed(svm: &LiteSVM, key: &Pubkey) -> bool {
    svm.get_account(key).map_or(true, |a| a.lamports == 0 && a.data.is_empty())
}

fn set_time(svm: &mut LiteSVM, unix: i64, slot: u64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = unix;
    clock.slot = slot;
    svm.set_sysvar(&clock);
}

fn write<T: AccountSerialize>(svm: &mut LiteSVM, key: Pubkey, state: &T, lamports: u64, owner: Pubkey, len: usize) {
    let mut data = Vec::new();
    state.try_serialize(&mut data).unwrap();
    data.resize(len.max(data.len()), 0);
    svm.set_account(key, Account { lamports, data, owner, executable: false, rent_epoch: 0 })
        .unwrap();
}

// ---------------------------------------------------------------- entering

#[test]
fn entries_add_up_and_countdown_starts_at_second_player() {
    let mut svm = svm();
    set_time(&mut svm, 1_000, 10);
    let a = funded(&mut svm, 5);
    let b = funded(&mut svm, 5);
    let c = funded(&mut svm, 5);
    init(&mut svm, &a);

    enter(&mut svm, &a, 1, SOL).unwrap();
    let r: JackpotRound = read(&svm, &round_pda(1));
    assert_eq!(r.countdown_end, 0, "one player: no countdown yet");

    enter(&mut svm, &b, 1, 2 * SOL).unwrap();
    let r: JackpotRound = read(&svm, &round_pda(1));
    assert_eq!(r.countdown_end, 1_000 + JACKPOT_COUNTDOWN_SECS);

    enter(&mut svm, &c, 1, SOL / 2).unwrap();
    // Topping up merges into the same entry.
    enter(&mut svm, &a, 1, SOL / 10).unwrap();
    let r: JackpotRound = read(&svm, &round_pda(1));
    assert_eq!(r.entries.len(), 3);
    assert_eq!(r.entries[0].amount, SOL + SOL / 10);
    assert_eq!(r.total, 3_600_000_000);
    let rent = svm.minimum_balance_for_rent_exemption(8 + JackpotRound::INIT_SPACE);
    assert_eq!(balance(&svm, &round_pda(1)), rent + r.total);
}

#[test]
fn entries_close_when_countdown_ends() {
    let mut svm = svm();
    set_time(&mut svm, 1_000, 10);
    let a = funded(&mut svm, 5);
    let b = funded(&mut svm, 5);
    let c = funded(&mut svm, 5);
    init(&mut svm, &a);
    enter(&mut svm, &a, 1, SOL).unwrap();
    enter(&mut svm, &b, 1, SOL).unwrap();
    set_time(&mut svm, 1_000 + JACKPOT_COUNTDOWN_SECS, 20);
    assert!(enter(&mut svm, &c, 1, SOL).is_err());
}

#[test]
fn entry_limits_are_enforced() {
    let mut svm = svm();
    let a = funded(&mut svm, 20);
    init(&mut svm, &a);
    assert!(enter(&mut svm, &a, 1, 49_999_999).is_err(), "below 0.05 SOL");
    assert!(enter(&mut svm, &a, 1, 10_000_000).is_err(), "old 0.01 SOL minimum is gone");
    assert!(enter(&mut svm, &a, 1, 10 * SOL + 1).is_err(), "above 10 SOL");
}

#[test]
fn lone_player_can_leave_before_countdown() {
    let mut svm = svm();
    let a = funded(&mut svm, 5);
    init(&mut svm, &a);
    let before = balance(&svm, &a.pubkey());
    enter(&mut svm, &a, 1, SOL).unwrap();
    leave(&mut svm, &a, 1).unwrap();
    assert!(closed(&svm, &round_pda(1)));
    // Everything back except two tx fees.
    assert_eq!(balance(&svm, &a.pubkey()), before - 10_000);
}

#[test]
fn cannot_leave_once_someone_else_joined() {
    let mut svm = svm();
    let a = funded(&mut svm, 5);
    let b = funded(&mut svm, 5);
    init(&mut svm, &a);
    enter(&mut svm, &a, 1, SOL).unwrap();
    enter(&mut svm, &b, 1, SOL).unwrap();
    assert!(leave(&mut svm, &a, 1).is_err());
    assert!(leave(&mut svm, &b, 1).is_err());
}

// ---------------------------------------------------------------- settling

struct Drawn {
    svm: LiteSVM,
    caller: Keypair,
    players: [Pubkey; 3],
    treasury: Pubkey,
    request: Pubkey,
    config: Pubkey,
    rent: u64,
}

/// A round in Drawing with entries 1 / 2 / 0.5 SOL and a fake ORAO account.
fn drawn(ticket: u64, fulfilled: bool, drawn_slot: u64) -> Drawn {
    let mut svm = svm();
    let caller = funded(&mut svm, 1);
    let players = [Keypair::new().pubkey(), Keypair::new().pubkey(), Keypair::new().pubkey()];
    let treasury = Keypair::new().pubkey();
    let drawer = Keypair::new().pubkey();
    let seed = [9u8; 32];
    let request = Pubkey::find_program_address(&[b"orao-vrf-randomness-request", &seed], &orao_solana_vrf::ID).0;
    let (config, config_bump) = Pubkey::find_program_address(&[PLATFORM_CONFIG_SEED], &degenwild::id());

    let (state_key, state_bump) = Pubkey::find_program_address(&[JACKPOT_STATE_SEED], &degenwild::id());
    let st = JackpotState {
        current_round: 1,
        last_round: 0,
        last_winner: Pubkey::default(),
        last_total: 0,
        last_payout: 0,
        last_ticket: 0,
        bump: state_bump,
    };
    write(&mut svm, state_key, &st, 10_000_000, degenwild::id(), 8 + JackpotState::INIT_SPACE);

    let amounts = [SOL, 2 * SOL, SOL / 2];
    let total: u64 = amounts.iter().sum();
    let (round_key, round_bump) =
        Pubkey::find_program_address(&[JACKPOT_ROUND_SEED, &1u64.to_le_bytes()], &degenwild::id());
    let round = JackpotRound {
        round_id: 1,
        status: JackpotStatus::Drawing,
        total,
        countdown_end: 1,
        drawer,
        randomness_seed: seed,
        randomness_account: request,
        drawn_slot,
        entries: players.iter().zip(amounts).map(|(p, a)| JackpotEntry { player: *p, amount: a }).collect(),
        bump: round_bump,
    };
    let len = 8 + JackpotRound::INIT_SPACE;
    let rent = svm.minimum_balance_for_rent_exemption(len);
    write(&mut svm, round_key, &round, rent + total, degenwild::id(), len);

    let cfg = PlatformConfig {
        admin: Keypair::new().pubkey(),
        treasury,
        coinflip_fee_bps: degenwild::constants::COINFLIP_FEE_BPS as u16,
        bump: config_bump,
    };
    write(&mut svm, config, &cfg, 10_000_000, degenwild::id(), 8 + PlatformConfig::INIT_SPACE);

    // Randomness whose first 16 bytes (LE u128) equal `ticket` -> ticket % total == ticket.
    let mut randomness = [0u8; 64];
    randomness[0..8].copy_from_slice(&ticket.to_le_bytes());
    let req = if fulfilled {
        RequestAccount::Fulfilled(FulfilledRequest { client: drawer, seed, randomness })
    } else {
        RequestAccount::Pending(PendingRequest { client: drawer, seed, responses: vec![] })
    };
    write(&mut svm, request, &RandomnessV2 { request: req }, 10_000_000, orao_solana_vrf::ID, 0);

    Drawn { svm, caller, players, treasury, request, config, rent }
}

fn settle(d: &mut Drawn, extra: &[Pubkey]) -> Result<(), String> {
    let mut metas = degenwild::accounts::SettleJackpot {
        jackpot_state: state_pda(),
        round: round_pda(1),
        randomness_request: d.request,
        platform_config: d.config,
        treasury: d.treasury,
    }
    .to_account_metas(None);
    metas.extend(extra.iter().map(|k| AccountMeta::new(*k, false)));
    let ix = Instruction::new_with_bytes(degenwild::id(), &degenwild::instruction::SettleJackpot {}.data(), metas);
    let caller = d.caller.insecure_clone();
    send(&mut d.svm, ix, &caller)
}

#[test]
fn settle_pays_the_ticket_owner_minus_fee() {
    // Ticket 1.5 SOL lands in player 2's range [1, 3).
    let mut d = drawn(1_500_000_000, true, 0);
    let [p1, p2, _] = d.players;
    settle(&mut d, &[p2, p1]).unwrap();

    let total = 3_500_000_000u64;
    let fee = total * 350 / 10_000;
    assert_eq!(balance(&d.svm, &p2), total - fee);
    assert_eq!(balance(&d.svm, &d.treasury), fee);
    assert_eq!(balance(&d.svm, &p1), d.rent, "first entrant gets the rent back");
    assert!(closed(&d.svm, &round_pda(1)));

    let st: JackpotState = read(&d.svm, &state_pda());
    assert_eq!(st.current_round, 2);
    assert_eq!(st.last_winner, p2);
    assert_eq!(st.last_ticket, 1_500_000_000);
}

#[test]
fn first_entrant_can_win_and_get_rent_in_one_account() {
    let mut d = drawn(0, true, 0);
    let p1 = d.players[0];
    settle(&mut d, &[p1]).unwrap();
    let total = 3_500_000_000u64;
    assert_eq!(balance(&d.svm, &p1), total - total * 350 / 10_000 + d.rent);
}

#[test]
fn settle_rejects_the_wrong_winner() {
    let mut d = drawn(3_200_000_000, true, 0); // player 3 wins
    let [p1, p2, _] = d.players;
    assert!(settle(&mut d, &[p2, p1]).is_err());
    assert!(!closed(&d.svm, &round_pda(1)));
}

#[test]
fn settle_waits_for_randomness() {
    let mut d = drawn(0, false, 0);
    let p1 = d.players[0];
    assert!(settle(&mut d, &[p1]).is_err());
}

// ---------------------------------------------------------------- refund

fn refund(d: &mut Drawn, accounts: &[Pubkey]) -> Result<(), String> {
    let mut metas = degenwild::accounts::RefundJackpot {
        jackpot_state: state_pda(),
        round: round_pda(1),
        randomness_request: d.request,
    }
    .to_account_metas(None);
    metas.extend(accounts.iter().map(|k| AccountMeta::new(*k, false)));
    let ix = Instruction::new_with_bytes(degenwild::id(), &degenwild::instruction::RefundJackpot {}.data(), metas);
    let caller = d.caller.insecure_clone();
    send(&mut d.svm, ix, &caller)
}

#[test]
fn refund_returns_every_stake_after_timeout() {
    let mut d = drawn(0, false, 100);
    let p = d.players;
    set_time(&mut d.svm, 5_000, 100 + degenwild::constants::REFUND_TIMEOUT_SLOTS);
    refund(&mut d, &p).unwrap();
    assert_eq!(balance(&d.svm, &p[0]), SOL + d.rent);
    assert_eq!(balance(&d.svm, &p[1]), 2 * SOL);
    assert_eq!(balance(&d.svm, &p[2]), SOL / 2);
    assert!(closed(&d.svm, &round_pda(1)));
    let st: JackpotState = read(&d.svm, &state_pda());
    assert_eq!(st.current_round, 2);
}

#[test]
fn refund_is_blocked_before_timeout_or_after_fulfilment() {
    let mut early = drawn(0, false, 100);
    set_time(&mut early.svm, 5_000, 101);
    let p = early.players;
    assert!(refund(&mut early, &p).is_err());

    let mut done = drawn(0, true, 100);
    set_time(&mut done.svm, 5_000, 100 + degenwild::constants::REFUND_TIMEOUT_SLOTS);
    let p = done.players;
    assert!(refund(&mut done, &p).is_err());
}

#[test]
fn refund_rejects_wrong_player_list() {
    let mut d = drawn(0, false, 100);
    set_time(&mut d.svm, 5_000, 100 + degenwild::constants::REFUND_TIMEOUT_SLOTS);
    let [a, b, _] = d.players;
    let stranger = Keypair::new().pubkey();
    assert!(refund(&mut d, &[a, b, stranger]).is_err());
    assert!(refund(&mut d, &[a, b]).is_err());
}
