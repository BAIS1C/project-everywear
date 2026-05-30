# Everywear Shell Password Reset Contract

## Scope

Project location: `C:\Users\MAG MSI\Project Everywear`.

This page defines the missing forgot-password / password-reset flow for
Everywear ID. It is architecture only as of 2026-05-30; no Supabase project
settings have been changed.

## Current State

- Shell auth UI lives in `platform/everywear-os/src/shell/AuthGate.tsx`.
- Shell auth methods live in `platform/everywear-os/src/shell/AuthContext.tsx`.
- Current modes are `login`, `signup`, and `otp-verify`.
- Current methods are `signInWithPassword`, `signUp`, `verifyOtp`, `signOut`,
  `refresh`, and `startTrial`.
- No reset-password UI exists.
- No `supabase.auth.resetPasswordForEmail(...)` wrapper exists.
- No `supabase.auth.updateUser({ password })` recovery wrapper exists.
- Tauri currently has no deep-link plugin registered for `everywear://`.
- `supabase/config.toml` currently allow-lists normal web/http redirect URLs,
  not a desktop deep-link reset URL.

## Decision

Password recovery must use Supabase Auth. Passwords are never readable from
Supabase because Supabase Auth stores password hashes, not plaintext.

The first implementation should use a web reset callback, not a desktop
deep-link, because it works with the current architecture and does not require
custom URL-scheme registration.

## Version 1 Flow: Web Callback, Desktop Sign-In

1. User clicks `Forgot password?` on the Everywear ID login screen.
2. `AuthGate.tsx` switches to `forgot-password` mode and asks only for email.
3. `AuthContext.requestPasswordReset(email)` calls:

```ts
await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: 'https://everywear.id/auth/reset-password',
});
```

4. UI always shows a generic success message:

```text
If that Everywear ID exists, a reset link is on its way.
```

This avoids account enumeration.

5. User opens the email link in a browser.
6. The deployed web route `https://everywear.id/auth/reset-password` consumes
   the Supabase recovery session from the URL.
7. The web route asks for a new password and confirmation.
8. The web route calls:

```ts
await supabase.auth.updateUser({ password: newPassword });
```

9. On success, the route signs out the browser session or leaves it inert, then
   tells the user to open Everywear OS and sign in with the new password.
10. The desktop app uses the existing `signInWithPassword` path. Tier and
    entitlements hydrate through the existing `hydrateSession` chain.

## Version 1 Development Redirects

Before implementation, add exact redirect URLs to Supabase Auth settings:

- `https://everywear.id/auth/reset-password`
- `http://127.0.0.1:5173/auth/reset-password`
- `http://localhost:5173/auth/reset-password`

The local `supabase/config.toml` should mirror those values for reproducible
local config, but do not patch the live Supabase project until that task is
explicitly in scope.

## Desktop-In-App Variant

The shell can later support an in-app recovery session, but it is not the first
move.

Required pieces:

- Add `tauri-plugin-deep-link`.
- Register a desktop URL scheme, for example `everywear://auth/reset-password`.
- Confirm Supabase accepts and redirects to that custom scheme in the live Auth
  allow-list.
- Listen for the incoming URL in the Tauri shell.
- Pass the URL to the frontend.
- Let Supabase JS process the recovery session, then call
  `supabase.auth.updateUser({ password })`.

Do not make this the default implementation until the deep-link behaviour is
verified on Windows. Email clients, custom URL schemes, and WebView2 startup
ordering are a bad place to improvise.

## AuthContext API Shape

Add these methods to `AuthContextValue`:

```ts
requestPasswordReset: (email: string) => Promise<void>;
updatePasswordFromRecovery: (password: string) => Promise<void>;
```

Optional state:

```ts
isPasswordRecovery: boolean;
```

`requestPasswordReset` normalizes the email, calls Supabase, and returns the
same outward UI success copy whether or not the email exists. It may log the
Supabase error locally for diagnostics, but should not expose account-existence
detail in the UI.

`updatePasswordFromRecovery` is used only on the reset callback route or future
in-app recovery view after Supabase has established a recovery session.

## AuthGate UI Shape

Extend:

```ts
type AuthMode = 'login' | 'signup' | 'otp-verify' | 'forgot-password';
```

Login footer:

- `Forgot password?` -> `forgot-password`
- `Don't have an account? Create Everywear ID` -> existing signup flow

Forgot-password screen:

- Email input
- Submit button: `Send reset link`
- Success state: generic sent message
- Footer: `Back to sign in`

Do not ask for Everywear ID handle during reset. Supabase Auth recovery is
email-address based.

## Security Rules

- Never reveal whether an email exists.
- Never expose or attempt to read an existing password.
- Never update tier, entitlements, profile, Vault records, or local library
  state during password recovery.
- Recovery must not grant demo, Pro, Creator, or any other entitlement. It only
  changes the auth credential.
- After password update, reuse the normal sign-in and entitlement hydration
  chain.
- Keep reset email rate limiting under Supabase Auth configuration.

## Smoke Tests

- Unknown email: UI shows generic sent message; no crash.
- Known email: reset email arrives; link opens reset route.
- Expired link: route shows visible expired-link state and returns to request
  reset.
- Password mismatch: inline validation, no Supabase call.
- Valid reset: `updateUser({ password })` succeeds; user can sign into desktop.
- Tier preservation: the same account resolves the same tier after reset.
- No enumeration: unknown and known email outward UI copy is identical.

## Release Notes

This is required before relying on old non-owner lower-tier test accounts for
base Vid / Gener8 4ever smoke. Fresh signups currently receive demo access that
behaves like a Gener8 Pro-level test grant, so they do not validate base Vid.
