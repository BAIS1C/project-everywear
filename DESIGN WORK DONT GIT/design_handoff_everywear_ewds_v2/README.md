# Handoff — Everywear Shell & EWDS-v2

## Overview

**Everywear** is a Rust-native desktop shell that hosts AI applets — "Steam for AI apps." It emulates its own desktop environment with widgets, a dock/launcher, an applet window, and a notification system. Only one AI applet runs at a time (locally hosted), but multiple system widgets (clock, weather, system stats, etc.) coexist on the desktop using regular RAM.

**EWDS-v2** is the **Everywear Design System v2** — the visual + component vocabulary the parent shell ships down to every applet that runs inside it. Applets consume EWDS-v2 tokens to render UI that feels native to the Everywear environment.

The design direction is **honed graphite cyberpunk** — deep multi-layer bevels, photoreal recession, controlled industrial chrome (barcodes, serials, JP labels, registration marks), holographic projection icons, and a controlled accent color (cyan-white HUD by default).

## About the Design Files

The files in `reference/` are **design references created in HTML/CSS/JSX**, not production code to ship. They are interactive prototypes demonstrating intended look, feel, motion, and behavior.

Your task is to **recreate this design in the Everywear Rust codebase** using whatever GUI framework Everywear has standardized on (likely egui, iced, Tauri+WebView, Slint, or similar). The HTML files are the source of truth for visual fidelity, token values, animation timing, and component anatomy. Lift exact hex values, shadow stacks, clip-path geometry, and spacing from them.

If Everywear uses **Tauri + a web frontend**, the HTML/CSS in `reference/` can be adapted more directly — keep the `ewds-v2.css` token system and rebuild the JSX components in whatever JS framework Everywear's frontend uses (React, Solid, Svelte, etc.).

If Everywear uses a **native Rust GUI toolkit**, treat the references as visual specs: implement the same bevel stacks, clip-path geometries, and color tokens using that toolkit's primitives.

## Fidelity

**High-fidelity.** All colors, shadows, typography, spacing, and interactions in the reference files are intended as final values. Recreate pixel-perfectly within whatever Everywear's renderer can express.

---

## Design Tokens (EWDS-v2)

All tokens are defined in `reference/ewds-v2.css`. Key values:

### Backgrounds (graphite theme — default)

| Token | Value |
|---|---|
| `--bg-0` | `#0b0d10` (deepest substrate) |
| `--bg-1` | `#14171b` |
| `--bg-2` | `#1a1e23` |
| `--bg-3` | `#22272d` |
| `--surface-1` | `linear-gradient(180deg, #232830 0%, #1a1e23 50%, #14181d 100%)` |
| `--surface-2` | `linear-gradient(180deg, #2b3038 0%, #1f2329 60%, #181c21 100%)` |
| `--surface-3` | `linear-gradient(180deg, #353b44 0%, #252a31 100%)` |
| `--surface-recessed` | `linear-gradient(180deg, #0e1115 0%, #15191e 100%)` |

### Bevel layers (CRITICAL — this is the "honed machine" feel)

| Token | Value |
|---|---|
| `--bevel-top` | `rgba(255,255,255,0.09)` |
| `--bevel-top-bright` | `rgba(255,255,255,0.16)` |
| `--bevel-bot` | `rgba(0,0,0,0.65)` |
| `--bevel-bot-deep` | `rgba(0,0,0,0.85)` |
| `--hairline` | `rgba(255,255,255,0.06)` |
| `--hairline-strong` | `rgba(255,255,255,0.12)` |

### Ink (text)

| Token | Value |
|---|---|
| `--ink-1` | `#e9ecef` (bone — primary text) |
| `--ink-2` | `#b6bcc4` (muted) |
| `--ink-3` | `#7d848d` (meta / labels) |
| `--ink-4` | `#4a5159` (faint) |

### Accents (one selected at a time, theme-wide)

| Token | Cyan | Amber | Acid | Crimson | Bone |
|---|---|---|---|---|---|
| `--accent` | `#6fd9e8` | `#e8a26f` | `#9bf06a` | `#e85f55` | `#e9ecef` |
| `--accent-strong` | `#a8ecf5` | `#f4c79a` | `#c3ff96` | `#ff8e85` | `#ffffff` |
| `--accent-glow` | `0 0 12px rgba(111,217,232,.55)` | (same pattern) | … | … | … |

### Status colors

| Token | Value |
|---|---|
| `--warn` | `#e8a26f` |
| `--crit` | `#e85f55` |
| `--ok` | `#6fe89a` |

### Themes (interchangeable, graphite is default)

- **graphite** — full multi-layer bevels, photoreal honed-metal recession
- **anodized** — flatter bevels (10% top highlight), finer micro-noise, machined-flat read
- **carbon** — visible woven texture pattern as substrate

All three share the same component shapes; only background gradients, bevel intensity, and grain patterns differ. See the `[data-theme="..."]` selectors in `ewds-v2.css`.

### Typography

| Role | Font | Notes |
|---|---|---|
| Display / headers | `Geist Mono` | weights 400–700 |
| UI body | `Geist` | weights 300–700 |
| Mono / labels / serials | `Geist Mono` | always uppercase, letter-spacing 0.08–0.22em |
| CJK labels | `Noto Sans JP` | used sparingly for industrial-chrome flavor |

| Class | Use | Size |
|---|---|---|
| `.t-label` | All-caps meta label | 9px, letter-spacing 0.16em |
| `.t-meta` | Serial codes, mono meta | 10px, letter-spacing 0.08em |
| `.t-mono` | Mono body | 11px |
| `.t-data` | Mono data values | 12px |
| `.t-display` | Display headlines (clock face, big numbers) | variable, weight 700, letter-spacing −0.02em |

### Radii

- `--radius-sm: 3px` — chips, small buttons
- `--radius: 6px` — windows, cards
- `--radius-lg: 10px` — main applet window

### Chrome density

`--chrome-density` (0.0–1.0, default 0.65) is an opacity multiplier applied to all `.chrome` elements (barcodes, serials, JP labels, registration marks). User-controllable so the chrome can be dialed back when it gets visually overwhelming.

---

## Core Surface Classes

These are the workhorses — every panel, card, button, and widget builds on them.

### `.bevel` — standard raised panel

```css
.bevel {
  background: var(--surface-1);
  box-shadow:
    inset 0 1px 0 var(--bevel-top-bright),
    inset 0 2px 0 var(--bevel-top),
    inset 0 -1px 0 var(--bevel-bot),
    inset 0 -2px 4px var(--bevel-bot-deep),
    inset 1px 0 0 rgba(255,255,255,0.04),
    inset -1px 0 0 rgba(0,0,0,0.4),
    0 1px 0 rgba(0,0,0,0.5),
    0 8px 24px rgba(0,0,0,0.6),
    0 24px 48px rgba(0,0,0,0.4);
  border: 1px solid var(--hairline-strong);
}
```

### `.bevel-strong` — heavy raised, for main windows + widget shards

Brighter top highlight (22% white), deeper bottom shadow, more pronounced drop shadow stack. Use for the AI applet window, widget shards, dock.

### `.recessed` — depressed well

Used for **all text input fields**, the chat transcript plate, the inner clock face well, knob troughs, sparkline backgrounds. Implements photoreal recession via inset top-dark + inset bottom-light:

```css
.recessed {
  background: var(--surface-recessed);
  box-shadow:
    inset 0 2px 4px rgba(0,0,0,0.8),
    inset 0 -1px 0 rgba(255,255,255,0.05),
    inset 0 1px 0 rgba(0,0,0,0.9);
  border: 1px solid rgba(0,0,0,0.6);
}
```

**Rule:** any editable text field, slot, projector aperture, or "received" region uses `.recessed`. Any panel, button, widget, or dock that sticks up uses `.bevel` / `.bevel-strong`.

### Shard clip-paths (the geometric vocabulary)

```css
.shard-hex   { clip-path: polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%); }
.shard-oblq  { clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px)); }
.shard-tomb  { clip-path: polygon(0 12px, 12px 0, calc(100% - 28px) 0, 100% 28px, 100% calc(100% - 12px), calc(100% - 12px) 100%, 28px 100%, 0 calc(100% - 28px)); }
.shard-tri   { clip-path: polygon(8% 0, 92% 0, 100% 50%, 92% 100%, 8% 100%, 0 50%); }
```

**Important:** clip-path crops `box-shadow`. To preserve drop shadows on clip-path shapes, wrap them in a parent that applies `filter: drop-shadow(...)` instead — see `ShardWrap` in `reference/components/widgets.jsx`.

---

## Launcher Modes — One Roster, Three Representations

**Critical concept:** the desktop icons, the rocket dock, and the side widget panel are **three alternative renderings of the same underlying applet roster**. They are not separate feature sets — they are three skins on the same data.

The shell maintains a single ordered list of installed applets (Oracle, Forge, Scribe, Sentry, Echo, Cipher, Atlas, Sandbox, …). The user picks **one** launcher mode at a time via the `dockMode` setting:

| Mode | Renders the applet roster as | Anchored | Best for |
|---|---|---|---|
| `desktop` (default) | **Holographic projection icons** in a 2-column grid | Always left edge | Idle / "desktop" feel, max visual wow |
| `dock-bottom` | **Rocket dock** — magnify-on-hover bevelled glass squares | Bottom center | Quick launch, minimal screen real-estate |
| `dock-top` | Same rocket dock, positioned under the menubar | Top center | Users who keep widgets on the bottom half |
| `panel-right` | **Side widget panel** — outer mini-shard rail + rounded applet rows + sparkline + EWDS knobs/switches | Right edge, 280px wide | Power users, Rainmeter-style dense info |
| `panel-left` | Same side panel, mirrored | Left edge | Right-handed cursor traffic |

**Same data flows into all of them:** each applet entry has `{ id, glyph, label, code, accent, fcn }`. The renderer for each mode picks which fields to surface:

- Desktop icons show: glyph (projected) + label + code, accent drives the projection beam color
- Rocket dock shows: glyph + tooltip label on hover + active dot indicator + optional badge
- Side panel shows: glyph (small badge) + label + fcn code per row; the outer mini-shard rail shows label + serial + code

This means when an applet is installed or removed, all three modes update from the same source. When a developer adds a new applet to Everywear, they don't author three icons — they register one entry and the shell renders it correctly into whichever mode the user has selected.

The active/focused applet is highlighted consistently across modes (cyan ring on dock, cyan left-border + gradient on side-panel row, accent glow on the holographic icon).

---

## Industrial Chrome — The EWDS Voice

The "chrome" is the layer of fake-technical detail that gives Everywear its industrial / cyberpunk feel. It is **not decoration** — it is the design system's voice, equivalent to how a real industrial control panel carries plate stamps, serial codes, and certification marks. Applets are expected to participate in this voice.

The chrome vocabulary, in order of weight:

1. **Barcodes** (`<Barcode seed={...} width={...} height={...}/>` in JSX) — deterministic-pseudo-random vertical bar runs. Used in: window titlebars, widget shards, toast cards, desktop wallpaper bottom-left, side-panel sparkline footer. Lift the `Barcode` implementation from `components/widgets.jsx`.
2. **Serial codes** (`<Serial prefix="..." n={...}/>`) — formatted as `PREFIX-NNNNN/NN`. Prefix is component-type-specific: `EW` (Everywear shell), `APP` (applet window), `CH` (chrono), `WTH` (weather), `SYS` (system), `ATM` (atmos), `WG` (widget), `SR` (system protocol), `DS4` (driver subsystem 4).
3. **JP labels** — sparingly used Japanese characters as flavor: `気象` (weather), `データベース` (database), `保護` (protected). Use Noto Sans JP. Never invent your own without checking translation.
4. **Protocol blocks** — multi-line meta like `8847740·225·02 / 22·8820552 / 002715` and `FCN 002 202 926 21 001`. Format: numeric groups separated by `·` (middle dot), no real meaning, fixed within a session but can vary between sessions/applets.
5. **Registration marks** — L-shaped corner brackets at the four corners of widget shards (see `Corners` helper in `widgets.jsx`) and at the four corners of the wallpaper.
6. **Vertical edge serials** — chrome-tinted mono text written along the right wallpaper edge with `writing-mode: vertical-rl`, e.g. `EVERYWEAR · EWDS-V2 · NODE-A · 8820183·320·02`.
7. **Status pill labels** — caps + letter-spacing: `● LIVE`, `◇ INFO`, `▲ WARN`, `⌖ TARGETED`.

**Density** is user-controllable via `--chrome-density` (0–1, default 0.65). All chrome elements get class `.chrome` which maps to `opacity: calc(var(--chrome-density) * 1)`. At 0 the shell becomes minimal; at 1 it's saturated. The actual chrome elements are always present in the DOM — only their visibility scales.

**Rule for applet authors:** any non-trivial applet UI should carry at minimum a barcode + serial in its header and a serial in its footer. The chat applet in `applet-chat.jsx` is the reference for how to integrate chrome into an applet without overdoing it.

---

## Screens / Views

### 1. Desktop (root view)

**Purpose:** Idle state when no applet is focused. Shows the user their environment.

**Layout (default):**
- **Menubar** — top, full-width, 36px tall
- **Desktop icon grid** — left edge, 22px gutter, 2-column grid (96px columns, 128px rows, 12px gap), always anchored left regardless of traffic-light side
- **Widget rail** — right edge, 24px gutter, vertical flex column, 16px gap. Widgets sized 200×240 (clock), 220×230 (weather report), 220×220 (system shard)
- **Wallpaper** — full-bleed graphite plate with blueprint-grid + diagonal-hairline + SVG-grain layers; faint corner registration marks; vertical serial code down the right edge; bottom-left barcode + brand block

**Components:**
- Menubar (see §Menubar below)
- 8 desktop icons (Oracle, Forge, Scribe, Sentry, Echo, Cipher, Atlas, Sandbox) — each is a holographic projection (see §Desktop Icon below)
- 3 widgets visible by default: Chrono (hex), System (tombstone-cut polygon), Weather Report (oblique notched card). Atmos circle and Tombstone stat shards are toggleable but off by default.

### 2. Applet Window — Oracle (the focused AI app)

**Purpose:** The single running AI applet. Sits in the center-left of the desktop, leaving wallpaper + widgets visible behind. Mocked here as a local LLM chat ("Oracle-7B").

**Layout:**
- 720×520 default, drag-to-move via titlebar, drag bottom-right corner to resize (min 480×320)
- 10px border-radius
- Titlebar (38px): traffic lights (left or right per tweak) · vertical hairline · title block (`ORACLE-7B · LOCAL · AI ASSISTANT`) · flex spacer · barcode + `APP-42715/96` serial · matching traffic lights (other side)
- Content plate: `.recessed.scanlines`, holds the applet UI
- Footer (28px): `▣ EWDS` label · protocol meta `PROTOCOL 2204·00A · DEEP DIVE WAVE REV 0.0` · `● LIVE` indicator (cyan)
- Resize handle (16×16) bottom-right with three diagonal hairlines

**Chat applet layout inside the window:**
- Left sessions rail (220px wide) — `SESSIONS` label, 4 session rows with name + serial, active row has 2px cyan left border + cyan gradient overlay; barcode + serial footer in chrome
- Main column — transcript (overflow-y: auto, overflow-x: hidden) + composer
- Transcript bubble pattern:
  - **System** (sys role) — centered grey caps label, no bubble
  - **AI** (`◐ ORACLE-7B`) — left-aligned bubble using `.recessed`, 2px cyan left border, max-width 78%, label above in cyan
  - **User** (`◇ YOU`) — right-aligned, bubble uses `.bevel` (raised), label above in grey
- **Composer** — outer `.bevel` wrapper (raised), with `▸` accent caret on the left, an **inner recessed text well** (depth: inset 2px 4px rgba(0,0,0,0.85), border 1px black) that holds the bare `<input>`, then `⌘+↵` hint + cyan SEND button. **The recessed input is critical** — text input fields must read as depressed slots, never raised.

### 3. Side widget panel mode (alternative launcher)

**Purpose:** Alternative to the desktop-icon grid. Inspired by the EWDS-evolution reference image (rounded outlined applet rows + mini tombstone shards).

**Layout (right side, 280px wide):**
- Outer rail — 6 mini tombstone-shard cards stacked vertically, each 70px wide, with serial code, big mono name (`OR01`), small chrome data block, and the app label + FCN code. Active card has 2px cyan left border + cyan gradient bg.
- Main panel — notched-corner rectangle (`.bevel` + clip-path), 1px translucent cyan border, contains:
  - `データベース` JP label + `DB · 304/24` chrome
  - Recessed sparkline waveform (cyan SVG path with drop-shadow glow) labeled `PROTOCOL 2204 00A · DEEP DIVE WAVE` + serial
  - `APPLETS` label
  - 8 applet rows — each 6px×10px padded rounded rectangle with 1px border (hairline or cyan if active), small circular badge with glyph, label + FCN code, `⌖` target glyph on the right
  - Footer: `DATABASE` + `FCN 002 202 926 21 001`
- Bottom: knobs+switches strip — bevelled pill 50px tall containing a recessed double-knob trough (two 18px knobs with cyan tick indicators), 3 LEDs, and a 34×18 toggle pill switch

### 4. Rocket dock modes (top / bottom)

**Purpose:** Mac-style hover-magnified dock alternative to the icon grid.

**Layout:**
- `.bevel-strong` rounded pill (14px radius), positioned bottom-center or top-center, 10px padding, 10px gap
- Each dock item is a 56×56 `.bevel` square (12px radius) with a glass-shine sub-element on top, a centered glyph, optional `badge` chip (top-right corner), and active indicator dot (bottom)
- Hover: `translateY(-2px) scale(1.08)` with 180ms ease-out; tooltip pops above the item
- Active item: 2px cyan ring + glow + small cyan dot beneath

---

## Component Anatomy

### Menubar (top system bar)

- Height **36px**, gradient `linear-gradient(180deg, #1c2025 0%, #14171b 100%)`
- Inset top 1px white@7% highlight; 1px black bottom border + 8px×16px outer drop shadow
- Order (left to right): traffic lights · brand block (EW mark in a 22×22 bevelled square + `EVERYWEAR · EWDS · v2.0.4`) · menu items (`Shell Applet Widgets View Window Help`, 11px padding, 1px hairline dividers) · flex spacer · status indicators (NET/GPU/RAM with colored dots) · live clock (`2026.05.28 17:00:00` in `.bevel`, time in cyan with subtle glow)
- Traffic light side flips: when `trafficSide === 'right'`, lights render on the right; menubar block order otherwise unchanged

### Holographic desktop icon

**The signature element.** Each icon is composed of THREE stacked elements:

1. **Plinth** (bottom) — 56×16 bevelled graphite hex disc (clip-path: `polygon(12% 0, 88% 0, 100% 50%, 88% 100%, 12% 100%, 0 50%)`). Background gradient `linear-gradient(180deg, #353b44 0%, #1f242a 45%, #14181d 100%)`. Multi-layer inset bevel + outer `filter: drop-shadow(0 2px 3px rgba(0,0,0,0.7)) drop-shadow(0 6px 8px rgba(0,0,0,0.4))`. Contains a small recessed projector aperture in the center (28×3 horizontal slit with accent-tinted gradient + glow) and two tiny ventilation dots.
2. **Volumetric light cone** (middle) — 64×62 `radial-gradient(ellipse 60% 100% at 50% 100%, accentSoft 0%, accentFaint 35%, transparent 70%)` with `mix-blend-mode: screen`. Hover boosts brightness 1.4×.
3. **Projection beam outline** — SVG with two slanted dashed hairlines forming the cone shape (24,65 → 14,14 and 48,65 → 58,14), plus a horizontal scan tick line at y=32.
4. **Glyph** (top) — Geist Mono 26px, white, with triple-stacked text-shadow: `0 0 4px accent, 0 0 10px accentSoft, 0 0 22px accentSoft`. Hover lifts the glyph 2px.
5. **Label + code** below the projection — mono caps label (10px), chrome serial code below (7.5px).

Hover state: dashed outline around the entire icon cell + glyph lifts + projection brightens + label switches to accent color.

### Widget shards

Sit on the right edge of the desktop (always right, regardless of traffic light side). Each is a `.bevel-strong` panel with a custom clip-path geometry, wrapped in a `ShardWrap` that applies the outer drop-shadow filter (since clip-path crops box-shadow).

| Widget | Shape | Default size | Contents |
|---|---|---|---|
| Chrono (clock) | 8-pointed hex notched | 200×240 | Header label · analog clock face (SVG with 60 ticks, hour/minute hands white, second hand cyan) inside a `.recessed` circular well · digital readout (`HH:MM` ink-1, `:SS` accent) · UTC label · barcode + `CH-XXXX` serial |
| Atmos (compact weather, optional) | Circle 200×200 | | Temp + condition + H/L/RH stats |
| System | Tombstone-cut polygon 220×220 | | `▲ SYSTEM/03 · SR-4150` header · CPU/MEM/DSK/NET stat rows (label + recessed bar + value, MEM accent-highlighted) · barcode + `SYS-829412/XX` |
| Weather Report | Oblique notched card 220×230 | | `◈ GEO/04 · WEATHER` header · location + temp big · 8h forecast mini-bars (current hour accent-highlighted) · 4 mini-stats (WIND/HUM/PRES/AQI) · barcode + `WTH-XXXXX/XX` |
| Tombstone stats (Tokens, Uptime) | `.shard-tomb` 200×78 | | label + value + barcode + subtitle |

### Stat bar pattern (used in System shard, etc.)

```
[28px label] [flex recessed track with gradient fill | accent fill if highlighted] [50px right-aligned value]
```

Track height 8px, border-radius 2px. Default fill `linear-gradient(90deg, #5a626c, #8a939d)`; accent fill `linear-gradient(90deg, var(--accent), var(--accent-strong))` + `box-shadow: var(--accent-glow)`. Width transitions in 800ms ease.

### Toasts (two flavors)

**Info — oblique sliver, top-right**
- 340px wide, oblique-cut sliver: `clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 100%, 14px 100%)`
- Vertical 6×28 accent bar on the left (color-coded: cyan/ok/warn/crit) with matching glow
- Caps label + serial code + body text + dismiss `✕`
- Animation: `toast-in-right` 350ms cubic-bezier(.2,.8,.2,1) — slides in from right
- TTL 4200ms auto-dismiss

**System — tombstone card, bottom-center**
- 460px wide, `.shard-tomb` clip-path, `.bevel-strong` styling
- 36×36 bevelled glyph plate (warn ⚠ glyph with color-matched glow) + label + protocol code + body text + barcode + serial + dismiss
- Animation: `toast-in-bottom` 400ms cubic-bezier(.2,.8,.2,1) — slides in from bottom
- TTL 6000ms auto-dismiss

Both stack vertically when multiple are open.

### Knobs + switches (EWDS controls)

- **Knob** — 18×18 radial-gradient sphere with cyan tick indicator at angle (`-135° + value × 270°`), inset bevel shadows
- **LED** — 6×6 dot, on state has 6px colored glow + 1px white inset; off state is recessed dark
- **Switch** — 34×18 recessed pill containing a 14×14 bevelled knob that translates 16px on toggle (200ms transition), with a 4×4 colored dot indicator on the trailing side that lights up when on
- **Trough** — `.recessed` 28px-tall pill that holds knob clusters and LEDs

### Traffic lights (Mac-style)

- 3 dots, 12px diameter, 8px gap
- Red close · amber min · green max
- Each is `radial-gradient(circle at 35% 30%, light 0%, mid 60%, dark 100%)` with inset top-light + inset bottom-shadow + 1px drop shadow
- User-toggleable left/right (default **left**)
- They appear on both menubar AND applet window titlebar; both flip together

### Window dragging + resizing (in the mock)

For the mock: titlebar `mousedown` starts a drag listener that updates window x/y on `mousemove`; bottom-right 16×16 handle starts a resize listener. Clamped to viewport bounds (window can't drag off-screen, can't resize below 480×320). **In the production Rust shell, this is native windowing — replace this mock behavior with the framework's native window APIs.**

---

## Interactions & Behavior

### Theme switching
- 3 themes: `graphite` (default), `anodized`, `carbon`
- Theme attribute set on `<html>` (`data-theme="graphite"`); CSS variables cascade
- Cross-fade `box-shadow` and `background` over ~250ms when theme changes

### Accent switching
- 5 accents: `cyan` (default), `amber`, `acid`, `crimson`, `bone`
- Accent attribute set on `<html>` (`data-accent="cyan"`)
- Drives all `--accent`, `--accent-strong`, `--accent-glow` tokens

### Chrome density
- Slider 0–1 (default 0.65), sets `--chrome-density` CSS variable
- `.chrome` class uses `opacity: calc(var(--chrome-density) * 1)`

### Wallpaper grain intensity
- Slider 0–1 (default 0.65), sets `--wallpaper-intensity`
- Drives grain opacity + blueprint-grid opacity on `.ew-wallpaper::after` / `::before`

### Toast cadence (on shell boot)
1. **+900ms** — info: `NET · EW-2204 · Local node handshake stabilised.` (cyan)
2. **+2400ms** — system: `PROTOCOL DRIVER · SR-4150 · Oracle-7B mounted to RAM. 4.2 GB allocated.` (warn amber)
3. **+4200ms** — info: `WIDGET · WG-0118 · Atmos shard data refreshed.` (ok green)

User can replay or fire arbitrary toasts via the Tweaks panel (Info / OK / Warn / Critical buttons).

### Holographic icon hover
- 150ms outline-color transition (dashed accent border appears)
- 250ms transform on glyph (translateY -2px)
- 250ms filter on light cone (brightness 1.4, saturate 1.2)
- 250ms box-shadow on projector aperture slit

### Dock item hover
- 180ms translateY(-2px) scale(1.08)
- Tooltip pops above with item name

### Chat composer focus
- 150ms transition on input wrapper: gains 1px cyan border ring + 8px cyan glow halo

### Animations defined in `ewds-v2.css`

```css
@keyframes pulse-accent { 0%, 100% { box-shadow: 0 0 0 } 50% { box-shadow: var(--accent-glow) } }
@keyframes tick         { from { transform: translateX(-100%) } to { transform: translateX(100%) } }
@keyframes toast-in-right  { from { transform: translateX(120%); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
@keyframes toast-in-bottom { from { transform: translateY(120%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
```

---

## State Management

For the Everywear shell, persistent + runtime state needed:

- **Theme settings** (persisted): `theme`, `accent`, `trafficSide`, `chromeDensity`, `wallpaperIntensity`, `dockMode`
- **Widget visibility** (persisted): showClock, showWeather, showSystem, showLocation, showTombstones (each boolean)
- **Window state** (persisted per applet): position, size, focused, minimized
- **Running applet** (runtime): currently mounted AI app, its session/context
- **Toast queue** (runtime): array of `{ id, kind: 'info' | 'system', label, code, text, color, serial, ttl }`
- **System telemetry** (runtime, polled): CPU%, MEM%, DSK%, NET mb/s, GPU state, sync state, network state

---

## Files in This Bundle

`reference/`
- `Everywear v2.html` — root HTML, loads everything
- `ewds-v2.css` — **the design system. Lift everything from here.**
- `tweaks-panel.jsx` — in-design knob panel (not part of the production shell, but useful for reproducing the demo)
- `app.jsx` — root React component, demonstrates how everything composes
- `components/menubar.jsx` — top system bar
- `components/desktop-icons.jsx` — **holographic projection icons** (graphite plinth + light cone + glowing glyph)
- `components/widgets.jsx` — Chrono / Atmos / System / Weather Report / Tombstone shards + Barcode + Serial + Corners helpers + ShardWrap drop-shadow wrapper
- `components/side-panel.jsx` — alternative side-rail launcher with mini-shards + applet rows + sparkline + EWDS knobs/switches
- `components/dock.jsx` — rocket dock (top/bottom)
- `components/app-window.jsx` — bevelled window with traffic lights, drag, resize
- `components/applet-chat.jsx` — example Oracle-7B chat applet (shows how applets sit inside an AppWindow)
- `components/toasts.jsx` — oblique-info + tombstone-system toast components

Open `Everywear v2.html` in a browser to interact with the live mock. The Tweaks panel (bottom-right) exposes every variable so you can verify what each token controls.

---

## Implementation Notes

1. **Start with the tokens.** Port `ewds-v2.css` first — the bevel/recess/surface system is non-negotiable. Get those right and most of the visual identity is locked.
2. **Bevels are stacked shadows.** Don't approximate with a single `box-shadow` — each component uses 5-9 layered insets + drops. The "honed machine" feel comes from the stack.
3. **clip-path crops box-shadow.** When a shape uses clip-path (shards, traffic-light buttons, plinths), wrap it in a parent that applies `filter: drop-shadow()` for the outer shadow — see `ShardWrap` in `widgets.jsx`.
4. **Recessed inputs everywhere.** Every text input field reads as a depressed slot inside its raised container. Never let an input look raised.
5. **The chrome is part of the brand.** Barcodes, serials, JP labels, registration marks, protocol codes — they aren't decoration, they're the EWDS voice. Density is user-controllable but they should always be present.
6. **One accent, controlled.** Pick one accent for the whole shell. Don't introduce other chromatic colors except the three status colors (warn, crit, ok) and even those are accent-adjacent.
7. **Holographic icons need the plinth.** The combination of bevelled physical plinth + ethereal glowing projection above is the signature. Don't simplify to a flat icon — the layered "real device projecting hologram" read is the point.
8. **Applets inherit EWDS.** Any AI applet running inside Everywear should use the same tokens, the same `.bevel`/`.recessed` vocabulary, the same chrome conventions. The chat applet in `applet-chat.jsx` is the reference for what an applet looks like.

---

## Assets

No bitmap assets — everything is CSS / SVG / inline. Fonts pulled from Google Fonts (Geist, Geist Mono, Noto Sans JP). If Everywear ships an offline binary, bundle these fonts locally.
