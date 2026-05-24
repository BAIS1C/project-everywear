# Building Everywear-Compatible Applets

A practical guide for developers building applets that run inside the Everywear shell. Everywear is a Tauri/Rust agentic desktop OS. Your applet runs locally, inside a frame the shell owns, with access to platform capabilities that scale with your trust tier.

This guide assumes you have read **ADR-001: Local Applet UI, EWDS Compatibility, and Privileged Applet Contracts**. If you have not, do that first, then come back. The rules below will make more sense.

---

## 1. What an applet actually is

An applet is a packaged module that the Everywear shell can install, register, launch, and tear down. It owns its domain UI and workflow. It does not own the desktop, the auth state, the vault, the registry, or the design tokens. Those belong to the shell.

You write applet UI against the EWDS runtime and talk to the platform through declared IPC. The shell renders the frame, handles permissions, brokers vault access, and verifies any model or asset you declare.

You are not writing a webapp. You are writing a guest in someone else's window manager. Build accordingly.

---

## 2. Anatomy of an applet package

```
my-applet/
  manifest.json             # identity, version, surfaces, permissions, assets
  signing/                  # signature material (Verified/First-party only)
  ui/                       # local UI bundle (HTML/JS/CSS or framework build)
  workers/                  # optional in-process or worker logic
  assets/                   # icons, images, fonts
  models/                   # optional, with declared hashes in manifest
  README.md
```

Everything executable ships in the package. No remote script tags. No CDN imports at runtime for privileged tiers. If you need a dependency, vendor it.

---

## 3. Lifecycle

The shell drives lifecycle. You hook into it.

| Phase | Shell does | You do |
|---|---|---|
| Register | Reads manifest, validates schema, evaluates trust tier | Provide a correct manifest |
| Install | Verifies signatures and asset hashes, prepares sandbox, prompts user for declared permissions | Declare every permission you need |
| Launch | Allocates a surface, injects EWDS runtime, opens IPC channel | Implement `onMount(context)` |
| Active | Routes user input, mediates IPC, enforces permissions | Run your workflow |
| Suspend | Freezes background work, persists last state | Implement `onSuspend()` |
| Resume | Restores state, re-issues capability handles | Implement `onResume(context)` |
| Close | Tears down surface, revokes capability handles | Implement `onClose()` cleanly |
| Update | Verifies new signature, diffs permissions, requests re-consent on widening | Bump version, update manifest |

A clean `onClose` is not optional. Leaving handles open or background timers running will get your applet flagged on the next review.

---

## 4. The applet runtime, briefly

Inside your applet you receive a `context` object from the shell:

```ts
interface EverywearContext {
  shell: ShellInfo;            // version, locale, theme, surface assigned
  session: SessionView;        // read-only view of current user session
  ipc: IpcClient;              // typed IPC to permission-broker methods
  vault: VaultClient | null;   // present only if vault scope granted
  storage: StorageClient;      // applet-scoped local KV
  events: EventBus;            // shell-level events (theme change, suspend, etc)
  ewds: EwdsRuntime;           // design tokens, primitives, surface helpers
}
```

You never reach for browser globals to get platform state. The shell tells you who the user is, what surface you got, what theme is active, and what you are allowed to do. If you find yourself trying to detect the OS, the network, or the user by sniffing the DOM, stop. Ask the shell.

---

## 5. Surfaces

EWDS defines three surface styles your applet can be assigned to or request:

- **Cut.** Hard geometric corners, dense, technical. Used for tools, inspectors, dashboards.
- **Rounded.** Soft corners, conversational, friendly. Used for chat, content creation, social.
- **Square.** Neutral right-angle frame, no rounding. Used for grids, canvases, media surfaces.

Your manifest declares which surfaces you support. The shell may assign the surface based on user context, layout, or applet category. Do not assume one. Layout against the EWDS spacing scale and let the surface decide its own corner radius and edge treatment.

Full surface rules and tokens live in the **EWDS Applet Design Contract**.

---

## 6. Talking to the platform: IPC

All privileged operations go through the shell's permission broker via IPC. There is no direct filesystem, no direct vault, no direct model loader.

Example: reading from the vault under a scoped capability.

```ts
// manifest.json (excerpt)
{
  "permissions": {
    "vault.read": { "scope": ["my-applet/*"] }
  }
}

// applet code
const handle = await context.vault.requestRead("my-applet/notes.json");
if (handle.ok) {
  const data = await handle.read();
  // ...
}
```

The shell evaluates the request against your declared scope and the user's prior consent. If denied, you get a typed error. Show a graceful message, do not retry in a loop.

---

## 7. Models and large assets

If your applet ships with or downloads a model, weight pack, dataset, or any asset over the small-asset threshold (currently 5 MB), it must be declared:

```json
"assets": [
  {
    "id": "voice-encoder-v2",
    "kind": "model",
    "source": "https://cdn.example.com/voice-encoder-v2.safetensors",
    "size_bytes": 482000000,
    "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "license": "Apache-2.0"
  }
]
```

The shell downloads, verifies the hash, and caches in the shared model store. If the hash mismatches, the asset is rejected and the user is informed. You do not get to ship undeclared downloads. Background downloading outside the declared asset list is grounds for revocation.

---

## 8. Entitlements and paid features

If your applet has free and paid features, gate them correctly.

- **Frontend gating is UX only.** Hiding a button is a hint, not a security boundary.
- **Real enforcement happens in Rust or in your cloud backend.** The shell exposes a signed entitlement claim per session; verify it before executing the gated capability.
- **Do not roll your own entitlement check in JS.** It will be bypassed within a day.

If your premium feature runs locally and you are worried about extraction, that worry is fair, but the answer is not UI obfuscation. The answer is server-issued execution tokens, signed model unlocks, or rate-limited cloud-assisted execution. Pick a model that matches your threat tolerance.

---

## 9. Vault and user data

The vault is the user's encrypted local store. You touch it only through scoped capabilities. Rules:

- Declare every scope you read or write.
- Use namespaced keys: `your-applet-id/...`.
- Never request blanket vault scope. It will be denied.
- Treat vault writes as user-visible state. The user can audit and revoke.
- Do not exfiltrate vault data to your servers without an explicit `network.upload` scope and a clear user-facing reason.

If your applet does not need the vault, do not request it. Smaller permission surface, faster approval.

---

## 10. Networking

Network access is a declared capability. Three flavours:

| Scope | Use |
|---|---|
| `network.fetch` | Outbound HTTPS to declared domains |
| `network.upload` | Outbound uploads of user content; requires explicit user-facing reason string |
| `network.realtime` | WebSocket or WebRTC sessions; requires declared endpoints |

Domains must be declared. Wildcards are permitted only for documented CDN patterns. Undeclared domains are blocked at the broker.

---

## 11. Storage

Three layers, pick the right one:

- **`context.storage`** Applet-scoped local KV. Use for UI state, recent items, preferences.
- **Vault** User-owned encrypted store, scoped capability. Use for content the user owns.
- **Shared storage** Read-only shared assets exposed by the shell (downloaded models, fonts, presets). Use through declared asset references, not raw paths.

Do not write to the user filesystem outside these layers. There is no `fs.writeFile` for applets.

---

## 12. Sizing your code

Applets should be context-window-sized code modules where possible. The agentic layer of Everywear can reason about your applet faster when it can fit the whole module in a single window. Practical guidance:

- Aim for individual modules under roughly 65k tokens of source.
- Split by domain, not by file-size cosmetics.
- Keep the applet root entry small and obvious.
- Avoid deep dependency graphs for trivial reasons.

This is not a hard build-time rule. It is a strong cultural rule. The platform will help you check it; see the `context-protocol` skill.

---

## 13. Local development loop

1. Scaffold from `everywear-create-applet` (CLI) or copy a starter.
2. Run `everywear dev` to launch your applet inside a development shell that mirrors production surfaces and permissions.
3. The dev shell will prompt for every declared permission. Test with permissions both granted and denied.
4. Run `everywear lint` for manifest, EWDS, and accessibility checks.
5. Run `everywear pack` to produce a candidate package.
6. Run `everywear verify <package>` to dry-run signing and asset hashing.

If any of `lint`, `pack`, or `verify` fail, submission will fail. Fix locally.

---

## 14. Distribution

| Tier | How you ship |
|---|---|
| External URL Applet | Register URL in the developer portal; users open it from the registry |
| Compatible Applet | Submit unsigned package; users install with permission prompts |
| Verified Applet | Submit signed package + review request; reviewed by Everywear platform team |
| First-party Applet | Internal pipeline only |

Distribution tier maps to trust tier. There is no "looks compatible, gets verified privileges" loophole. Verification is earned by review.

---

## 15. Updates

- Updates ship as new signed package versions.
- Permission widening triggers user re-consent at install time.
- Asset hash changes trigger re-verification.
- Backwards-incompatible permission removal is allowed and safe.
- Silent rollback is supported if a hash check fails on update.

Do not ship "remote feature flags" that flip on previously-unrequested capabilities. The capability set is what is in the manifest.

---

## 16. Things that will get your applet rejected

A short list, not exhaustive:

- Remote script execution in a privileged tier.
- Undeclared network domains or undeclared downloads.
- Entitlement enforcement only in frontend code.
- Vault scope requested without a justified use.
- Custom window chrome that bypasses the shell frame.
- Blocking the user from closing the applet.
- Background work that ignores `onSuspend`.
- Hidden telemetry on user content.
- Bypassing EWDS focus and accessibility primitives.

If you are unsure whether something will pass review, ask before you build it.

---

## 17. Where to go next

- Design rules: `docs/developers/design/ewds-applet-design-contract.md`
- Manifest, permissions, signing: `docs/developers/security/applet-manifests-permissions-signing-trust.md`
- Pre-submission checklist: `docs/developers/checklists/before-you-submit-an-applet.md`
