# EWDS Applet Design Contract

The Everywear Design System (EWDS) is the integration layer between your applet and the shell. It is not a visual straitjacket. The contract is simple:

> Fit the frame. Respect the surface. Be legible and operable. Then express your brand inside that.

If you follow the contract, your applet will feel native to Everywear without giving up its identity. If you bypass it, you will be denied verified status, and you may be denied compatibility entirely.

---

## 1. What EWDS owns and what you own

| Owned by EWDS / shell | Owned by you |
|---|---|
| Window chrome and title bar | Your applet body |
| Spacing scale and grid | Internal layout choices |
| Type ramp (sizes, weights, line-heights) | Type pairing within the ramp |
| Color contrast minimums and status semantics | Brand palette and accent |
| Focus rings and keyboard model | Pointer affordances and custom inputs |
| Surface corner and edge treatment (Cut, Rounded, Square) | Content inside the surface |
| System icons, menu chrome, modal frames | Your domain icons and illustrations |
| Animation timing primitives | Domain-specific motion |
| Status state vocabulary (idle, active, busy, error, blocked) | How you visualise the state internally |

You can do almost anything you want with content inside an EWDS surface. You cannot redraw the frame, replace the chrome, or invent new status semantics.

---

## 2. The three surfaces

EWDS exposes three surface styles. Your manifest declares which ones your applet supports. The shell decides which to assign in a given context.

### Cut
Hard 0px corners, dense spacing scale, technical tone. Strong horizontal rules. Used for tools, inspectors, dashboards, engine controls, anything that wants to feel like instrumentation.

### Rounded
Soft corners (token: `surface.radius.rounded`), generous spacing, conversational tone. Subtle elevation. Used for chat, social, content authoring, casual creation.

### Square
Right-angle frame with no rounding, neutral spacing, no implied tone. Used for canvases, media grids, gallery surfaces, anything that wants the frame to disappear.

Build your layout against EWDS spacing and let the surface decide the corner and edge style. Do not hard-code a corner radius. Do not hard-code an edge inset that fights the surface.

---

## 3. The frame: what you must not touch

The shell renders the outer frame, including:

- Title bar with applet identity and status.
- Window controls (minimise, surface switch, close).
- Permission and capability indicators (vault, network, model use).
- Session and theme state.

You do not draw any of these. You do not hide them. You do not overlay them. You do not implement a custom drag region. The shell exposes layout slots if you need to contribute, for example, a context action into the title bar; use those.

---

## 4. Spacing

EWDS spacing uses a 4px base. Tokens:

```
space.0   = 0
space.1   = 4
space.2   = 8
space.3   = 12
space.4   = 16
space.5   = 24
space.6   = 32
space.7   = 48
space.8   = 64
```

Use tokens. Do not hard-code pixel values that drift between them. Layouts that ignore the spacing scale read as foreign immediately and will fail lint.

---

## 5. Typography

EWDS provides a type ramp. You may pair fonts within it.

```
type.display     = 32 / 40, weight 600
type.title       = 22 / 28, weight 600
type.heading     = 18 / 24, weight 600
type.body        = 14 / 20, weight 400
type.body.strong = 14 / 20, weight 600
type.caption     = 12 / 16, weight 400
type.mono        = 13 / 18, weight 400 (mono)
```

You may set your own font family within these sizes and weights. Display fonts are permitted for branded headings inside your applet content area, not for chrome, status text, or interactive controls.

---

## 6. Color and contrast

EWDS publishes neutral, semantic, and surface tokens. Your brand palette lives on top.

Hard rules:

- Body text against background must meet WCAG AA contrast (4.5:1).
- Interactive control text and icon against control surface must meet AA (4.5:1) or AA Large (3:1) where applicable.
- Status colors must use the EWDS semantic tokens (`status.idle`, `status.active`, `status.busy`, `status.error`, `status.blocked`). Do not invent your own red.
- Theme must respect the shell theme: light, dark, and high-contrast modes are not optional.

You can use any accent color you want, provided it meets contrast and does not collide with status semantics.

---

## 7. Focus, keyboard, and input

The shell owns the focus model. You must:

- Use the EWDS focus primitive on every interactive element. Do not draw your own focus ring.
- Support tab traversal across every interactive control in logical reading order.
- Respond to the EWDS shortcut bus for shell-level shortcuts (close, surface switch, command palette).
- Never trap focus inside your applet body except in a modal you opened, and then only with the EWDS modal primitive which the shell can dismiss.

Custom pointer affordances inside content are fine, as long as keyboard parity exists.

---

## 8. Status states

Every long-running operation must express one of the EWDS status states:

| State | Meaning |
|---|---|
| `idle` | Waiting for input, nothing in progress. |
| `active` | User-initiated work in progress, foreground. |
| `busy` | Background work in progress, user can continue. |
| `error` | Failed; needs user attention. |
| `blocked` | Cannot proceed due to permission, entitlement, or external dependency. |

Use the EWDS status indicator primitive for the chrome-level state. You may visualise it however you like inside your body. The shell uses this state to drive its title bar indicator, so do not skip it.

---

## 9. Icons

EWDS defines an icon footprint and stroke weight specification. Your applet identity icon must:

- Fit the footprint (24px and 48px master sizes).
- Maintain legibility at 16px in the registry list.
- Use the EWDS stroke or fill ranges so it sits next to other applet icons without screaming.
- Render correctly on light, dark, and high-contrast themes.

Inside that footprint, express your brand. The shell wants your icon to be recognisable; it does not want it to be a sticker.

Domain icons inside your applet body have full freedom, provided contrast and size minimums are met.

---

## 10. Brand expression

You are explicitly permitted:

- A brand accent color.
- Your own typography pairing within the ramp.
- Custom illustrations and domain icons in your applet body.
- A distinctive identity icon within the EWDS footprint.
- Your own internal density and visual rhythm inside content surfaces.
- Splash and onboarding screens with your branding (within EWDS chrome).

You are not permitted:

- A custom title bar.
- Custom window controls.
- A redrawn shell frame.
- A theme that ignores the shell theme.
- A focus model that breaks keyboard parity.
- Invented status semantics.

The point of EWDS is that the user always knows they are in Everywear and always knows where they are in your applet. Both can be true.

---

## 11. Motion

EWDS provides motion primitives for surface transitions, status changes, and modal presentation. Use them for any chrome-adjacent motion. Inside your applet body, you have freedom for domain motion (canvas animation, transport scrubbing, content transitions), provided it respects the user's reduced-motion setting from the shell.

Reduced motion is not a suggestion. The shell exposes a flag; honour it.

---

## 12. File access and safe surfaces

Any file pick, drop, or save operation must go through the EWDS file affordances. These talk to the shell broker, which scopes the operation against your declared permissions. Rolling your own drop zone that calls native file APIs is not possible; rolling your own that visually fakes one is grounds for rejection.

---

## 13. Launch and close

- Your applet must mount and render meaningful content within 1 second on reference hardware. Splash content is acceptable; a blank window is not.
- Your applet must close cleanly when the shell requests it. No "are you sure" prompts unless the user has unsaved work, and even then via the EWDS confirmation primitive.
- Your applet must survive being suspended and resumed. State persistence is your responsibility.

Predictable launch and close behaviour is a hard contract.

---

## 14. Accessibility floor

Below this floor an applet will not be approved:

- All interactive controls have accessible names.
- All non-decorative imagery has alt text.
- Color is never the sole carrier of meaning.
- Contrast ratios met as in section 6.
- Keyboard parity as in section 7.
- Respect for reduced motion as in section 11.
- Respect for shell font scaling.

Accessibility is not a compliance burden. It is part of the design contract.

---

## 15. Lint and verify

`everywear lint` will check:

- Token usage (spacing, type, color).
- Focus primitive presence on interactive elements.
- Contrast ratios in your declared themes.
- Surface declaration in manifest matches what your UI uses.
- Reserved chrome regions are untouched.
- Icon footprint and theme variants.

Failing lint blocks packaging. Treat it as a fast feedback loop, not a gate to game.

---

## 16. Short version

Fit the frame. Respect the surface. Be legible and operable. Express your brand inside that.
