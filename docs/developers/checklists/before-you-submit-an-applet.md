# Before You Submit an Applet

A short, scannable checklist. If anything below is unchecked, fix it before you submit. This list is what reviewers run through; passing it locally means you skip the first round of rejections.

---

## Identity and manifest

- [ ] `id` is reverse-DNS, globally unique, immutable across versions.
- [ ] `version` follows SemVer and is higher than any previously submitted version.
- [ ] `tier_requested` matches what you are actually asking for.
- [ ] `publisher.public_key_id` is present and pinned (Verified and First-party).
- [ ] `surfaces` lists every surface your UI is built for, no more, no less.
- [ ] `entry` points to your local UI bundle.
- [ ] Manifest passes `everywear lint`.

## Permissions

- [ ] Every permission you use is declared.
- [ ] No permission is declared that you do not use.
- [ ] All scopes are explicit. No blanket vault, no wildcard network.
- [ ] `network.upload` includes a clear, user-facing `reason`.
- [ ] Sensitive scopes have a justification in the submission notes.
- [ ] You have tested with each permission both granted and denied.

## Assets

- [ ] Every asset over 5 MB is declared in the manifest.
- [ ] Each declared asset has `size_bytes`, `source`, and `sha256`.
- [ ] Hashes match the actual file content. `everywear verify` passes.
- [ ] No background downloads happen outside the declared list.
- [ ] No remote scripts are loaded at runtime in privileged tiers.

## Entitlements

- [ ] Paid features are enforced by Rust shell or your cloud, never by frontend alone.
- [ ] Entitlement claims are signed and verified.
- [ ] Offline behaviour is declared and matches what the applet does.
- [ ] Frontend gating exists only as a UX hint, with the real check downstream.

## EWDS and design

- [ ] All spacing uses EWDS tokens. No hard-coded pixels off the scale.
- [ ] All typography uses the EWDS ramp.
- [ ] Contrast meets WCAG AA for body text and interactive controls.
- [ ] Status states use the EWDS semantic vocabulary.
- [ ] Focus uses the EWDS focus primitive on every interactive element.
- [ ] Keyboard parity exists for every pointer affordance.
- [ ] Surface declaration in manifest matches what the UI actually uses.
- [ ] You did not redraw the shell chrome, title bar, or window controls.
- [ ] Reduced-motion preference is respected.
- [ ] Theme works in light, dark, and high-contrast.

## Icons

- [ ] 24px and 48px footprint variants exist.
- [ ] Theme variants exist (light, dark, high-contrast).
- [ ] Icon is legible at 16px in the registry list.
- [ ] Icon fits the EWDS footprint and does not break adjacent registry layout.

## Lifecycle

- [ ] Applet mounts within 1 second on reference hardware.
- [ ] `onMount`, `onSuspend`, `onResume`, `onClose` all implemented.
- [ ] Suspend stops background work; resume restores state.
- [ ] Close releases all handles, timers, network connections.
- [ ] No "are you sure" prompt on close unless there is genuine unsaved work, and only via the EWDS confirmation primitive.

## Data and privacy

- [ ] Vault writes use your applet namespace.
- [ ] No vault data is exfiltrated without `network.upload` and a clear user-facing reason.
- [ ] Telemetry is declared in the manifest.
- [ ] Telemetry does not include user content unless declared and justified.
- [ ] Crash and error reports do not leak user content by default.

## Code and packaging

- [ ] Modules are reasonably sized (target under 65k tokens per module).
- [ ] No CDN imports at runtime in privileged tiers; dependencies are vendored.
- [ ] No `eval` or remote module loading.
- [ ] Package builds reproducibly from your source tree.
- [ ] `everywear pack`, `everywear sign`, `everywear verify` all pass clean.

## Updates

- [ ] You understand which permission changes trigger user re-consent.
- [ ] You have a rollback plan if a release fails verification on user machines.
- [ ] `min_shell_version` is set correctly.

## Documentation

- [ ] Your applet has a README that explains what it does and what permissions it requests.
- [ ] Publisher contact in the manifest is monitored.

## Final pass

- [ ] You read the **ADR-001**.
- [ ] You read the **Building Everywear-Compatible Applets** guide.
- [ ] You read the **EWDS Applet Design Contract**.
- [ ] You read the **Applet Manifests, Permissions, Signing, and Trust Levels** spec.
- [ ] You ran `everywear lint`, `everywear pack`, `everywear sign`, and `everywear verify` end-to-end without errors.
- [ ] You tested install, launch, suspend, resume, update, and close in the dev shell.
- [ ] You asked yourself: if a reviewer reads only my manifest, can they tell exactly what my applet does and why it needs what it needs? If yes, submit.
