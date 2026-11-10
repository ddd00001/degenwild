import {
  type Address,
  type Instruction,
  type TransactionSigner,
  fetchEncodedAccount,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  getU64Decoder,
  getU64Encoder,
  getUtf8Encoder,
  isSome,
} from '@solana/kit';
import {
  BATTLE_DISCRIMINATOR,
  DEGENWILD_PROGRAM_ADDRESS,
  type Battle,
  fetchMaybePlatformConfig,
  findBattlePda,
  findPlatformConfigPda,
  getBattleDecoder,
  getCancelBattleInstruction,
  getCreateBattleInstructionAsync,
  getJoinBattleInstructionAsync,
  getRefundExpiredBattleInstruction,
  getSettleBattleInstructionAsync,
  findProfilePda,
  findUsernameClaimPda,
  getChangeUsernameInstructionAsync,
  getCreateProfileInstructionAsync,
  getDeleteProfileInstructionAsync,
  getProfileDecoder,
  getProfileDiscriminatorBytes,
  getInitializePlatformConfigInstructionAsync,
} from './generated';
import { COINFLIP_FEE_BPS, ORAO_VRF_PROGRAM, REFUND_TIMEOUT_SLOTS } from './config';
import type { AppClient } from './client';
import PROGRAM_ERRORS from './program-errors.json';

const programError = (code: number) =>
  ((PROGRAM_ERRORS as Record<string, string>)[code] ?? `Program error ${code}`).replace(/ORAO randomness/g, 'The fair result');

type Rpc = AppClient['rpc'];

export type BattleView = Battle & { address: Address };

const utf8 = getUtf8Encoder();
const addrEnc = getAddressEncoder();
const addrDec = getAddressDecoder();

// ---------------------------------------------------------------- reads

/** wallet -> DEGEN WILD username, for every profile on chain. */
export async function fetchAllUsernames(rpc: Rpc): Promise<Map<Address, string>> {
  const accounts = await rpc
    .getProgramAccounts(DEGENWILD_PROGRAM_ADDRESS, {
      encoding: 'base64',
      commitment: 'confirmed',
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: getBase58Decoder().decode(getProfileDiscriminatorBytes()) as never,
            encoding: 'base58',
          },
        },
      ],
    })
    .send();
  const decoder = getProfileDecoder();
  const b64 = getBase64Encoder();
  const names = new Map<Address, string>();
  for (const { account } of accounts) {
    try {
      const p = decoder.decode(b64.encode(account.data[0]));
      // On-chain data is untrusted: only show names that pass the same rules the program enforces.
      if (validateUsername(p.username) === null) names.set(p.owner, p.username);
    } catch {
      /* not a profile */
    }
  }
  return names;
}

/** All Battle accounts owned by the program. Data is decoded and owner-checked. */
export async function fetchAllBattles(rpc: Rpc): Promise<BattleView[]> {
  const accounts = await rpc
    .getProgramAccounts(DEGENWILD_PROGRAM_ADDRESS, {
      encoding: 'base64',
      commitment: 'confirmed',
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: getBase58Decoder().decode(BATTLE_DISCRIMINATOR) as never,
            encoding: 'base58',
          },
        },
      ],
    })
    .send();

  const decoder = getBattleDecoder();
  const b64 = getBase64Encoder();
  const out: BattleView[] = [];
  for (const { pubkey, account } of accounts) {
    try {
      const bytes = b64.encode(account.data[0]);
      out.push({ ...decoder.decode(bytes), address: pubkey });
    } catch {
      // Skip anything that does not decode as a Battle.
    }
  }
  return out.sort((a, b) => Number(b.battleId - a.battleId));
}

export type OraoNetwork = { treasury: Address; requestFee: bigint };

/** ORAO NetworkState: 8-byte discriminator, then authority (32), treasury (32), request_fee (u64). */
export async function fetchOraoNetwork(rpc: Rpc): Promise<OraoNetwork> {
  const [networkState] = await getProgramDerivedAddress({
    programAddress: ORAO_VRF_PROGRAM,
    seeds: [utf8.encode('orao-vrf-network-configuration')],
  });
  const acc = await fetchEncodedAccount(rpc, networkState, { commitment: 'confirmed' });
  if (!acc.exists) throw new Error('The randomness network is not available on this cluster.');
  if (acc.programAddress !== ORAO_VRF_PROGRAM) throw new Error('The randomness network returned unexpected data.');
  const d = acc.data;
  return {
    treasury: addrDec.decode(d.slice(40, 72)),
    requestFee: getU64Decoder().decode(d.slice(72, 80)),
  };
}

export type Randomness =
  | { state: 'missing' }
  | { state: 'pending' }
  | { state: 'fulfilled'; coin: 0 | 1 };

/** ORAO RandomnessV2: 8-byte discriminator, enum tag (0 pending / 1 fulfilled), client, seed, randomness[64]. */
export async function fetchRandomness(rpc: Rpc, account: Address): Promise<Randomness> {
  const acc = await fetchEncodedAccount(rpc, account, { commitment: 'confirmed' });
  if (!acc.exists || acc.programAddress !== ORAO_VRF_PROGRAM) return { state: 'missing' };
  const d = acc.data;
  if (d[8] !== 1) return { state: 'pending' };
  const randomness = d.slice(9 + 64, 9 + 64 + 64);
  return { state: 'fulfilled', coin: (randomness[0] & 1) as 0 | 1 };
}

export async function fetchTreasury(rpc: Rpc): Promise<Address | null> {
  const [pda] = await findPlatformConfigPda();
  const cfg = await fetchMaybePlatformConfig(rpc, pda, { commitment: 'confirmed' });
  return cfg.exists ? cfg.data.treasury : null;
}

// ---------------------------------------------------------------- helpers

export const opponentOf = (b: Battle): Address | null => (isSome(b.opponent) ? b.opponent.value : null);
export const winnerOf = (b: Battle): Address | null => (isSome(b.winner) ? b.winner.value : null);

export function payoutFor(stake: bigint): { pot: bigint; fee: bigint; payout: bigint } {
  const pot = stake * 2n;
  const fee = (pot * COINFLIP_FEE_BPS) / 10_000n;
  return { pot, fee, payout: pot - fee };
}

export const refundDeadline = (b: Battle): bigint => b.joinedSlot + REFUND_TIMEOUT_SLOTS;



// ---------------------------------------------------------------- instructions

export async function buildCreate(creator: TransactionSigner, amount: bigint, side: 0 | 1) {
  const battleId = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  const ix = await getCreateBattleInstructionAsync({ creator, battleId, amount, creatorSide: side });
  const [battle] = await findBattlePda({ creator: creator.address, battleId });
  return { ix: ix as Instruction, battle };
}

/** Mirrors the seed derivation in join_battle.rs. */
async function joinSeed(battle: BattleView, opponent: Address): Promise<Uint8Array> {
  const [seedAddr] = await getProgramDerivedAddress({
    programAddress: DEGENWILD_PROGRAM_ADDRESS,
    seeds: [
      utf8.encode('degenwild-coinflip-v1'),
      addrEnc.encode(battle.address),
      getU64Encoder().encode(battle.battleId),
      addrEnc.encode(opponent),
    ],
  });
  return new Uint8Array(addrEnc.encode(seedAddr));
}

export async function buildJoin(rpc: Rpc, opponent: TransactionSigner, battle: BattleView) {
  const orao = await fetchOraoNetwork(rpc);
  const seed = await joinSeed(battle, opponent.address);
  const [randomnessRequest] = await getProgramDerivedAddress({
    programAddress: ORAO_VRF_PROGRAM,
    seeds: [utf8.encode('orao-vrf-randomness-request'), seed],
  });
  const ix = await getJoinBattleInstructionAsync({
    opponent,
    battle: battle.address,
    oraoTreasury: orao.treasury,
    randomnessRequest,
    amount: battle.amount,
  });
  return ix as Instruction;
}

export function buildCancel(creator: TransactionSigner, battle: BattleView) {
  return getCancelBattleInstruction({ creator, battle: battle.address }) as Instruction;
}

export async function buildSettle(rpc: Rpc, battle: BattleView) {
  const treasury = await fetchTreasury(rpc);
  const opponent = opponentOf(battle);
  if (!treasury) throw new Error('Platform config is not initialized yet — the admin must run initialize_platform_config.');
  if (!opponent) throw new Error('Battle has no opponent.');
  return (await getSettleBattleInstructionAsync({
    battle: battle.address,
    creator: battle.creator,
    opponent,
    randomnessRequest: battle.randomnessAccount,
    treasury,
  })) as Instruction;
}

export function buildRefund(battle: BattleView) {
  const opponent = opponentOf(battle);
  if (!opponent) throw new Error('Battle has no opponent.');
  return getRefundExpiredBattleInstruction({
    battle: battle.address,
    creator: battle.creator,
    opponent,
    randomnessRequest: battle.randomnessAccount,
  }) as Instruction;
}

// ---------------------------------------------------------------- errors

/** Turns RPC / wallet / program failures into something a player can act on. */
export function describeError(err: unknown): string {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  const messages: string[] = [];
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const e = cur as { message?: string; context?: { code?: unknown; logs?: string[] }; cause?: unknown };
    if (typeof e.context?.code === 'number' && e.context.code >= 6000 && e.context.code < 6100) {
      return programError(e.context.code);
    }
    if (e.message) messages.push(e.message);
    cur = e.cause;
  }
  const all = messages.join(' | ');
  const custom = all.match(/custom program error: (0x[0-9a-f]+|\d+)/i);
  if (custom) {
    const code = Number(custom[1]);
    if (code >= 6000) return programError(code);
  }
  if (/reject|denied|cancel/i.test(all)) return 'You rejected the request in your wallet.';
  if (/insufficient (funds|lamports)|0x1\b/i.test(all)) return 'Not enough SOL for the stake plus fees.';
  if (/blockhash|expired/i.test(all)) return 'Transaction expired before it landed — try again.';
  if (/program that does not exist|ProgramAccountNotFound|invalid program/i.test(all))
    return 'The DEGEN WILD program is not deployed on this cluster yet.';
  return messages[0] ?? 'Something went wrong.';
}

// ---------------------------------------------------------------- usernames

// Mirrors programs/degenwild/src/constants.rs + instructions/username.rs.
const RESERVED = ['support', 'mod', 'moderator', 'official', 'team', 'staff', 'system', 'dev', 'owner', 'help'];
const RESERVED_FRAGMENTS = ['degenwild', 'degen_wild', 'admin'];

/** Returns an error message, or null if the program will accept this name. */
export function validateUsername(name: string): string | null {
  if (name.length < 3 || name.length > 16) return 'Username must be 3–16 characters.';
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'Only letters, numbers and underscores.';
  const key = name.toLowerCase();
  if (RESERVED.includes(key) || RESERVED_FRAGMENTS.some((f) => key.includes(f))) return 'That username is reserved.';
  return null;
}

/** The claim PDA is keyed by the lowercase name; the generated helper would use it as typed. */
const claimFor = async (name: string) => (await findUsernameClaimPda({ username: name.toLowerCase() }))[0];

export async function isUsernameTaken(rpc: Rpc, name: string): Promise<boolean> {
  const acc = await fetchEncodedAccount(rpc, await claimFor(name), { commitment: 'confirmed' });
  return acc.exists;
}

export async function buildCreateProfile(owner: TransactionSigner, username: string) {
  return (await getCreateProfileInstructionAsync({
    owner,
    usernameClaim: await claimFor(username),
    username,
  })) as Instruction;
}

export async function buildChangeUsername(owner: TransactionSigner, oldName: string, newName: string) {
  return (await getChangeUsernameInstructionAsync({
    owner,
    oldClaim: await claimFor(oldName),
    newClaim: await claimFor(newName),
    newUsername: newName,
  })) as Instruction;
}

export async function buildDeleteProfile(owner: TransactionSigner, name: string) {
  return (await getDeleteProfileInstructionAsync({ owner, usernameClaim: await claimFor(name) })) as Instruction;
}

export async function profileAddress(owner: Address) {
  return (await findProfilePda({ owner }))[0];
}

/** Admin only: creates the platform config (treasury starts as the admin wallet). */
export async function buildInitPlatform(admin: TransactionSigner) {
  return (await getInitializePlatformConfigInstructionAsync({ admin })) as Instruction;
}
