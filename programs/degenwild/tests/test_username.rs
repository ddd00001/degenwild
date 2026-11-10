use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    degenwild::{
        constants::{PLATFORM_ADMIN, PROFILE_SEED, USERNAME_SEED},
        state::{Profile, UsernameClaim},
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const SOL: u64 = 1_000_000_000;

fn setup() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/degenwild.so"));
    svm.add_program(degenwild::id(), bytes).unwrap();
    svm
}

fn player(svm: &mut LiteSVM) -> Keypair {
    let kp = Keypair::new();
    svm.airdrop(&kp.pubkey(), SOL).unwrap();
    kp
}

fn profile_pda(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PROFILE_SEED, owner.as_ref()], &degenwild::id()).0
}

fn claim_pda(name: &str) -> Pubkey {
    Pubkey::find_program_address(&[USERNAME_SEED, name.to_ascii_lowercase().as_bytes()], &degenwild::id()).0
}

fn send(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair, signers: &[&Keypair]) -> bool {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx).is_ok()
}

fn create(svm: &mut LiteSVM, owner: &Keypair, name: &str) -> bool {
    let ix = Instruction::new_with_bytes(
        degenwild::id(),
        &degenwild::instruction::CreateProfile { username: name.to_string() }.data(),
        degenwild::accounts::CreateProfile {
            owner: owner.pubkey(),
            profile: profile_pda(&owner.pubkey()),
            username_claim: claim_pda(name),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, ix, owner, &[owner])
}

fn change(svm: &mut LiteSVM, owner: &Keypair, old: &str, new: &str) -> bool {
    let ix = Instruction::new_with_bytes(
        degenwild::id(),
        &degenwild::instruction::ChangeUsername { new_username: new.to_string() }.data(),
        degenwild::accounts::ChangeUsername {
            owner: owner.pubkey(),
            profile: profile_pda(&owner.pubkey()),
            old_claim: claim_pda(old),
            new_claim: claim_pda(new),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, ix, owner, &[owner])
}

fn delete(svm: &mut LiteSVM, owner: &Keypair, name: &str) -> bool {
    let ix = Instruction::new_with_bytes(
        degenwild::id(),
        &degenwild::instruction::DeleteProfile {}.data(),
        degenwild::accounts::DeleteProfile {
            owner: owner.pubkey(),
            profile: profile_pda(&owner.pubkey()),
            username_claim: claim_pda(name),
        }
        .to_account_metas(None),
    );
    send(svm, ix, owner, &[owner])
}

fn admin_remove(svm: &mut LiteSVM, admin: &Keypair, owner: &Pubkey, name: &str) -> bool {
    let ix = Instruction::new_with_bytes(
        degenwild::id(),
        &degenwild::instruction::AdminRemoveUsername {}.data(),
        degenwild::accounts::AdminRemoveUsername {
            admin: admin.pubkey(),
            owner: *owner,
            profile: profile_pda(owner),
            username_claim: claim_pda(name),
        }
        .to_account_metas(None),
    );
    send(svm, ix, admin, &[admin])
}

fn username_of(svm: &LiteSVM, owner: &Pubkey) -> Option<String> {
    let acc = svm.get_account(&profile_pda(owner))?;
    if acc.data.is_empty() {
        return None;
    }
    let mut data: &[u8] = &acc.data;
    Some(Profile::try_deserialize(&mut data).unwrap().username)
}

fn claim_owner(svm: &LiteSVM, name: &str) -> Option<Pubkey> {
    let acc = svm.get_account(&claim_pda(name))?;
    if acc.data.is_empty() {
        return None;
    }
    let mut data: &[u8] = &acc.data;
    Some(UsernameClaim::try_deserialize(&mut data).unwrap().owner)
}

fn balance(svm: &LiteSVM, who: &Pubkey) -> u64 {
    svm.get_account(who).map(|a| a.lamports).unwrap_or(0)
}

#[test]
fn create_profile_stores_name_with_original_casing() {
    let mut svm = setup();
    let alice = player(&mut svm);
    assert!(create(&mut svm, &alice, "DegenLord"));
    assert_eq!(username_of(&svm, &alice.pubkey()).as_deref(), Some("DegenLord"));
    assert_eq!(claim_owner(&svm, "degenlord"), Some(alice.pubkey()));
}

#[test]
fn usernames_are_unique_ignoring_case() {
    let mut svm = setup();
    let alice = player(&mut svm);
    let bob = player(&mut svm);
    assert!(create(&mut svm, &alice, "DegenLord"));
    assert!(!create(&mut svm, &bob, "degenlord"));
    assert!(!create(&mut svm, &bob, "DEGENLORD"));
    assert_eq!(username_of(&svm, &bob.pubkey()), None);
}

#[test]
fn one_profile_per_wallet() {
    let mut svm = setup();
    let alice = player(&mut svm);
    assert!(create(&mut svm, &alice, "first_name"));
    assert!(!create(&mut svm, &alice, "second_name"));
    assert_eq!(claim_owner(&svm, "second_name"), None);
}

#[test]
fn rejects_bad_lengths_and_characters() {
    let mut svm = setup();
    let alice = player(&mut svm);
    for bad in ["ab", "seventeen_chars_x", "has space", "dash-name", "emoji😀", "dot.name", ""] {
        assert!(!create(&mut svm, &alice, bad), "{bad:?} should be rejected");
    }
    assert!(create(&mut svm, &alice, "abc"));
    let bob = player(&mut svm);
    assert!(create(&mut svm, &bob, "sixteen_chars_xx"));
}

#[test]
fn rejects_reserved_names() {
    let mut svm = setup();
    let alice = player(&mut svm);
    for bad in ["admin", "Support", "MOD", "DegenWild", "degen_wild_real", "the_admin_guy", "official"] {
        assert!(!create(&mut svm, &alice, bad), "{bad:?} should be reserved");
    }
}

#[test]
fn change_username_releases_the_old_name() {
    let mut svm = setup();
    let alice = player(&mut svm);
    let bob = player(&mut svm);
    assert!(create(&mut svm, &alice, "OldName"));
    assert!(change(&mut svm, &alice, "OldName", "NewName"));
    assert_eq!(username_of(&svm, &alice.pubkey()).as_deref(), Some("NewName"));
    assert_eq!(claim_owner(&svm, "oldname"), None);
    // Someone else can now take the old name.
    assert!(create(&mut svm, &bob, "oldname"));
}

#[test]
fn cannot_change_to_a_taken_or_invalid_name() {
    let mut svm = setup();
    let alice = player(&mut svm);
    let bob = player(&mut svm);
    assert!(create(&mut svm, &alice, "alice"));
    assert!(create(&mut svm, &bob, "bob"));
    assert!(!change(&mut svm, &bob, "bob", "ALICE"));
    assert!(!change(&mut svm, &bob, "bob", "no"));
    assert!(!change(&mut svm, &bob, "bob", "admin"));
    assert_eq!(username_of(&svm, &bob.pubkey()).as_deref(), Some("bob"));
}

#[test]
fn cannot_change_someone_elses_name() {
    let mut svm = setup();
    let alice = player(&mut svm);
    let mallory = player(&mut svm);
    assert!(create(&mut svm, &alice, "alice"));
    // Mallory has no profile, and alice's profile PDA doesn't match mallory's key.
    let ix = Instruction::new_with_bytes(
        degenwild::id(),
        &degenwild::instruction::ChangeUsername { new_username: "stolen".into() }.data(),
        degenwild::accounts::ChangeUsername {
            owner: mallory.pubkey(),
            profile: profile_pda(&alice.pubkey()),
            old_claim: claim_pda("alice"),
            new_claim: claim_pda("stolen"),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    assert!(!send(&mut svm, ix, &mallory, &[&mallory]));
    assert_eq!(username_of(&svm, &alice.pubkey()).as_deref(), Some("alice"));
}

#[test]
fn delete_profile_refunds_all_rent() {
    let mut svm = setup();
    let alice = player(&mut svm);
    let before = balance(&svm, &alice.pubkey());
    assert!(create(&mut svm, &alice, "alice"));
    assert!(delete(&mut svm, &alice, "alice"));
    // Only the two transaction fees are gone.
    assert_eq!(before - balance(&svm, &alice.pubkey()), 2 * 5000);
    assert_eq!(username_of(&svm, &alice.pubkey()), None);
    assert_eq!(claim_owner(&svm, "alice"), None);
}

#[test]
fn only_platform_admin_can_remove_a_name() {
    let mut svm = setup();
    let alice = player(&mut svm);
    let mallory = player(&mut svm);
    assert!(create(&mut svm, &alice, "rude_name"));
    assert!(!admin_remove(&mut svm, &mallory, &alice.pubkey(), "rude_name"));
    assert_eq!(username_of(&svm, &alice.pubkey()).as_deref(), Some("rude_name"));
    assert_ne!(PLATFORM_ADMIN, mallory.pubkey());
}

#[test]
fn creating_a_profile_costs_only_rent() {
    let mut svm = setup();
    let alice = player(&mut svm);
    let before = balance(&svm, &alice.pubkey());
    assert!(create(&mut svm, &alice, "alice"));
    let spent = before - balance(&svm, &alice.pubkey());
    let rent = balance(&svm, &profile_pda(&alice.pubkey())) + balance(&svm, &claim_pda("alice"));
    assert_eq!(spent, rent + 5000);
    println!("profile + claim rent: {rent} lamports");
}
