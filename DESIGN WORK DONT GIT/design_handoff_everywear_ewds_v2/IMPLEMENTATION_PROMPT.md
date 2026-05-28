# Prompt for Local Claude Code

Copy-paste the block below into your local Claude Code instance after you've extracted this handoff bundle into your Everywear project repo.

---

```
I'm working on the Everywear project — a Rust-native desktop shell that hosts
local AI applets (think "Steam for AI apps"). I have a fresh design system
called EWDS-v2 that I want to roll out across the shell and the applets it
hosts.

The handoff bundle is at design_handoff_everywear_ewds_v2/ — please:

1. Read design_handoff_everywear_ewds_v2/README.md in full. It documents the
   honed-graphite cyberpunk visual language, all design tokens (bevel layers,
   surfaces, accents, themes), every component (menubar, holographic desktop
   icons, widget shards, applet window, side panel, dock, toasts, knobs +
   switches), and interactions.

2. Open the reference HTML prototype at
   design_handoff_everywear_ewds_v2/reference/Everywear v2.html in a browser
   to see the design live. The Tweaks panel (bottom-right) exposes every
   theme/accent/dock/widget variable so you can confirm what each token
   controls.

3. Inspect the existing Everywear codebase and tell me:
   - Which GUI/rendering stack the shell currently uses (egui, iced, Tauri +
     web, Slint, Dioxus, native, etc.)
   - Where the current "EWDS v1" design system lives (CSS, Rust style module,
     theme struct, etc.)
   - Which screens / components from EWDS-v1 already exist and need replacing

4. Propose an incremental rollout plan in this order, biggest visual win
   first:
     a. Port the EWDS-v2 design tokens (bevel stack, surfaces, recessed
        wells, accents, themes) into the codebase's theming layer
     b. Rebuild the menubar + traffic lights with the new bevel treatment
     c. Rebuild the holographic desktop icon (plinth + projection cone +
        glowing glyph) — this is the signature visual
     d. Rebuild the applet window chrome (bevelled titlebar, traffic-light
        side flip, recessed content plate, status footer, drag + native
        resize)
     e. Port the widget shards (Chrono / System / Weather Report) with their
        clip-path geometries and ShardWrap drop-shadow wrappers
     f. Port the toast system (oblique info + tombstone system) with the
        documented cadence
     g. Add the side widget panel mode and rocket-dock mode as alternative
        launchers (default stays as desktop icons)
     h. Surface theme/accent/density/dock-mode/traffic-side/widget-visibility
        in user settings so end users can customize, like Rainmeter

5. As you implement, lift exact values from
   design_handoff_everywear_ewds_v2/reference/ewds-v2.css — every hex code,
   shadow stack, clip-path polygon, animation duration is intentional.

   Critical concepts from the README:
   - The desktop icons, rocket dock, and side widget panel are THREE
     ALTERNATIVE RENDERINGS of the same underlying applet roster — not
     three feature sets. The shell holds one ordered list of installed
     applets; the user picks which renderer (desktop / dock-bottom /
     dock-top / panel-left / panel-right) via a single dockMode setting.
     When you add an applet, you register one entry and all three modes
     render it correctly.
   - The "industrial chrome" (barcodes, serial codes, JP labels, protocol
     blocks, registration marks, vertical edge serials, status pills) is
     the EWDS voice — not decoration. User-controllable density via
     --chrome-density (0–1, default 0.65), but always present in the DOM.
     Applets must participate: minimum a barcode + serial in header and
     a serial in footer.

   Critical rules from the README:
   - Recessed inputs everywhere. Text input fields must read as depressed
     slots inside their raised containers — never raised.
   - Bevels are stacked shadows (5–9 layered insets per surface). Don't
     approximate with a single shadow.
   - clip-path crops box-shadow — wrap clip-path shapes in a drop-shadow
     filter parent (see ShardWrap pattern in components/widgets.jsx).
   - One accent at a time, controlled. The three status colors (warn / crit
     / ok) are accent-adjacent, not free additions.
   - Holographic icons NEED the bevelled physical plinth underneath — the
     "real device projecting a hologram" read is the point.
   - The chrome (barcodes, serial codes, JP labels, registration marks) is
     the EWDS voice, not decoration. User-controllable density, but always
     present.

6. After porting the shell, document a contract for applet authors: which
   EWDS-v2 tokens and component classes are exposed to applets via the
   parent shell, so a third-party AI applet can render UI that feels native
   to Everywear. The applet-chat.jsx reference component is the canonical
   example of an applet using EWDS-v2 from the inside.

Start with step 3 — survey the codebase and report back before touching code.
```

---

## Tips for getting the most out of the rollout

- **Run the prototype side-by-side** while Claude Code works. Keep the HTML mock open in a browser so you can A/B compare what the rebuild looks like vs. the reference.

- **Lock the tokens before touching components.** If the Rust theme system can't express multi-layer inset shadows yet, that's the first thing to fix — every visual depends on it.

- **Start with one screen end-to-end** rather than porting tokens for every screen up front. A pixel-perfect applet window with traffic lights, the recessed input, and one shard widget tells you whether the rendering stack can actually carry the EWDS-v2 fidelity. If it can't, you'll want to know on screen #1, not screen #8.

- **Hand the bundle's `applet-chat.jsx` to anyone writing an applet for Everywear.** It's the cleanest example of what consuming EWDS-v2 from inside an applet looks like — sessions rail, transcript bubbles (raised user / recessed AI), bevelled-with-recessed-input composer, chrome footer.

- **Save the tweaks panel for last** — once the shell is real, surface the same controls in your settings UI so users can actually theme their desktop without recompiling.
