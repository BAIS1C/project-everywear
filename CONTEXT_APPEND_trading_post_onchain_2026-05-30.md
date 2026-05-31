# Context Append: Trading Post On-Chain Ownership + Kreds Endgame

Project location: C:\Users\MAG MSI\Project Everywear
Parent doc: TRADING_POST_ARCHITECTURE_2026-05-30.md
Author: Sean Uddin / Somo Kasane, with Kasai
Timestamp: 2026-05-30 SGT
Status: LIVE DIRECTION. Supersedes the commerce + chain sections of the parent
doc where they conflict. Append-only; nothing in the parent is deleted.
Mirror: Project Mymory vault NOT mounted this session. Flag for Everywear-wing
mirror at next vault session.

This append captures a strategy thread that resolved the commerce rail, the
chain, the custody model, the ownership surface, the vocabulary, and the
long-game currency. Read it as the current truth over parent Sections 3, 5, 11.

---

## 1. The shape, in one line

Two rails that meet at one hash. MONEY is fiat through Lemon Squeezy (corp).
OWNERSHIP is an invisible, on-chain, user-custodied NFT ("forged" item) that
lands in the user's Vault. They meet at `content_sha256`. The chain carries
ownership and provenance, never payment.

---

## 2. Locked decisions (2026-05-30 SGT)

- TWO-RAIL SPLIT.
  - Money rail: Lemon Squeezy, merchant-of-record, fiat, CORP. Handles
    on-ramping, one-off purchases, user payments, subscriptions, platform take.
    Money lands with the company.
  - Ownership rail: on-chain NFT, user-custodied, unique, invisible. Carries
    ownership/provenance only. No payment on chain in this phase.
- MICROTRANSACTIONS ARE NFTs, never said out loud. Creator marketplace items
  (styler patches / aesthetics / trait shards / skill shards / texture packs)
  are forged as on-chain tokens, user-custodied, unique.
- CHAIN: NEAR. Rationale: native USDC ubiquitous, native meta-transactions
  (gasless to user, platform sponsors via relayer), cheap per-item forges,
  Rust fit with existing crates, named accounts map to @everywear.id, passkey
  embedded accounts (no seed phrase). NEAR is training wheels, not a marriage
  (see Section 5). Reverses the parent doc's interim EVM lean; the scope
  clarifications (stables-only, invisible, gasless, per-item mint volume) pull
  the decision firmly to NEAR.
- STABLES-ONLY. USDC. No volatile assets, no DEX/swap step. "Balance" stays
  honest (1 USDC approx 1 USD). This is the single biggest de-risking choice.
- CUSTODY MODEL: non-custodial, user is SOLE SIGNER (passkey / MPC, no seed
  phrase shown). Fiat on-ramp and off-ramp done by LICENSED THIRD PARTIES.
  Platform is an ORCHESTRATOR that custodies nothing. This is the only
  configuration where "on-chain solves custody" is actually true.
- OWNERSHIP IS PLATFORM-SCOPED. "You own it on Everywear." Walled garden: no
  external venue to take items to, so no royalty/rake leakage exists. External
  marketplaces are a non-problem now and a non-category later (own chain).
- RESALE: ON. Editions are TRANSFERABLE, creator share + platform rake enforced
  on transfer in the forge contract, routed through the in-app Trading Post.
  SUPERSEDES the earlier "primary-only, no resale in v1" lock.
- EDITIONS: creator's choice. LIMITED (capped supply, down to 1/1) or
  OPEN/INFINITE (forged on demand per sale). Scarcity is a creator lever.
- THE SURFACE IS THE VAULT, not a "wallet." Forged items land in the existing
  Vault (vault crate) alongside generated media: one "my stuff" surface.
  Ownership sits invisibly behind the Vault entry. The wallet is pure invisible
  custody plumbing the user never meets. A money/balance surface (USDC, later
  Kreds) can render inside the Vault so the word "wallet" never appears.
- LEXICON: Forge (not mint), Vault (not wallet), Own, Trade, Share. Never say
  mint, wallet, token, gas, chain, NFT, or crypto in any user-facing surface.
- PRIMARY GATE UNCHANGED: creation is a Gener8 Pro tier funnel. Anyone buys,
  only Pro-tier creators forge listings.

---

## 3. What this supersedes in the parent doc

- Parent Section 3 (custodial + lazy-mint as default): NOT the model. Money is
  LS-corp fiat; ownership is user-custodied on-chain. No platform custody of
  user funds or user assets.
- Parent Sections 11.1 to 11.5 (PSP-split "no custody P2P"): deferred. LS stays
  for corp money. The no-custody property is achieved on the OWNERSHIP side
  (user-custodied tokens) plus licensed on/off-ramp, not via a split PSP.
- Parent Section 10.1 "primary-only, no resale": resale is ON, walled-garden
  scoped, royalty + rake enforced in-contract.
- Parent Section 5 recommendation (NEAR-first, then re-leaned EVM): settled on
  NEAR, with explicit chain-portability so the eventual own-chain is a
  re-anchor, not a migration.

---

## 4. Architectural mandates (bake in now, or the endgame becomes a rebuild)

1. CURRENCY-AGNOSTIC BALANCE. Do not hardcode USDC anywhere in wallet, ledger,
   or split contracts. Model a denomination-abstract unit with USDC as the
   first registered asset, so Kreds is a config + contract add, not a migration.
2. WALLET/VAULT CUSTODY IS A PLATFORM KERNEL. A non-custodial account is minted
   at user/Blank account creation for EVERY user, silently. This passive
   funded-wallet accrual IS the Kreds distribution engine. Not a marketplace
   feature.
3. PORTS, hexagonal: `ProvenanceLedger` (chain), `PayoutRail` (disbursement),
   `Currency` (unit of account). Because identity is `content_sha256`, the chain
   is swappable plumbing. NEAR now, own chain later, EVM never ruled out.
4. EDITIONS MODEL: master keyed on `content_sha256`; per-buyer edition tokens
   (1155-style). Optional supply cap = limited; uncapped = open/infinite.
5. GASLESS FORGE: every purchase forges an edition to the buyer's account,
   gas sponsored by platform relayer (NEAR meta-tx). User never sees gas.
6. OWNERSHIP CHECK: on-chain token holding is source of truth; the off-chain
   `user_entitlements` row demotes to a fast read-cache reconciled to chain.
   model-manager install gate reads the cache.

---

## 5. NEAR as training wheels, own chain as endgame

- NEAR is the bootstrap chain to build the userbase and gauge user education
  and tolerance under cover of real utility.
- Endgame: launch own chain(s) + own tooling. At that point "external
  marketplace" is a non-category because the platform IS the chain.
- Migration is low-friction by design: items are `content_sha256`-keyed behind
  the `ProvenanceLedger` port. Moving chains = re-anchor the same hashes on the
  new chain, repoint Vault entries. Files never move; ownership graph carries
  over; user sees nothing change. No lock-in to NEAR.

---

## 6. Kreds endgame (the real north star)

- Invisible USDC rails now accrue millions of funded, KYC'd, non-custodial
  Vaults. Kreds then launches INTO existing populated Vaults, not cold. Solves
  the distribution problem that kills almost every new currency.
- Kreds must be PEGGED / closed-loop, NOT floating. A floating token reintroduces
  volatility, securities characterisation, and an exchange posture, and breaks
  the honest "your balance is dollars" surface. Keep it stable; do rewards and
  rake-back on top of a stable unit.
- Migration USDC -> Kreds must be USER-CONSENTED (one signed tap), never a silent
  backend flip. Sole-signer custody FORCES this, which is what keeps it clean
  and non-rug. Design the one-tap signed migration into the wallet kernel now.
- Likely issuer entity: somokasane Pte Ltd (Singapore, MAS framework).

---

## 7. Open items (critical path)

- CREATOR DISBURSEMENT RAIL. LS cannot pay third-party creators. Buyer pays
  fiat to corp; creator is owed from corp balance via a SEPARATE rail (Xendit
  Iris later / PayPal Payouts / Wise / manual batch at low volume). The
  Gumroad ledger-and-payout reality is untouched by the NFT framing. This is
  the money-custody question and it is still live.
- KEY RECOVERY. Sole-signer + millions who do not know it is crypto = mass key
  loss risk, and they blame the platform. Passkey + MPC social recovery must be
  in the wallet kernel from day one. This is harder than the marketplace and is
  a launch blocker.
- LICENSED ON/OFF-RAMP partner, and specifically NEAR-USDC off-ramp to card/bank
  (the thinner spot in NEAR's ecosystem; verify before commit). Cash-out UX is
  flagged "need to work out."
- REWARDS FRAMING. Rake-share-back = cashback/rebate, never profit-share (Howey
  risk). No lottery/"winnings" mechanics (gambling licensing). Rewards as
  stablecoin/credit balance, not tokens.
- ECONOMICS: platform rake bps on primary and on resale; default editions
  policy; creator share bps.
- LEGAL POSTURE: utility-good framing is the shield for limited-edition resale
  (a working tool, not a speculative jpeg). Keep marketing on utility, never on
  "may be worth more later." Loop somokasane counsel before balances accrue and
  before Kreds issuance.

---

## 8. Verify before build (NOT web-verified this session)

- NEAR native USDC liquidity + off-ramp providers to card/bank.
- Current stablecoin / e-money disclosure regime (MiCA EMT, US, MAS Singapore)
  for the "invisible in UX, disclosed in ToS/KYC" line.
- Embedded-wallet passkey/MPC providers with NEAR support.
- Card-network rules on the fiat money flow (LS-corp keeps this simple; revisit
  if a card->USDC on-ramp is ever added).

---

## 8b. REVISION r5 2026-05-30 SGT: Codex / vault-canon reconciliation

Trigger: Codex read the Mymory vault (not mounted in this Cowork session) and
surfaced PRIOR CANON our thread did not account for, plus rigid critiques. This
revision absorbs the valid corrections. Vault canon referenced (UNREAD here,
mount required to merge):
- Strands "The Exchange" dual-protocol marketplace: LocalNet (off-chain, high
  volume) + DeepSync (on-chain provenance, "invisible blockchain").
  C:\Users\MAG MSI\Project Mymory\strands\2026-03-11_canon_economy_systems.md
- Strands Marketplace UX v1.0.
  C:\Users\MAG MSI\Project Mymory\strands\2025-06-07_strands_canonical_marketplace_trade_protocol_ux_v1_0.md
- My Mait product model + applet gate manifest (free My Mait, monetized via
  trait/skill shards, NFT-ready ownership ledger, off-chain-first).
  C:\Users\MAG MSI\Project Mymory\everywear\2026-05-30_my_mait_product_model_and_applet_gate_manifest.md
- Metafintek MoC: Xendit KYC blocked on marketplace checkout clarity.
  C:\Users\MAG MSI\Project Mymory\metafintek\_moc_metafintek.md

CONVERGENCE: our chat independently rediscovered the LocalNet/DeepSync split.
Adopt the EXISTING canon nomenclature (The Exchange, LocalNet, DeepSync,
TokenSync) instead of inventing parallel terms.

CORRECTIONS to the locks above (this revision wins on conflict):

- C1. NOT every microtransaction is an NFT. Two lanes:
  - LocalNet: off-chain inventory ledger. Utility items, skill toggles,
    consumables, high-volume / throwaway. Default lane.
  - DeepSync: on-chain forge. Scarce, creator, provenance-sensitive, limited
    editions, prestige. Opt-in lane.
  Lane is decided by SCARCITY / PROVENANCE-SENSITIVITY (creator-selectable),
  not strictly consumer-vs-creator. Section 2 "microtransactions are NFTs" is
  narrowed to "provenance assets are forged; utility items stay on LocalNet."

- C2. CUSTODY SEQUENCING REVISED. Custodial OFF-CHAIN item-ledger FIRST;
  non-custodial export (TokenSync) LATER as a user-opted graduation. This
  REVISES the "non-custodial sole-signer from day one" lock (Section 2).
  Rationale: dissolves the key-recovery launch blocker (Section 7) and
  preserves REVOCATION, which on-chain finality fights. KEY DISTINCTION:
  custody here = custody of OWNERSHIP RECORDS (low risk), NOT custody of MONEY
  (money stays Lemon Squeezy fiat corp). The two compose. Educational
  self-custody becomes a graduation arc, not a day-one burden. Restores parent
  doc Section 4 sequencing (OffchainLedger default, anchor later).

- C3. SHARDS ARE EXECUTABLE SOCIAL SOFTWARE, not files. Skill/trait shards can
  carry prompt-injection, malware behaviour, impersonation, likeness/IP
  violations. Require BEFORE listing: sandboxing, declared capabilities,
  prompt-injection + malware scanning, likeness/IP controls. Design a
  REVOCATION / REFUND / DEPRECATION state model BEFORE any chain anchoring.
  Broken-asset liability (e.g. a skill shard breaks on a 3rd-party API scope
  change) must have an owner. On-chain finality fights product safety unless
  revocation semantics exist first.

ADOPT (sharper than the parent schema):
- Canonical ownership-record identity: asset_id, owner_id, creator_id,
  provenance_hash (= content_sha256), license_terms, transfer_state,
  chain_anchor_id (nullable until forged to DeepSync).
- Legible ownership STATE enum, user-facing: bought, equipped, transferable,
  refundable, creator_made, official, revoked, deprecated. "Own your Mait" is
  cosmetic unless ownership state is legible, not a hidden entitlement row.

ELEVATE (was Section 7, now critical-path / already-logged blocker):
- Xendit KYC is blocked on marketplace checkout clarity (Metafintek MoC).
  Trading Post is payments/compliance infra before it is a shop. Map: checkout
  category, seller-of-record, tax, refunds, creator payouts BEFORE pitching as
  an in-app shop. NOTE: Lemon Squeezy MoR answers seller-of-record + tax, which
  is the clarity Xendit checkout was blocked on. Validates the LS decision.

HARD RULE (adopted from Codex): blockchain verifies ownership, provenance,
scarcity, and transfer AFTER the user already cares. It is not the reason they
care. Chain serves the asset, never the reverse.

TODO (requires vault mount): read the four canon files above; merge this append
with The Exchange / Marketplace UX / My Mait manifest; rename to canon
nomenclature (LocalNet/DeepSync/TokenSync); file merged canon to the Mymory
Everywear + Strands wings. Until merged, treat THIS append + the canon files as
jointly authoritative; neither alone is the full story.

---

## 8c. REVISION r6 2026-05-30 SGT: Steam constraint (SUPERSEDING) + r5 corrections

Sean corrections + verified Steam policy. This revision OUTRANKS r5 and parts of
Sections 2-7 where they assume an on-chain element ships on the primary channel.

SUPERSEDING CONSTRAINT: STEAM DISTRIBUTION.
- Everywear's primary distribution is Steam ("Steam for AI apps"). Valve bans
  blockchain/NFT/crypto apps, and the broader rule bans items with real-world
  monetary value redeemable outside Steam. Verified current (2021 rule still in
  force, no reversal found 2026). Risk = delisting = loss of primary channel.
- This SUPERSEDES the on-chain ownership layer for the Steam build. Off-chain-first
  is now MANDATORY, not merely prudent. Full vindication of parent Section 4 and
  the My Mait manifest ("off-chain-first is fine, model NFT-shaped").

CHANNEL SPLIT (the new top-level architecture):
- STEAM BUILD: off-chain ownership ledger only. Payments via Steam MTX (Valve
  cut). NO crypto / NFT / wallet / Kreds / on-chain anything. NO real-money
  creator cash-out (Steam forbids real-world item value). Carries the storefront
  + first-party / curated shard packs.
- DIRECT BUILD (everywear.id Tauri download): full stack. LS fiat, creator
  payouts / cash-out, off-chain ledger with OPTIONAL chain anchoring later,
  Kreds future. The crypto + sovereign-ownership + educational-self-custody
  thesis lives HERE ONLY.
- UNIFYING SPINE: the content_sha256-keyed, NFT-shaped but OFF-CHAIN ownership
  ledger gives identical UX on both channels (Forge / Vault / Own / Trade). The
  chain is invisible backend plumbing present only on the direct build, only as
  anchoring of the same off-chain records. The user experience loses nothing by
  being off-chain; only the sovereignty/Kreds layer needs the chain, and that is
  direct-channel-only and later-phase.

CORRECTIONS to r5:
- REJECT r5 C1 (LocalNet/DeepSync two-lane import). Strands "The Exchange" is
  IN-GAME canon, not Everywear. Verified against the My Mait manifest: Everywear
  Trading Post is its own off-chain, NFT-shaped, creator/provenance-from-day-one
  design. Firewall game canon from platform canon. "We were right."
- DEFLATE r5 C3 (executable social software). Shards are prompt-bundle .md files
  with an icon, NOT executable. Threat model = prompt-injection screening +
  IP / likeness / content moderation + revocation/refund for broken or infringing
  content. NO code sandboxing / malware-binary concern.
- KEEP from r5: ownership-state legibility enum; canonical asset-identity schema
  (now confirmed as existing Everywear canon: creator/provenance fields,
  NFT-shaped off-chain, chain_anchor_id nullable); revocation/refund state model
  (still needed for content, trivial while off-chain); the Xendit/checkout-clarity
  compliance reality (now eased: Steam MTX on Steam, LS MoR on direct, both solve
  seller-of-record); "chain after the user cares" rule.

CANON ALIGNMENT: the authoritative Everywear source is
everywear/2026-05-30_my_mait_product_model_and_applet_gate_manifest.md (CANONICAL).
A Steam-constraint addendum was appended there this session (pending Sean review).
This Everywear-side append is consistent with that manifest.

OPEN FORK (new): creator UGC cash-economy = direct-channel-only, with Steam
limited to curated/first-party shard packs? Leaning yes. Decide before build.

## 8d. PENDING DISCUSSION (NOT DECIDED, 2026-05-30 SGT): editions + creator channel

Status: OPEN. Sean percolating. Do NOT treat as locked; do NOT file to canon.
Parked here so it is not lost.

Sean's inclination (not final):
- No creator economy on Steam. Steam = consumer BUYING only.
- To create: mandatory KYC + download a separate "Creators Edition" from
  everywear.id.

Why it is attractive (one gate, five jobs): anti-bot/personhood, quality filter,
legal firewall (real-money + crypto off Steam), wallet seeding, Pro paywall.

THE OPEN HINGE (undecided): when a consumer buys on Steam, is it
  (a) creator-made content, creator paid off-Steam, or
  (b) first-party / curated content Everywear owns only?
- (a) gives creators Steam's reach but risks Steam-Workshop-paid-content mess /
  Valve revenue-share scrutiny.
- (b) keeps Steam policy-clean but walls creators off from the big audience,
  weakening marketplace supply.
- Kasai-proposed middle path (not adopted): Steam = curated first-party shelf
  that Everywear stocks by LICENSING top content UP from the direct marketplace;
  creators reach Steam by being licensed, Everywear is seller-of-record, creator
  gets a licensing deal not a per-Steam-sale payout. Steam becomes the "big
  leagues" creators grind toward.

Side notes parked with this:
- Two orthogonal gates: CHANNEL (Steam vs direct) gates wallet/crypto; KYC gates
  create + cash-out. Three populations: Steam consumer (walletless), direct
  consumer (wallet ok), KYC creator (full economy).
- Kreds seed reframed: not millions of passive Steam buyers, but the funded /
  KYC'd creator + direct cohort. Quality base over headcount.
- Supply-side risk: KYC + second download will cut creator conversion; value
  prop must justify the climb.
- Build discipline: ONE codebase, edition by build-flag + entitlement, never two
  forks.

## 9. Narrative / why (for marketing + My Mait onboarding copy)

Vertical integration of the entire creator value chain, every link owned and
invisible: tools (1magen, Style Forge, later AI toolkit ports) -> assets ->
Trading Post -> earnings -> Vault -> Kreds. LayerU applies the same pattern to
bands. My Mait is the in-platform guide that embeds the how-to and keeps the
invisibility from becoming abandonment; it is onboarding and retention disguised
as a companion. The platform's stated purpose is teaching real self-custody and
digital ownership by handing people custodied assets they actually want, with
zero crypto jargon. Disclosure line: invisible in the product, named only in
ToS/KYC/cash-out. Stables-only keeps that fine print boring.
