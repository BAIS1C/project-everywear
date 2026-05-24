# ADR: Local Applet UI, EWDS Compatibility, and Privileged Applet Contracts

**ID:** ADR-001
**Status:** Accepted
**Date:** 2026-05-24
**Owners:** Everywear Platform
**Supersedes:** prior "cloud-hosted first-party UI" assumption

---

## 1. Context

Everywear is an agentic desktop operating system built on Tauri and Rust, with applet UIs running inside the shell. Until now we have assumed that first-party applet UI had to be hosted in the cloud to enforce entitlement, anti-piracy, and update control.

That assumption is wrong on two grounds:

1. **UI secrecy is not a security boundary.** Whether served from a CDN or shipped in a signed bundle, applet UI can be inspected by any sufficiently motivated user. Treating the browser as a trust boundary is theatre.
2. **Cloud-hosted UI creates latency, offline brittleness, deployment coupling, and a poor agentic experience.** Everywear is a local-first OS. Forcing applets through a remote render path contradicts the product.

The real trust boundary is not "where the HTML is served from." It is:

- Signed and verifiable applet packages.
- Manifest-declared permissions enforced by the Rust shell.
- Entitlement and feature gating evaluated by Rust and cloud services, not by frontend code.
- Hash-verified downloads and models.
- Scoped vault and filesystem access via the shell's permission broker.

This ADR records the decision to move first-party UI local, universalize EWDS and the applet runtime, and define a tiered trust contract for third-party applets.

---

## 2. Decision

### 2.1 First-party applets ship UI locally

First-party applet UI lives inside the signed Tauri/Rust distribution or in a signed first-party applet package. No first-party applet renders its primary UI from a remote URL.

### 2.2 The Everywear shell owns the platform surface

The base shell is the sole owner of:

| Surface | Owner |
|---|---|
| Desktop frame, window chrome, system tray | Shell |
| Auth, session display, account state | Shell |
| Vault and shared storage | Shell |
| Applet registry, install, update, launch lifecycle | Shell |
| EWDS design system tokens and primitives | Shell |
| Permission broker and capability grants | Shell |
| Model and download verification | Shell |
| Applet runtime sandbox | Shell |

Applets do not reimplement any of these. They consume them through the EWDS runtime and the shell IPC.

### 2.3 Applets own their domain

Applets own:

- Internal workflow and state.
- Domain UI surfaces inside the EWDS frame.
- Creative identity (brand, icon expression inside the footprint, accent, content design).
- Engine-specific controls (inference parameters, canvas tools, transport, etc).

### 2.4 EWDS compliance is integration, not visual sameness

Applets must obey shell integration rules: window chrome, minimum contrast, spacing rhythm, keyboard focus model, status state semantics, safe file access, and predictable launch and close behaviour. They are explicitly permitted brand and creative identity inside that frame.

### 2.5 Trust is tiered

Four applet trust levels, with privilege rising with verification:

| Tier | Distribution | Privileged IPC | Vault | Models | Notes |
|---|---|---|---|---|---|
| External URL Applet | Remote website | None | None | None | Opens in a sandboxed surface; treated like a bookmark with chrome. |
| Compatible Applet | Local bundle, manifest declared, EWDS compliant | Limited, scoped | Read-only opt-in | None by default | Entry tier for third-party. |
| Verified Applet | Signed package, manifest reviewed | Scoped per declaration | Scoped opt-in | Declared, hash-verified | Eligible for deeper integration after review. |
| First-party Applet | Maintained and signed by Everywear | Full | Full per scope | Full per declaration | Internal review process. |

### 2.6 Entitlement is enforced server-side and Rust-side, never UI-side

Paid features, premium models, and account-tier features are gated by Rust shell checks against signed entitlements from Everywear services. Frontend gating is a UX hint, never the enforcement point.

### 2.7 No remote scripts in privileged applets

Compatible, Verified, and First-party applets must not execute remotely fetched code. All executable assets ship inside the signed package. Data fetches and API calls are permitted under declared network scopes.

### 2.8 Declared assets only

Models, weights, large packs, and any download over a small threshold must be declared in the manifest with expected size, source URL, and SHA-256. The shell verifies before activation. No hidden background downloads.

---

## 3. Consequences

### Positive

- Local-first parity for first-party and third-party developers.
- A single, defensible trust model that does not depend on UI obfuscation.
- Lower latency, offline capability, predictable updates.
- A clear path for third-party developers to earn deeper privilege.
- EWDS becomes a public design contract, which lets the ecosystem grow without visual homogenisation.

### Negative / accepted trade-offs

- Larger initial download for first-party applets shipped in-bundle.
- Internal teams must adopt the same applet packaging discipline as third-parties.
- We must operate a real signing, review, and revocation pipeline.
- We commit to keeping EWDS stable enough that external developers can build against it.

### Required follow-ups

- Publish EWDS tokens, primitives, and surface definitions.
- Publish the manifest schema and signing toolchain.
- Stand up the review and revocation service.
- Migrate any first-party applet currently relying on cloud-only UI to local packaging.

---

## 4. Alternatives considered

**Keep first-party UI cloud-hosted for "security".** Rejected. UI inspection is trivial; this provided no real protection and harmed UX.

**Force visual uniformity across all applets via mandatory EWDS components only.** Rejected. Kills third-party creative identity and signals a closed platform. Integration discipline gets us the consistency we actually need.

**Single trust level for all third-party applets.** Rejected. Either too permissive (security risk) or too restrictive (no path to deep integration). Tiering matches the real risk gradient.

**WebView-only sandbox with no native applet runtime.** Rejected. Eliminates the agentic, local-first capabilities that are Everywear's core differentiation.

---

## 5. Glossary

- **Shell:** the Everywear Tauri/Rust base process and its UI frame.
- **Applet:** a user-facing module that runs inside the shell.
- **Surface:** an EWDS-defined region or container style (Cut, Rounded, Square).
- **EWDS:** Everywear Design System.
- **Manifest:** the declarative file describing an applet's identity, permissions, assets, and entitlements.
- **Permission broker:** the shell subsystem that grants, scopes, and audits capability use.
- **Vault:** the user's encrypted local store managed by the shell.

---

## 6. References

- `docs/developers/guides/building-everywear-compatible-applets.md`
- `docs/developers/design/ewds-applet-design-contract.md`
- `docs/developers/security/applet-manifests-permissions-signing-trust.md`
- `docs/developers/checklists/before-you-submit-an-applet.md`
