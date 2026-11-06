use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

fn setup() -> (LiteSVM, Keypair) {
    let creator = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/degenwild.so"
    ));
    svm.add_program(degenwild::id(), bytes).unwrap();
    svm.airdrop(&creator.pubkey(), 1_000_000_000).unwrap();
    (svm, creator)
}

fn battle_pda(creator: &Pubkey, battle_id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[
            degenwild::constants::BATTLE_SEED,
            creator.as_ref(),
            &battle_id.to_le_bytes(),
        ],
        &degenwild::id(),
    )
    .0
}

fn create_battle_tx(
    svm: &LiteSVM,
    creator: &Keypair,
    battle_id: u64,
    amount: u64,
) -> VersionedTransaction {
    let battle = battle_pda(&creator.pubkey(), battle_id);
    let ix = Instruction::new_with_bytes(
        degenwild::id(),
        &degenwild::instruction::CreateBattle { battle_id, amount }.data(),
        degenwild::accounts::CreateBattle {
            creator: creator.pubkey(),
            battle,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&creator.pubkey()), &blockhash);
    VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[creator]).unwrap()
}

#[test]
fn create_battle_escrows_stake() {
    let (mut svm, creator) = setup();
    let amount = 100_000_000; // 0.1 SOL

    let tx = create_battle_tx(&svm, &creator, 1, amount);
    assert!(svm.send_transaction(tx).is_ok());

    let battle = battle_pda(&creator.pubkey(), 1);
    let account = svm.get_account(&battle).unwrap();

    // The account holds the stake plus its rent deposit.
    assert!(account.lamports > amount);

    let mut data: &[u8] = &account.data;
    let state = degenwild::state::Battle::try_deserialize(&mut data).unwrap();
    assert_eq!(state.creator, creator.pubkey());
    assert_eq!(state.opponent, None);
    assert_eq!(state.amount, amount);
    assert_eq!(state.battle_id, 1);
    assert_eq!(state.status, degenwild::state::BattleStatus::Open);
}

#[test]
fn create_battle_rejects_stake_below_minimum() {
    let (mut svm, creator) = setup();

    let tx = create_battle_tx(&svm, &creator, 1, 1_000); // far below 0.01 SOL
    assert!(svm.send_transaction(tx).is_err());
}

fn join_battle_tx(
    svm: &LiteSVM,
    opponent: &Keypair,
    creator: &Pubkey,
    battle_id: u64,
    amount: u64,
) -> VersionedTransaction {
    let battle = battle_pda(creator, battle_id);

    let ix = Instruction::new_with_bytes(
        degenwild::id(),
        &degenwild::instruction::JoinBattle { amount }.data(),
        degenwild::accounts::JoinBattle {
            opponent: opponent.pubkey(),
            battle,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&opponent.pubkey()), &blockhash);

    VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[opponent]).unwrap()
}

#[test]
fn join_battle_escrows_opponent_stake() {
    let (mut svm, creator) = setup();
    let opponent = Keypair::new();
    let amount = 100_000_000;

    svm.airdrop(&opponent.pubkey(), 1_000_000_000).unwrap();

    let create_tx = create_battle_tx(&svm, &creator, 1, amount);
    assert!(svm.send_transaction(create_tx).is_ok());

    let battle = battle_pda(&creator.pubkey(), 1);
    let join_tx = join_battle_tx(&svm, &opponent, &creator.pubkey(), 1, amount);

    assert!(svm.send_transaction(join_tx).is_ok());

    let account = svm.get_account(&battle).unwrap();

    // Escrow now holds both stakes plus the account's rent reserve.
    assert!(account.lamports >= amount * 2);

    let mut data: &[u8] = &account.data;
    let state = degenwild::state::Battle::try_deserialize(&mut data).unwrap();

    assert_eq!(state.creator, creator.pubkey());
    assert_eq!(state.opponent, Some(opponent.pubkey()));
    assert_eq!(state.amount, amount);
    assert_eq!(state.status, degenwild::state::BattleStatus::Joined);
}

#[test]
fn creator_cannot_join_own_battle() {
    let (mut svm, creator) = setup();
    let amount = 100_000_000;

    let create_tx = create_battle_tx(&svm, &creator, 2, amount);
    assert!(svm.send_transaction(create_tx).is_ok());

    let join_tx = join_battle_tx(&svm, &creator, &creator.pubkey(), 2, amount);

    assert!(svm.send_transaction(join_tx).is_err());
}

#[test]
fn join_battle_rejects_incorrect_stake() {
    let (mut svm, creator) = setup();
    let opponent = Keypair::new();
    let amount = 100_000_000;

    svm.airdrop(&opponent.pubkey(), 1_000_000_000).unwrap();

    let create_tx = create_battle_tx(&svm, &creator, 3, amount);
    assert!(svm.send_transaction(create_tx).is_ok());

    let join_tx = join_battle_tx(&svm, &opponent, &creator.pubkey(), 3, amount + 1);

    assert!(svm.send_transaction(join_tx).is_err());
}

#[test]
fn join_battle_rejects_second_opponent() {
    let (mut svm, creator) = setup();
    let opponent = Keypair::new();
    let second_opponent = Keypair::new();
    let amount = 100_000_000;

    svm.airdrop(&opponent.pubkey(), 1_000_000_000).unwrap();
    svm.airdrop(&second_opponent.pubkey(), 1_000_000_000)
        .unwrap();

    let create_tx = create_battle_tx(&svm, &creator, 4, amount);
    assert!(svm.send_transaction(create_tx).is_ok());

    let first_join = join_battle_tx(&svm, &opponent, &creator.pubkey(), 4, amount);

    assert!(svm.send_transaction(first_join).is_ok());

    let second_join = join_battle_tx(&svm, &second_opponent, &creator.pubkey(), 4, amount);

    assert!(svm.send_transaction(second_join).is_err());
}
