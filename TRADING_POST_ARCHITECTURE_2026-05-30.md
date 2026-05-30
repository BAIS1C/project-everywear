# Trading Post / Item Shop: Architecture (structure, not build)

Project location: C:\Users\MAG MSI\Project Everywear
Author: Sean Uddin / Somo Kasane, with Kasai
Timestamp: 2026-05-30 SGT
Status: DESIGN. No code. Mirror to Project Mymory (Everywear wing) on next vault session.
Mode: Kasai (assumption-challenging)

> REVISION 2026-05-30 SGT (r4): CURRENT TRUTH lives in
> CONTEXT_APPEND_trading_post_onchain_2026-05-30.md. Headline changes from this
> thread: two-rail split (Lemon Squeezy = corp fiat money; on-chain
> user-custodied "forged" NFTs = ownership, meeting at content_sha256);
> stables-only USDC; CHAIN = NEAR (training wheels, own chain later, hash-keyed
> so chain is swappable); non-custodial sole-signer wallets, platform = pure
> orchestrator; RESALE ON, transferable editions, walled-garden / platform-scoped
> (supersedes the primary-only no-resale lock); creator-chosen limited vs
> open editions; surface is the VAULT not a wallet; lexicon = Forge / Vault /
> Own / Trade / Share, never mint/wallet/token/gas/chain/NFT/crypto. Kreds is the
> endgame currency (pegged, consented migration, currency-agnostic balance baked
> in now). Read the append first; sections below are retained as working history.
>
> REVISION 2026-05-30 SGT (r3): Rail decision is Lemon Squeezy (already
> integrated), Xendit added later for SEA QR. Lemon Squeezy is MERCHANT-OF-RECORD,
> which forces the PLATFORM-AS-SELLER model: the off-chain creator ledger from
> Section 3 is the v1 truth (re-activated), NOT the no-custody PSP-split of
> Section 11. Section 11 (split, no custody) becomes the LATER Xendit xenPlatform
> upgrade path, not v1. Read Sections 3 + 11.6 for the live design; Section 11.1
> to 11.5 describe the deferred Xendit upgrade.

---

## 0. The one-paragraph read

The Trading Post is not a new commerce system. Your entitlement contract
(`20260528140643_everywear_identity_entitlement_vault_contract.sql`) already
reserved the exact primitives a creator marketplace needs: `entitlement_type`
includes `asset_pack` and `shard_pack`, `plans.billing_model` includes
`microtransaction`, `plan_entitlements.grant_policy` includes
`microtransaction_unlocked`, and `external_identities.provider` already includes
`wallet`. The model-manager crate already SHA256s every asset; the Vault crate
already treats `sha256` as "identity, dedupe, and tamper evidence." So the
elegant path is: a creator listing is a catalog row, a purchase is a
`user_entitlements` row, asset identity is the content `sha256`, and the chain
is a deferred provenance adapter behind a port, not a dependency. Ship fiat with
zero chain first. Bind a chain later without touching the commerce core.

---

## 1. Where it bolts into the stack you already have

| Existing piece | Path | Role in Trading Post |
|---|---|---|
| Identity | `profiles`, `external_identities` (has `wallet`) | Account = `handle@everywear.id`. Custodial wallet binds here, hidden. |
| Entitlements | `products`, `plans`, `plan_entitlements`, `user_entitlements` | A purchase grants an `asset_pack` / `shard_pack` entitlement. Same RLS gate as everything else. |
| Tier gating | `active_tier(uuid)`, `subscriptions` | Upload privilege = `gener8_pro`+. Buy privilege = any tier. |
| Fiat | `lemon_squeezy` / `xendit` edge webhooks, `webhook_events` dedupe | Already the money rail. Marketplace reuses it verbatim. |
| Asset format + hashing | `model-manager` (`manifest.rs` `ModelRole::Lora`, `LicenceTier`, SHA256, symlinks) | Validates uploads, computes the canonical hash, installs by symlink. |
| Local index | `vault` crate (LanceDB + Tantivy, sha256 = identity) | Owned/purchased assets surface in the user's local Vault and search. |
| Personality assets | `mait` crate (`MaitManifest`, `aesthetic_shards`, `mait-manifest-v1`) | Aesthetic / trait / skill shards are already a typed manifest. Marketplace wraps them. |

Read this table as the thesis: you are extending a catalog, not greenfielding a
store. Anything below that looks like new build is glue, not a parallel spine.

---

## 2. Asset taxonomy to canonical model

Five sellable classes, each already has a home applet and a native format.

| Class | Consumer applet | On-disk format | Maps to | Identity |
|---|---|---|---|---|
| Styler patch (LoRA) | 1magen workflows | `.safetensors` LoRA + sidecar TOML | `ModelRole::Lora` in model-manager | file sha256 |
| Aesthetic | My Mait | `mait-manifest-v1` `aesthetic_shards[]` | `mait` crate | manifest sha256 |
| Trait shard | My Mait | `mait-manifest-v1` shard | `mait` crate `shard.rs` | manifest sha256 |
| Skill shard | My Mait | `mait-manifest-v1` shard (skill subtype) | `mait` crate | manifest sha256 |
| Texture image set | Character Studio | image pack + manifest | Vault `IMAGE_FIELDS` + pack manifest | pack-root merkle/sha256 |

Canonical asset record (logical, not a column dump):

```
asset
  asset_id           uuid                      stable listing id
  asset_type         enum(styler_lora,
                          aesthetic,
                          trait_shard,
                          skill_shard,
                          texture_pack)
  target_applet      enum(1magen, my_mait, character_studio)
  creator_user_id    -> profiles.id
  title, slug, summary, tags[]
  visibility         enum(draft, in_review, live, delisted, banned)
  upload_tier_floor  default 'gener8_pro'       who may LIST
  buy_tier_floor     default 'free_everywear'   who may BUY
  license_id         -> license templates
  current_version_id -> asset_version
  created_at, updated_at

asset_version            (immutable, append-only; LoRAs get re-trained)
  version_id         uuid
  asset_id           -> asset
  semver             text
  content_sha256     text   CANONICAL IDENTITY. matches model-manager + Vault.
  manifest_sha256    text   for shard/aesthetic manifests
  size_bytes, file_uri (R2/Supabase Storage, not chain)
  base_model_compat  text[] (e.g. z-image-turbo, flux) for LoRAs
  validation_state   enum(pending, passed, failed, quarantined)
  validation_report  jsonb
  published_at

price
  asset_id           -> asset
  model              enum(one_time, pay_what_you_want, free, bundle)
  amount_minor, currency
  creator_take_bps, platform_take_bps   (royalty split, off-chain truth)

purchase  (the bridge into your existing entitlement spine)
  purchase_id        uuid
  buyer_user_id, asset_version_id
  provider           lemon_squeezy | xendit | credits
  provider_ref       text
  -> writes a row in user_entitlements:
       entitlement_type = 'asset_pack' (loras/textures)
                        | 'shard_pack' (mait shards)
       source_ref       = content_sha256        <-- key the grant to the hash
       is_permanent     = true
```

The single most important line above: `source_ref = content_sha256`. That makes
the off-chain entitlement, the local file the model-manager installs, the Vault
index row, and any future on-chain token all point at the same 32-byte identity.
One hash, four systems, no reconciliation layer.

---

## 3. Commerce: fiat in front, chain hidden behind

Goal restated: user pays a card / GoPay / OVO, never sees a wallet, never signs,
never holds gas. Creator gets paid. Optionally, an NFT exists. Here is how all
three hold at once.

### 3.1 Custodial + lazy-mint + off-chain ledger

Three patterns stacked:

1. Custodial wallets. The platform holds keys. Each user gets a deterministic
   custodial address derived server-side and bound via `external_identities`
   (`provider = 'wallet'`, already in your enum). The user never sees a seed
   phrase. This is the same model Reddit Avatars and most "invisible NFT"
   products use. It is the only way to hit "blockchain hidden from user view."

2. Off-chain ledger is source of truth. A `ledger_entry` table records every
   purchase, royalty split, and balance change instantly, in fiat terms,
   inside Postgres. Day-to-day ownership and royalties are resolved here, not
   on-chain. This is what makes microtransactions viable: no gas, no block
   time, no L1 fees per $2 LoRA sale.

3. Lazy / deferred minting. The chain is touched only when economically
   justified: creator opts to "anchor on-chain," an asset crosses a value
   threshold, or the asset is exported out of the garden. Until then the token
   is a promise the ledger can honour. This keeps 99% of activity gas-free and
   off-chain while preserving "we are actually on-chain" as a true statement.

### 3.2 What the chain actually stores

Never the file. LoRAs are 50 to 300 MB; shards are smaller but still off-chain.
On-chain you store a provenance certificate:

```
token = {
  content_sha256,          // the asset identity, same hash everywhere
  creator_address,
  first_minted_at,
  license_id / license_uri,
  royalty_bps              // ERC-2981 (Avax) or NEP-199 (NEAR)
}
metadata_uri -> IPFS/Arweave json { title, type, preview, sha256, compat }
```

The token is a tamper-evident ownership + royalty + provenance instrument keyed
on the hash you already compute. The bytes live in R2; the proof lives on chain.

### 3.3 Money flow (fiat purchase, no chain touched)

```
buyer clicks Buy
  -> Lemon Squeezy / Xendit checkout (existing edge fn)
  -> webhook (dedup via webhook_events)
  -> service-role writes:
       ledger_entry (buyer debit, creator credit minus platform_take)
       user_entitlements (asset_pack|shard_pack, source_ref=content_sha256)
  -> client refetches entitlements
  -> model-manager pulls file_uri, verifies content_sha256, symlinks in
  -> Vault indexes it; 1magen / My Mait / Character Studio sees it as owned
```

Zero wallet UX. The chain adapter is not even called in the default path.

---

## 4. The provenance layer is a PORT, not a chain

This is the architectural keystone and the place I will push back hardest:
**do not marry a chain now.** Define one interface, default it to off-chain,
and make the chain a swappable adapter. Hexagonal architecture applied to the
single most irreversible decision in the project.

```rust
// crates/provenance (new), trait-first. No chain in the default build.
pub trait ProvenanceLedger {
    fn register(&self, asset: &AssetIdentity) -> Result<ProvenanceRef>;
    fn transfer(&self, content_sha256: &Sha256, to: &OwnerRef) -> Result<()>;
    fn owner_of(&self, content_sha256: &Sha256) -> Result<OwnerRef>;
    fn royalty_of(&self, content_sha256: &Sha256) -> Result<RoyaltyBps>;
    fn anchor(&self, content_sha256: &Sha256) -> Result<OnChainRef>; // lazy mint
}
```

Implementations:

- `OffchainLedger` (Postgres). The default and the v1 production path. Fast,
  free, fiat-native. Ships first. Most users never leave it.
- `NearAdapter` (near-sdk-rs contract + relayer). First chain adapter.
- `AvaxAdapter` (Solidity ERC-721 + ERC-2981 + ERC-4337 paymaster). Optional
  second adapter for EVM liquidity / exit.

Because asset identity is `content_sha256` and not a chain-native id, the same
asset can be anchored on NEAR today and bridged/re-anchored on Avax later
without changing the commerce core or the entitlement rows. You are buying a
real option here, not deferring a decision out of indecision.

---

## 5. Avax vs NEAR: the honest call

You floated NEAR with a fondness tell ("I am a fan, plus they claim to be the
AI chain"). Fondness is a bad reason to pick infra and a fine reason to break a
tie. Here is the tie, then the break.

### 5.1 Matrix

| Axis | Avalanche (Solidity/EVM) | NEAR (Rust) |
|---|---|---|
| Contract language | Solidity | Rust (`near-sdk-rs`) |
| Fits your codebase | New language + toolchain | Same Rust your crates already are |
| Hide-the-chain native support | ERC-4337 account abstraction + paymaster (more parts) | NEP-366 meta-transactions + relayer, native, gasless by design |
| Account model | 0x hex addresses | Human-readable `alice.near`, maps to `alice@everywear.id` cleanly |
| Custodial / session keys | Smart-account wallets | Native function-call access keys = session keys out of the box |
| NFT standard | ERC-721 + ERC-2981 royalties | NEP-171 + NEP-199 royalties |
| Marketplace / liquidity / exit | Deep. OpenSea, thirdweb, every tool | Thin by comparison. Mintbase, Paras, fewer buyers |
| Dev-for-hire pool | Large (Solidity everywhere) | Smaller |
| Subnet / app-chain option | Avalanche subnets, mature | NEAR sharding, less of a "your own chain" story |
| Narrative | "Fast cheap EVM" | "The AI chain" (marketing, not a moat, but on-brand for Metafintek) |

### 5.2 The break

For your stated constraints (chain invisible, fiat front, Rust shop, AI
narrative), NEAR is the more elegant technical fit:

- Meta-transactions + relayer are the literal NEAR-native answer to "user signs
  nothing, platform sponsors gas." On EVM you rebuild that with 4337 and more
  moving parts.
- Named accounts and function-call access keys map onto your `@everywear.id`
  identity and session model almost one-to-one. This is the cleanest "hidden
  custodial" story available.
- It is Rust. Your team already thinks in Rust. The `provenance` crate and the
  contract speak the same language, share types, share mental model.

The cost of choosing NEAR is real and you should price it: thinner NFT liquidity
and a smaller hire pool than EVM. But your assets are utility items consumed
inside the garden, not speculative jpegs that need a deep secondary market on
day one. The liquidity argument that usually wins for EVM is weak for your use
case.

### 5.3 Recommendation

Build `OffchainLedger` for v1 and ship with no chain at all. When you anchor,
make `NearAdapter` the first implementation: it matches the Rust stack, gives
gasless meta-tx for free, and earns the "AI chain" line honestly. Keep
`AvaxAdapter` as a documented second adapter for the day EVM exit liquidity or
an EVM partner actually matters. The port (Section 4) is what lets you mean this
instead of betting the project on it.

Challenge to hold onto: if a real buyer or partner shows up who is EVM-only,
that single fact outweighs all the elegance above. Pick NEAR for fit, but let
revenue override taste.

---

## 6. Upload, validation, curation pipeline

Gate: lister must be `gener8_pro`+ (read via `active_tier`). Flow:

```
1. Creator (Pro+) starts a listing in Trading Post UI
2. Client computes content_sha256 locally (model-manager already does this)
3. Presigned upload to R2 / Supabase Storage (never through the app server)
4. Background validation worker:
     - format sanity (safetensors header / GGUF magic / mait-manifest-v1 schema)
     - base-model compatibility tag extraction (for LoRAs)
     - malware + zip-bomb scan
     - NSFW / IP screening (CLIP/classifier + hash blocklist)
     - duplicate check: is content_sha256 already listed by someone else?
       (sha256 collision on upload = provenance dispute, auto-quarantine)
5. validation_state -> passed | failed | quarantined
6. Human/curator review for first N listings per creator (reputation gates this)
7. visibility -> live, asset surfaces in catalog
```

The duplicate-hash check is your front-line anti-theft mechanism: if someone
re-uploads a creator's LoRA, the hash matches an existing registered asset and
it auto-quarantines for dispute. This is cheap, deterministic, and runs entirely
off-chain.

---

## 7. Royalties and payouts (the real gap)

Royalties on resale: trivial off-chain (ledger split on every secondary sale you
broker) and enforceable on-chain via ERC-2981 / NEP-199 only for sales that
happen on a marketplace that honours them. Assume in-garden resale honours
royalties; out-of-garden does not. Do not promise creators on-chain-enforced
royalties for loose files. It is not true.

Payouts are the genuinely unsolved piece and the thing to flag now:

- Lemon Squeezy is merchant-of-record for collection but weak for paying
  creators out.
- Xendit does disbursements well inside Indonesia / SEA (your home turf).
- Stripe Connect is the standard global creator-payout rail if you can access
  it from PT Metafintek / somokasane Pte Ltd.

Decision needed: which payout rail, and what is the KYC threshold before a
creator can withdraw. This affects entity structure (Singapore somokasane Pte
Ltd is probably the payout entity, not the Lombok PT). Park it, but it is on the
critical path to "creators upload their own patches and get paid."

---

## 8. Assumptions I am challenging

1. NFT is not DRM. A LoRA or shard is a file that runs on the buyer's RTX 5090.
   Once downloaded it is copyable. On-chain ownership stops none of that. Sell
   the token as provenance + royalty + revocable-entitlement, never as copy
   protection. The real moat is the garden: the asset is worth more wired into
   My Mait / 1magen / Character Studio with discovery, updates, and reputation
   than as a loose file on a torrent.

2. If you want true non-exfiltration, the lever is server-side inference, not
   chain. Gener8 Pro / Creator Studio running the asset server-side means the
   weights never leave your machine. That is the only actual copy-protection on
   the table. Position premium / exclusive assets as cloud-inference-only.

3. Hidden chain means custodial, and custodial means you are a fiduciary. The
   moment you hold keys and balances for users you carry custody risk and
   probable money-transmission questions. This is a legal posture, not just an
   architecture choice. Keep balances as platform credits redeemable for assets,
   not as withdrawable money, for as long as possible to stay out of MTL
   territory. Loop the somokasane Pte Ltd counsel before real fiat balances
   accrue.

4. Do not let "the AI chain" narrative pick your infra. It is a fine tiebreak
   and a real on-brand marketing line, but NEAR earns the pick on Rust fit and
   native meta-transactions, not on the slogan. If the slogan were the only
   argument, this would be a red flag.

---

## 9. Phased rollout

- Phase 0 (catalog only, no money): `asset` / `asset_version` / `price` tables,
  upload + validation pipeline, browse UI, install via model-manager symlink.
  Free assets only. Proves the asset spine end to end.
- Phase 1 (fiat, off-chain ledger): wire purchase to existing LS/Xendit
  webhooks, write `user_entitlements` (`source_ref = content_sha256`),
  `ledger_entry`, creator credit balances. `OffchainLedger` is the whole
  provenance layer. Zero chain. This is a shippable, revenue-generating product.
- Phase 2 (payouts): pick rail (Xendit SEA / Stripe Connect), KYC gate,
  creator withdrawals. Legal sign-off on custody posture.
- Phase 3 (chain anchor, optional): implement `NearAdapter` behind the existing
  `ProvenanceLedger` port. Lazy-mint on creator opt-in or value threshold.
  Meta-tx relayer for gasless. Nothing in Phases 0 to 2 changes.
- Phase 4 (EVM optionality): `AvaxAdapter` only if a real EVM partner or exit
  liquidity need materialises.

The line to hold: revenue arrives in Phase 1 with no blockchain in the build at
all. Everything chain is additive and deferred behind a port.

---

## 10. Decisions

### 10.1 Locked (2026-05-30 SGT)

- Scope: PRIMARY-ONLY. Anyone can buy; only Gener8 Pro-tier creators can list.
  Creation is a Pro-tier funnel. No user-to-user resale in v1. (Buying a Pro
  subscription is itself an anti-bot cost, Section 12.2.)
- Collection rail: Lemon Squeezy (MoR, already integrated). Platform-as-seller
  model, off-chain creator ledger. Section 11.6.
- Xendit deferred: added later for SEA QR (QRIS / GoPay / OVO / DANA) and as the
  optional xenPlatform no-custody upgrade. Section 11.2.
- Stripe: excluded.

### 10.2 Still open

1. Creator disbursement rail for v1 (Xendit Iris later vs PayPal Payouts vs Wise
   vs manual batch at low volume). LS cannot pay creators; this is on the
   critical path. Section 11.6.
2. Platform rake (bps) on primary sales. Computed in the ledger, not by LS.
3. Payout-enrollment timing: must a creator complete payout KYC BEFORE first
   listing (strong, simple) or may they list first behind a lightweight
   personhood check (lower friction, more bot surface)? Section 12.2 Layer 2.
4. Confirm NEAR as first chain adapter, Avax as documented second; or override
   with an EVM-only partner if one exists.
5. Premium assets download-installable vs cloud-inference-only (the only real
   anti-piracy lever). Section 8.2.
6. Naming: `crates/provenance` + `crates/payout` ports; table prefix `market_`
   vs `trading_post_`. Lock now to avoid a later migration.

---

## 11. P2P rake via PSP split (DEFAULT commerce model)

Added 2026-05-30 SGT. Supersedes Section 3 as the live model.

### 11.1 The correction

"P2P with a rake" does not, by itself, escape custody / money-transmitter
exposure. If card money routes buyer -> platform balance -> seller, you are the
intermediary and you carry the MTL/custody risk regardless of the "P2P" label.

What actually escapes it: a connected-accounts payment processor performs the
split, so the licensed PSP custodies and disburses, and the platform only ever
receives its own application fee (the rake). The platform never holds the
seller's money. This is the OpenSea-fee idea expressed in fiat: the protocol
(here, the PSP) moves the money and skims a fee; the marketplace operator does
not custody funds.

Net effect: this model collapses BOTH open problems from the custodial design,
custody/MTL risk (Section 8.3) and creator payouts (Section 7), into one solved
pattern. That is why it is now the default.

### 11.2 Rails: Lemon Squeezy now, Xendit later (no Stripe)

Decision (2026-05-30): collection runs on Lemon Squeezy (already integrated,
already the subscription rail). Xendit is added LATER for SEA QR payments
(GoPay / OVO / DANA / QRIS) and, optionally, for the xenPlatform split path.
Stripe is excluded by directive.

Consequence you must accept: Lemon Squeezy is MERCHANT-OF-RECORD. LS is the
seller of record on every transaction and remits to ONE payee, the platform.
LS cannot split a sale across many third-party creators. Therefore the
marketplace runs the PLATFORM-AS-SELLER model, not the no-custody split of
Sections 11.1 to 11.5. See Section 11.6 for what that means in practice.

Rail roadmap, behind a thin `PayoutRail` port (same hexagonal move as
`ProvenanceLedger`, so the model can change without touching commerce core):

- v1 collection: Lemon Squeezy (MoR). Platform is merchant. Existing webhooks
  (`webhook_events` dedupe) extend to marketplace SKUs.
- v1 creator disbursement: a SEPARATE payout rail, because LS does not pay
  arbitrary third parties. Options: Xendit `Iris` (SEA, comes with the Xendit
  add), PayPal Payouts, Wise, or batched manual bank transfer while the creator
  count is small. Pick one; see open decisions.
- Later upgrade (optional): Xendit `xenPlatform` managed accounts + split rules.
  This is the ONLY path back to the true no-custody P2P split (Sections 11.1 to
  11.5). If custody posture ever becomes a problem, this is the escape hatch.

### 11.3 Money flow (primary sale, card, no custody)

```
buyer pays by card
  -> Stripe Connect direct charge on SELLER connected account
       amount            = price
       application_fee   = rake (platform)
  -> seller balance credited (price - rake), platform balance credited (rake)
  -> Stripe handles payout to seller's bank on its schedule
  -> webhook (dedup via webhook_events) -> service-role writes:
       user_entitlements (asset_pack|shard_pack, source_ref=content_sha256)
  -> model-manager installs by hash; Vault indexes; applet sees it owned
```

The platform DB writes the entitlement; the platform bank account only ever sees
the rake. Provenance (NFT or off-chain) is registered via the `ProvenanceLedger`
port, still off-chain by default, still optional.

### 11.4 Secondary sale + creator royalty

True resale (user A sells an owned asset to user B) uses "separate charges and
transfers": one charge, three transfer legs split by the PSP:

```
buyer B pays price
  -> reseller A   gets price - royalty - rake
  -> creator C    gets royalty (enforced here, in fiat, at settlement)
  -> platform     gets rake
```

This is where fiat royalty enforcement is actually real, because the split
happens inside the brokered sale. Out-of-garden resale still cannot be enforced;
do not promise otherwise.

### 11.5 The cost you are accepting (challenge)

1. Seller KYC onboarding. Every PAYEE must complete Connect / xenPlatform
   onboarding (identity + bank). This is the friction price of not custodying.
   - Primary-only (creators sell, buyers buy): only creators onboard. A Pro+
     creator providing payout details is acceptable friction.
   - True user-to-user resale: every reselling user must onboard. That is heavy
     friction for casual sellers and a real funnel killer.
   - Recommendation: ship PRIMARY-ONLY first (creator -> buyer, platform rake).
     Add user-to-user resale later, once onboarding UX and volume justify it.
     Do not build the casual-resale KYC funnel on day one.

2. Chargebacks on instant digital goods. Card payments reverse; the asset
   (a LoRA / shard) is copyable the instant it downloads. With direct charges
   the SELLER eats the chargeback, which protects the platform bank but burns
   creator trust. Mitigations: Stripe Radar fraud scoring, account-standing
   gate before buying, short post-purchase hold window for new accounts,
   delivery proof keyed on `content_sha256` (logged download) to win
   "item not received" disputes. Name this in the creator terms.

3. "NFT marketplace" is now narrative + provenance, not settlement. Money is
   card; the chain does not move it. The token is a portable ownership /
   provenance cert behind the same port. Be honest internally: this is a
   PSP-mediated marketplace with NFT provenance, not a trustless on-chain P2P
   DEX. The "NFT" is real but decorative to the money path.

### 11.6 The platform-as-seller posture (the Lemon Squeezy reality, v1 live)

Because LS is merchant-of-record, v1 is the Gumroad model:

```
buyer pays by card / PayPal
  -> Lemon Squeezy (merchant of record) collects, handles tax/VAT
  -> LS remits the lump to the PLATFORM (single payee)
  -> webhook (dedup) -> service-role writes:
       user_entitlements (asset_pack|shard_pack, source_ref=content_sha256)
       ledger_entry      (creator credit = price - rake; platform credit = rake)
  -> creator balance accrues in the off-chain ledger (Section 3 re-activated)
  -> on payout schedule, platform disburses creator balances via the SEPARATE
     payout rail (Xendit Iris / PayPal Payouts / Wise / manual batch)
```

What this costs you, stated plainly so it is not a surprise later:

1. Custody returns. Money lands with the platform, creator balances are a
   payable you hold, you pay them out. This is exactly the custody / payment-
   facilitator posture Section 8.3 warned about. It is MANAGEABLE (Gumroad,
   Ko-fi, itch.io all run it) but it is NOT custody-free. Manage it: keep
   balances as a promptly-paid payable, pay out on a short fixed cadence, do
   NOT offer a stored-value wallet creators can hoard or withdraw as cash on
   demand. That posture keeps you a marketplace, not a money transmitter. Loop
   somokasane Pte Ltd counsel before balances accrue at volume.

2. The "free proof-of-personhood via payout KYC" elegance weakens. LS does not
   KYC your creators (LS only knows the platform). So creator personhood needs
   its OWN gate now, attached to payout enrollment, not to checkout. See
   Section 12.2 Layer 2 (revised).

3. Rake is taken in the ledger, not by the PSP. LS bills the buyer the full
   price; the platform splits price into creator credit + rake inside
   `ledger_entry`. The rake is real revenue but it is computed by you, not by
   the processor. Reconciliation lives in the ledger.

This is a fine v1. It ships on the rail you already have, and the Xendit
xenPlatform upgrade (Section 11.2) remains the documented exit to no-custody if
you ever want it. The `PayoutRail` port is what keeps that exit cheap.

---

## 12. Reviews, ratings, and proof-of-personhood (anti-bot)

Added 2026-05-30 SGT.

### 12.1 Ratings and reviews

```
review
  review_id, asset_id -> asset, reviewer_user_id -> profiles
  stars            int 1..5
  body             text (optional)
  verified_purchase bool   <-- only buyers who own the asset_version can review
  helpful_count    int
  status           enum(visible, hidden, flagged, removed)
  created_at, updated_at
  unique (asset_id, reviewer_user_id)   one review per user per asset

asset (add aggregates, denormalised for catalog sort)
  rating_avg, rating_count, sales_count
```

Integrity rules that matter more than the schema:

- Verified-purchase only. `verified_purchase = true` requires a matching
  `user_entitlements` row. Unverified reviews either disallowed or visibly
  second-class. This kills most review spam at the source: you cannot review
  what you did not buy, and buying costs money + KYC-gated card.
- One review per user per asset (unique constraint above).
- Creator cannot review own asset (FK check creator_user_id != reviewer).
- Weight ratings by reviewer trust score (Section 12.2) so a fresh account's
  5-star carries less than an established buyer's.

### 12.2 Proof-of-personhood: stop botted creations and botted reviews

Two distinct bot threats, one shared defence:

- Creation botting: scripts spinning up accounts to mass-upload junk / stolen
  LoRAs to farm catalog space or launder stolen assets.
- Review botting: sockpuppets inflating an asset's stars.

Defence is layered, cheapest first. Do NOT lead with KYC for everyone; gate it
to the act that needs it.

Layer 1, friction at signup: email + the platform's existing auth. Cheap,
stops nothing determined, filters the lazy.

Layer 2, human verification to BECOME A CREATOR (the real gate). Creation is a
Gener8 Pro tier funnel: anyone can buy, only Pro-tier creators can list (locked
decision, Section 10.1). Make the listing privilege also require a
proof-of-personhood step, done ONCE per creator. Note (revised for Lemon Squeezy):
LS is merchant-of-record and does NOT KYC your creators, so personhood cannot
free-ride on checkout the way it would on a connected-accounts PSP. Attach it to
PAYOUT ENROLLMENT instead:
  - Cheapest credible in the LS model: require creator payout enrollment (bank /
    e-wallet details + ID for the disbursement rail: Xendit Iris / PayPal
    Payouts / Wise) BEFORE the first listing goes live. A creator who has
    submitted real payout identity to get paid is a verified human; bots do not
    pass bank-grade KYC at scale. The two requirements (get paid, prove
    personhood) become the same step, just enforced at payout-enrollment rather
    than at checkout.
  - Bridge for "list before first payout": if a creator may list before payout
    enrollment, gate that window with a lightweight personhood check (liveness /
    document check, or a privacy-preserving uniqueness proof) plus the Pro-tier
    paywall (a bot must buy a Pro subscription per identity, which already costs
    money through LS). Decision deferred; payout KYC remains the strong gate.

Layer 3, behavioural + device signals: you already have a `devices` table
(`device_fingerprint_sha256`). Rate-limit uploads per device + per account,
cluster-detect (many accounts, one device fingerprint, one payout instrument),
and velocity-flag for review.

Layer 4, content-side dedupe (already in Section 6): `content_sha256` collision
on upload auto-quarantines stolen / re-uploaded assets independent of who the
uploader is.

The clean line: anti-bot for creators is not a new subsystem. It is the payout
KYC (Layer 2) + the existing `devices` fingerprint (Layer 3) + the existing
hash dedupe (Layer 4). Reviews are protected by verified-purchase gating
(Section 12.1), which inherits all of the above because buying requires a real
carded, KYC-adjacent account.

---

## Appendix A: New surfaces (nothing here is built)

```
crates/provenance/                  ProvenanceLedger trait + OffchainLedger
  (later) adapters/near/            near-sdk-rs contract + relayer client
  (later) adapters/avax/            ethers-rs client to Solidity contract

supabase/migrations/
  00XX_market_assets.sql            asset, asset_version, price, license
  00XX_market_purchase_bridge.sql  purchase -> user_entitlements writer fn
  00XX_market_reviews.sql          review (verified_purchase gated), aggregates
  00XX_market_seller_accounts.sql  connected-account binding (Stripe/Xendit)
  (custodial-only) 00XX_market_ledger.sql  ledger_entry, creator_balance
                                            — only if Section 3 path is taken

applets/                            Trading Post UI (web applet, EWDS v2)
  reuses 1magen / my_mait / character_studio install hooks
```

## Appendix B: Identity invariant (the whole design in one line)

```
content_sha256  ==  model-manager install id
                ==  Vault index identity
                ==  user_entitlements.source_ref
                ==  on-chain token key (when/if anchored)
```

One hash. Four systems. Zero reconciliation. That invariant is the architecture;
everything else is plumbing around it.
