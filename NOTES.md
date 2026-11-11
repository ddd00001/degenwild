# DegenWild: handoff notes

Last updated 2026-11-11. Read this first in a new session.

## What it is
PvP coinflip on Solana. Anchor program (escrow, ORAO VRF randomness, 3.5% fee) + React/Vite site.
Brand is written **DegenWild** (one word), **DEGENWILD** in all-caps spots.

## Where things live
- `programs/degenwild/`: Anchor program. Instructions: create/join/cancel/settle/refund battle,
  platform config + update treasury, usernames (create/change/delete profile, admin remove).
  Settle and refund close the battle account (rent back to creator) and emit `BattleSettled` / `BattleRefunded`.
- `app/`: website. `src/chain.ts` is the hub for all transactions and reads (used by site, bot and scripts).
  `src/generated/` is the Codama client (`npm run codegen` after `anchor build`).
  `src/content/roadmap.md`: Roadmap page text (still has TODO placeholders the owner must write).
- `app/scripts/`: `settle-bot.mts` (`npm run bot`), `cli-player.mts`, local-fork tools (`e2e-local.ts`, `seed-local.ts`, `fulfill-local.mts`, `join-local.mts`).
- `app/README.md`: how to run, build and test.

## Deployed (devnet only)
- Program `6Gv48CrXyPgqNtJsPgAW95ynm6CvbvjkB5x2p3ru2dYV` on **devnet**. Upgrade authority: CLI wallet `6CsG…6GmU`.
- Platform admin + fee treasury: Phantom `4VUJ…fx7b` (username "degen"). Platform config initialized on devnet.
- Site: **https://degenwild.vercel.app** (Vercel, auto-deploys every push to `master`, root `app`).
  Also a copy on GitHub Pages (`gh-pages` branch, ddd00001.github.io/degenwild), built with `npm run build:pages`.
- Public builds use the **public devnet RPC, no API key**. Never bundle the Helius key into a public build.
- GitHub: `ddd00001/degenwild`. `master` == `orao-vrf-integration` at the time of writing.

## Local setup
- `app/.env.local` (git-ignored) holds `VITE_RPC_URL` = Helius devnet URL with the owner's key. The bot reads it too.
- Local dev site: `npm run dev` (port 5174 was used). Bot: `npm run bot` (POLL_MS default 3000; 4000 was used).
  The bot only runs while the owner's PC is on.
- Tests: `cargo build-sbf --arch v2 && cargo test` (35 program tests). Devnet deploys use the standard build (`anchor build`).
- Devnet SOL: the RPC faucet is closed; use faucet.solana.com with GitHub sign-in (worked), or Jumpbit.

## Decisions
- **Stay on devnet / play money.** No mainnet until there is a security audit and legal advice.
  Owner is in Switzerland: online casino games need a Swiss concession (BGS Art. 130 makes unlicensed operation an offence).
- Declined: launching a memecoin to fund a short mainnet run and then going offline (looks like a rug pull).
- Mainnet deploy would need ~3.1 SOL at once (~1.53 SOL locked) with `opt-level = "z"` (301 KB); not applied yet.

## Ideas not built yet
- Leaderboard / points for a devnet "play-money season", stats panel, waitlist.
- Admin pause switch, lower max stake for any future mainnet, multisig for keys.
- Hosting the bot on a server; admin page to remove usernames; restricted Helius key per domain.
- Replace "The first 100% on-chain..." claim in the intro if it can't be verified.
