# Applet Manifests, Permissions, Signing, and Trust Levels

This document specifies how Everywear evaluates trust. It covers the manifest schema, the permission model, the signing pipeline, and what each trust level can and cannot do.

The model is built on a single premise: the shell trusts what is declared, verifiable, and signed. It does not trust UI claims, runtime promises, or assertions made by JavaScript.

---

## 1. Trust levels at a glance

| Tier | Distribution | Signed | Reviewed | Permissions allowed | Vault | Models | Privileged IPC |
|---|---|---|---|---|---|---|---|
| External URL Applet | URL registration | No (URL only) | URL-level review | None | None | None | None |
| Compatible Applet | Local package, unsigned or self-signed | Optional | Automated checks only | Limited, scoped | Read-only opt-in | None by default | Limited |
| Verified Applet | Local package, signed | Required | Manifest + code review | Full declared set, scoped | Scoped opt-in | Declared, hash-verified | Full per declaration |
| First-party Applet | Internal pipeline | Required | Internal review | Platform set | Full per scope | Full per declaration | Full |

Trust is not a marketing label. It is a runtime privilege set enforced by the Rust shell. The user can see your tier in the applet's chrome.

---

## 2. The manifest

The manifest is the source of truth for your applet's identity, surfaces, permissions, assets, entitlements, and update behaviour. Every install, update, and runtime privilege decision keys off the manifest.

### 2.1 Schema (illustrative)

```json
{
  "schema_version": "1.0",
  "id": "com.example.notepad",
  "name": "Notepad",
  "version": "1.2.0",
  "tier_requested": "verified",
  "publisher": {
    "name": "Example, Inc.",
    "contact": "support@example.com",
    "public_key_id": "ed25519:9f86d081..."
  },
  "surfaces": ["rounded", "square"],
  "entry": "ui/index.html",
  "permissions": {
    "vault.read":   { "scope": ["com.example.notepad/*"] },
    "vault.write":  { "scope": ["com.example.notepad/*"] },
    "storage":      true,
    "network.fetch":   { "domains": ["api.example.com"] },
    "network.upload":  { "domains": ["api.example.com"], "reason": "Sync notes to your account" }
  },
  "assets": [
    {
      "id": "spellcheck-en",
      "kind": "data",
      "source": "https://cdn.example.com/spellcheck-en.bin",
      "size_bytes": 12000000,
      "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    }
  ],
  "entitlements": {
    "pro_export": {
      "enforced_by": ["cloud", "rust"],
      "claim_audience": "everywear.com"
    }
  },
  "icon": {
    "footprint_24": "assets/icon-24.svg",
    "footprint_48": "assets/icon-48.svg",
    "themes": ["light", "dark", "high-contrast"]
  },
  "telemetry": {
    "collects_user_content": false,
    "anonymous_usage": true,
    "endpoint": "https://telemetry.example.com/v1"
  },
  "update": {
    "channel": "stable",
    "min_shell_version": "1.4.0"
  }
}
```

### 2.2 Mandatory fields

`schema_version`, `id`, `name`, `version`, `tier_requested`, `publisher`, `surfaces`, `entry`, `icon`.

Everything else is required only if used. Declaring nothing means you have nothing.

### 2.3 Identity

- `id` is reverse-DNS, globally unique, immutable across versions. Squatting is grounds for rejection.
- `version` follows SemVer. Permission widening across versions triggers re-consent.
- `publisher.public_key_id` is required for Verified and First-party tiers. It pins the signing key the shell will check.

---

## 3. The permission model

All privileged operations require a declared permission. The shell's permission broker evaluates every IPC call against:

1. What you declared in the manifest.
2. What the user consented to at install or first use.
3. What your tier is allowed to request at all.

### 3.1 Permission catalog (excerpt)

| Permission | Tier minimum | Notes |
|---|---|---|
| `storage` | Compatible | Applet-scoped local KV. |
| `vault.read` | Compatible | Scoped to your applet namespace by default. |
| `vault.write` | Compatible | Scoped. Cross-namespace writes are Verified-only and require user-facing reason. |
| `network.fetch` | Compatible | Declared HTTPS domains only. |
| `network.upload` | Compatible | Requires `reason` string shown to user at install. |
| `network.realtime` | Verified | WebSocket/WebRTC, declared endpoints only. |
| `model.use` | Compatible | Use a shell-provided or applet-declared model. |
| `model.fine_tune` | Verified | Requires declared compute scope. |
| `clipboard.read` | Compatible | One-shot read on user gesture. |
| `clipboard.write` | Compatible | One-shot write on user gesture. |
| `notifications` | Compatible | User-controllable. |
| `background.work` | Verified | Requires declared budget and trigger. |
| `system.theme.read` | Compatible | Already provided via context; this is for explicit poll. |
| `shell.context.broadcast` | Verified | Send context events to other applets via the shell. |
| `shell.context.subscribe` | Verified | Receive context events from the shell. |
| `agent.invoke` | Verified | Call the agentic layer from inside the applet. |
| `vault.cross_applet_read` | First-party | Reserved. |
| `device.privileged` | First-party | Reserved for hardware integrations. |

### 3.2 Scoping

Permissions are scoped by default. A `vault.read` request without a scope is invalid. A `network.fetch` without declared domains is invalid. The broker will reject these at install.

### 3.3 Consent

The shell prompts the user for permissions at install for declared, sensitive scopes. Less sensitive scopes are granted implicitly on install. Some scopes (e.g. clipboard, notifications) prompt on first use. The user can revoke any granted scope at any time from the shell's permissions panel; your applet must handle revocation gracefully.

### 3.4 Widening across updates

Adding a permission across versions is permitted, but it triggers user re-consent at update time. Removing a permission is silent. Trying to use a permission you did not declare is a runtime error, not an upgrade path.

---

## 4. Signing

### 4.1 Algorithm and format

- Signature algorithm: **Ed25519**.
- Hash algorithm: **SHA-256**.
- Signature covers: the canonicalised manifest, the asset hash list, and the package content digest.
- Format: detached signature file inside the package, plus an inline reference in the manifest.

### 4.2 Key management

- Generate your signing keypair locally. Do not put your private key on a CI runner you do not control.
- Register the public key fingerprint in the developer portal under your publisher identity.
- Rotation is supported via the portal; new versions can be signed by the new key once the rotation record is published. Old versions remain validly signed by the old key.

### 4.3 Signing flow

```
everywear pack ./my-applet         # produces unsigned package
everywear sign  ./my-applet.pkg    # signs with local keypair
everywear verify ./my-applet.pkg   # dry-runs hash and signature checks
everywear submit ./my-applet.pkg   # uploads to portal
```

### 4.4 Revocation

The shell checks a revocation list at update and periodically at idle. Revoked publisher keys or revoked package versions are removed from the registry; installed applets become inactive on next launch with a clear user-facing reason. We will revoke for:

- Confirmed malicious behaviour.
- Permission abuse documented in review.
- Hash mismatches between declared and shipped assets.
- Repeated guideline violations after warning.

### 4.5 What signing does not do

Signing proves the package is from you and unmodified since you signed it. It does not vouch for behaviour, quality, or safety. That is what review is for. Self-signed packages are accepted at Compatible tier; Verified status requires review.

---

## 5. Assets and hash verification

Every declared asset is hash-verified before activation. If the hash does not match, the asset is rejected, the applet is marked blocked, and the user sees a clear message. There is no override.

This applies to:

- Models declared in the manifest.
- Large content packs declared in the manifest.
- Any file fetched via a declared `network.fetch` that the manifest pins by hash.

Undeclared downloads are blocked at the broker. Trying to bypass the broker, for example by injecting a remote script into the DOM at runtime, fails outright in privileged tiers because the runtime forbids remote module execution.

---

## 6. Entitlements

Entitlements are signed claims issued by your backend (or by Everywear, for first-party features) that gate paid or restricted functionality.

### 6.1 Declared in manifest

```json
"entitlements": {
  "pro_export": {
    "enforced_by": ["cloud", "rust"],
    "claim_audience": "everywear.com"
  }
}
```

### 6.2 Verified at runtime

```ts
const claim = await context.ipc.entitlements.get("pro_export");
if (!claim.valid) {
  // UI hint only; do not call the gated capability
}
```

The shell verifies the claim signature against the declared issuer. The gated capability itself is enforced server-side or in Rust, not by your frontend check. If you only check in JS, you are not gating; you are decorating.

### 6.3 Offline behaviour

Entitlements may be cached with a short expiry to support offline use. Expiry, refresh, and degraded-mode behaviour are declared in the manifest. Do not invent an indefinite offline grant.

---

## 7. Trust level details

### 7.1 External URL Applet

- Distribution: URL registered in the developer portal.
- Runtime: rendered in a sandboxed surface with no privileged IPC.
- Permissions: standard web sandbox only.
- Use when: you have a web product and want a presence in the Everywear registry without committing to local packaging.

### 7.2 Compatible Applet

- Distribution: local package, optionally self-signed.
- Review: automated lint, manifest schema, asset hash validity.
- Permissions: limited, scoped, declared in manifest, user-consented at install.
- Vault: read-only opt-in to your applet namespace.
- Models: not provisioned by default; you may declare and ship small assets.
- Use when: you want local presence with modest privilege.

### 7.3 Verified Applet

- Distribution: signed local package, submitted for review.
- Review: manifest, packaging, code, security posture, design conformance.
- Permissions: full declared set within tier-allowed catalog, scoped, consented.
- Vault: scoped read and write inside your namespace; cross-namespace requires justification.
- Models: declared, hash-verified, eligible for shared model store residency.
- Use when: your applet is central to a workflow and needs real platform integration.

### 7.4 First-party Applet

- Distribution: Everywear internal pipeline.
- Review: internal security and design review.
- Permissions: platform set, including reserved capabilities.
- Use when: you are Everywear.

---

## 8. Review process (Verified)

1. Submit a signed package via the developer portal.
2. Automated checks run within minutes: manifest schema, lint, signature, asset hashes.
3. Manual review opens. Target turnaround: 5 business days for first submission, 2 for subsequent updates without permission widening.
4. Reviewer notes are returned in the portal. You respond, resubmit, or appeal.
5. On approval, your package becomes available at the Verified tier and the user-visible tier badge is granted.

We will reject for:

- Undeclared permissions or assets.
- Frontend-only entitlement enforcement.
- Remote script execution.
- Vault scope without clear justification.
- EWDS violations not fixed after lint feedback.
- Telemetry on user content without a declared, justified reason.
- Behaviour that materially differs from what the manifest declares.

---

## 9. Threat model, briefly

We assume:

- The user's machine is honest but inspectable.
- Network is untrusted unless authenticated.
- Frontend code is fully visible to any attacker.
- Applet processes are isolated by the shell sandbox.

We rely on:

- Signed manifests and packages to prove origin and integrity.
- Hash-pinned assets to prove what is being run or loaded.
- Rust-side and cloud-side enforcement for entitlements and privileged operations.
- The permission broker as the single mediator of capability use.
- Revocation as the response when trust is broken.

We do not rely on:

- UI obfuscation.
- Frontend feature flags as security.
- Self-attested behaviour at runtime.

---

## 10. If you are stuck

Open a thread in the developer portal under your applet's submission. Reviewers can look at your manifest, your lint output, and your verification logs. Most rejections come from missing declarations, not from policy disputes.
