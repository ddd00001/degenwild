import {
  AccountRole,
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
  type JackpotRound,
  type JackpotState,
  fetchMaybeJackpotRound,
  fetchMaybeJackpotState,
  findJackpotStatePda,
  getDrawJackpotInstructionAsync,
  getEnterJackpotInstructionAsync,
  getInitJackpotInstructionAsync,
  getLeaveJackpotInstructionAsync,
  getRefundJackpotInstructionAsync,
  getSettleJackpotInstructionAsync,
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

/** wallet -> DegenWild username, for every profile on chain. */
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

/** One battle by address (null if closed or not a battle). Much lighter than fetchAllBattles. */
export async function fetchBattle(rpc: Rpc, battle: Address): Promise<BattleView | null> {
  const acc = await fetchEncodedAccount(rpc, battle, { commitment: 'confirmed' });
  if (!acc.exists || acc.programAddress !== DEGENWILD_PROGRAM_ADDRESS) return null;
  try {
    return { ...getBattleDecoder().decode(acc.data), address: battle };
  } catch {
    return null;
  }
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

type ErrInfo = { codes: number[]; text: string; customCode?: number };

/**
 * Collects error codes, messages and simulation logs from an error and its causes.
 * Production builds of @solana/errors drop message text, so codes, `causeMessage` and logs matter most.
 */
function inspectError(err: unknown): ErrInfo {
  const codes: number[] = [];
  const parts: string[] = [];
  let customCode: number | undefined;
  const seen = new Set<unknown>();
  const stack: unknown[] = [err];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    const e = cur as { message?: unknown; cause?: unknown; context?: Record<string, unknown>; code?: unknown };
    if (typeof e.message === 'string') parts.push(e.message);
    if (typeof e.code === 'number') codes.push(e.code); // wallet errors, e.g. 4001 user rejected
    const ctx = e.context;
    if (ctx) {
      if (typeof ctx.__code === 'number') codes.push(ctx.__code);
      if (typeof ctx.code === 'number' && ctx.code >= 6000 && ctx.code < 7000) customCode = ctx.code;
      if (typeof ctx.causeMessage === 'string') parts.push(ctx.causeMessage);
      if (Array.isArray(ctx.logs)) parts.push(...ctx.logs.filter((l): l is string => typeof l === 'string'));
      if (ctx.cause) stack.push(ctx.cause);
    }
    stack.push(e.cause);
  }
  const text = parts.join(' | ');
  if (customCode === undefined) {
    const m = text.match(/custom program error: (0x[0-9a-f]+|\d+)/i);
    if (m && Number(m[1]) >= 6000) customCode = Number(m[1]);
  }
  return { codes, text, customCode };
}

// @solana/errors codes (stable across builds).
const C = {
  BLOCK_HEIGHT_EXCEEDED: 1,
  BLOCKHASH_NOT_FOUND: 7050008,
  ACCOUNT_NOT_FOUND: 7050003, // fee payer has never held SOL on this cluster
  INSUFFICIENT_FUNDS_FOR_FEE: 7050005,
  INSUFFICIENT_FUNDS_FOR_RENT: 7050031,
  INSTRUCTION_INSUFFICIENT_FUNDS: 4615006,
  PROGRAM_ACCOUNT_NOT_FOUND: 7050004,
  WALLET_NOT_CONNECTED: 8900000,
  WALLET_NO_SIGNER: 8900001,
  WALLET_VERSION_UNSUPPORTED: 8900007,
  CANNOT_SIGN: 5508012,
  RPC_HTTP_ERROR: 8100002,
  USER_REJECTED: 4001, // EIP-1193 / wallet-standard convention
};

/** True when the transaction's blockhash expired before it landed (so it can never land). */
export function isExpiredError(err: unknown): boolean {
  const { codes, text } = inspectError(err);
  return (
    codes.includes(C.BLOCK_HEIGHT_EXCEEDED) ||
    codes.includes(C.BLOCKHASH_NOT_FOUND) ||
    /progressed past the last block|block height exceeded|blockhash not found/i.test(text)
  );
}

/** Turns RPC / wallet / program failures into something a player can act on. */
export function describeError(err: unknown): string {
  const { codes, text, customCode } = inspectError(err);
  const has = (c: number) => codes.includes(c);
  if (customCode !== undefined) return programError(customCode);
  if (has(C.USER_REJECTED) || /reject|denied|cancell?ed by user|user declined/i.test(text))
    return 'You rejected the request in your wallet.';
  if (has(C.ACCOUNT_NOT_FOUND) || /no record of a prior credit/i.test(text))
    return 'This wallet has no SOL on this network yet — fund it first.';
  if (
    has(C.INSUFFICIENT_FUNDS_FOR_FEE) ||
    has(C.INSUFFICIENT_FUNDS_FOR_RENT) ||
    has(C.INSTRUCTION_INSUFFICIENT_FUNDS) ||
    /insufficient (funds|lamports)/i.test(text)
  )
    return 'Not enough SOL for the stake plus fees.';
  if (isExpiredError(err)) return 'Transaction expired before it landed — try again.';
  if (has(C.PROGRAM_ACCOUNT_NOT_FOUND) || /program that does not exist|ProgramAccountNotFound/i.test(text))
    return 'The DegenWild program is not deployed on this cluster yet.';
  if (has(C.WALLET_VERSION_UNSUPPORTED)) return 'Your wallet version can’t sign this transaction — update the wallet app.';
  if (has(C.WALLET_NOT_CONNECTED) || has(C.WALLET_NO_SIGNER) || has(C.CANNOT_SIGN))
    return 'Your wallet isn’t connected for signing — reconnect it and try again.';
  if (has(C.RPC_HTTP_ERROR) || /\b429\b|too many requests|rate.?limit/i.test(text))
    return 'The network is busy right now (rate-limited) — retrying automatically.';
  // Fall back to the most specific readable text we have, plus the code for support.
  const readable = text.split(' | ').find((t) => t && !/^Solana error #\d+/.test(t));
  const code = codes.find((c) => c > 0);
  return `${readable ?? 'Something went wrong.'}${code ? ` (code ${code})` : ''}`;
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

// ---------------------------------------------------------------- jackpot

export type JackpotView = {
  state: JackpotState | null;
  roundAddress: Address | null;
  round: (JackpotRound & { address: Address }) | null;
};

export async function jackpotRoundAddress(roundId: bigint): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: DEGENWILD_PROGRAM_ADDRESS,
    seeds: [utf8.encode('jackpot_round'), getU64Encoder().encode(roundId)],
  });
  return pda;
}

/** Jackpot state + the current round (null round = nobody has entered yet). */
export async function fetchJackpot(rpc: Rpc): Promise<JackpotView> {
  const [statePda] = await findJackpotStatePda();
  const st = await fetchMaybeJackpotState(rpc, statePda, { commitment: 'confirmed' });
  if (!st.exists) return { state: null, roundAddress: null, round: null };
  const roundAddress = await jackpotRoundAddress(st.data.currentRound);
  const r = await fetchMaybeJackpotRound(rpc, roundAddress, { commitment: 'confirmed' });
  return {
    state: st.data,
    roundAddress,
    round: r.exists && r.data.entries.length > 0 ? { ...r.data, address: roundAddress } : null,
  };
}

/** Mirrors jackpot_seed() in jackpot.rs. */
async function jackpotOraoSeed(round: Address, roundId: bigint): Promise<Uint8Array> {
  const [seedAddr] = await getProgramDerivedAddress({
    programAddress: DEGENWILD_PROGRAM_ADDRESS,
    seeds: [utf8.encode('degenwild-jackpot-v1'), addrEnc.encode(round), getU64Encoder().encode(roundId)],
  });
  return new Uint8Array(addrEnc.encode(seedAddr));
}

export async function buildEnterJackpot(player: TransactionSigner, amount: bigint, roundId: bigint) {
  return (await getEnterJackpotInstructionAsync({
    player,
    round: await jackpotRoundAddress(roundId),
    amount,
  })) as Instruction;
}

export async function buildLeaveJackpot(player: TransactionSigner, roundId: bigint) {
  return (await getLeaveJackpotInstructionAsync({
    player,
    round: await jackpotRoundAddress(roundId),
  })) as Instruction;
}

export async function buildDrawJackpot(rpc: Rpc, drawer: TransactionSigner, round: Address, roundId: bigint) {
  const orao = await fetchOraoNetwork(rpc);
  const seed = await jackpotOraoSeed(round, roundId);
  const [randomnessRequest] = await getProgramDerivedAddress({
    programAddress: ORAO_VRF_PROGRAM,
    seeds: [utf8.encode('orao-vrf-randomness-request'), seed],
  });
  return (await getDrawJackpotInstructionAsync({
    drawer,
    round,
    oraoTreasury: orao.treasury,
    randomnessRequest,
  })) as Instruction;
}

/** The 64 ORAO randomness bytes once fulfilled, else null. */
export async function fetchRandomnessBytes(rpc: Rpc, account: Address): Promise<Uint8Array | null> {
  const acc = await fetchEncodedAccount(rpc, account, { commitment: 'confirmed' });
  if (!acc.exists || acc.programAddress !== ORAO_VRF_PROGRAM || acc.data[8] !== 1) return null;
  return new Uint8Array(acc.data.slice(9 + 64, 9 + 64 + 64));
}

/** Mirrors jackpot_ticket() + jackpot_winner_index() in jackpot.rs. */
export function jackpotWinner(entries: JackpotRound['entries'], total: bigint, randomness: Uint8Array) {
  let n = 0n;
  for (let i = 15; i >= 0; i--) n = (n << 8n) | BigInt(randomness[i]);
  const ticket = n % total;
  let cum = 0n;
  for (let i = 0; i < entries.length; i++) {
    cum += entries[i].amount;
    if (ticket < cum) return { index: i, ticket };
  }
  return { index: entries.length - 1, ticket };
}

export async function buildSettleJackpot(rpc: Rpc, round: JackpotRound & { address: Address }) {
  const treasury = await fetchTreasury(rpc);
  if (!treasury) throw new Error('Platform config is not initialized yet.');
  const randomness = await fetchRandomnessBytes(rpc, round.randomnessAccount);
  if (!randomness) throw new Error('The fair result has not landed yet.');
  const { index } = jackpotWinner(round.entries, round.total, randomness);
  const winner = round.entries[index].player;
  const first = round.entries[0].player;
  const ix = (await getSettleJackpotInstructionAsync({
    round: round.address,
    randomnessRequest: round.randomnessAccount,
    treasury,
  })) as Instruction;
  const extra = [...new Set([winner, first])].map((address) => ({ address, role: AccountRole.WRITABLE }));
  return { ...ix, accounts: [...(ix.accounts ?? []), ...extra] } as Instruction;
}

export async function buildRefundJackpot(round: JackpotRound & { address: Address }) {
  const ix = (await getRefundJackpotInstructionAsync({
    round: round.address,
    randomnessRequest: round.randomnessAccount,
  })) as Instruction;
  const extra = round.entries.map((e) => ({ address: e.player, role: AccountRole.WRITABLE }));
  return { ...ix, accounts: [...(ix.accounts ?? []), ...extra] } as Instruction;
}

export async function buildInitJackpot(payer: TransactionSigner) {
  return (await getInitJackpotInstructionAsync({ payer })) as Instruction;
}
