/**
 * KasaiApp — Root shell for the Kasai applet inside Everywear OS.
 *
 * Unlike Kasai-Local (standalone Tauri binary with its own window chrome),
 * this version renders directly inside the Everywear OS Window component.
 * No custom titlebar, no traffic lights; those come from the shell.
 *
 * Mounts KasaiCore which is the portable three-pane agent hub.
 */

import { KasaiCore } from './KasaiCore';

export function KasaiApp() {
  return <KasaiCore />;
}
