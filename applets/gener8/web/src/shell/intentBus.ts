// @ts-nocheck
import { intentBus } from '../context/intentBus';
import { showToast } from '../components/ToastHost';
import { findEngineEndpoint, formatEngineLastChecked, readEngineHealth } from '@everywear/shared';
import { gener8EngineModels } from '@everywear/transport';

export { intentBus, openVidWithSong } from '../context/intentBus';

export function sendToStudio(sourceApp: string, songId: string, songTitle?: string) {
  intentBus.dispatch({
    source: sourceApp,
    target: 'daw-pro',
    action: 'send-to-studio',
    payload: { songId, songTitle },
  });
}

const PRO_PACK_ID = 'pro_base';

function aceServerDownMessage(): string | null {
  const payload = readEngineHealth();
  const endpoint = findEngineEndpoint(payload, 'ace-server');
  if (!payload || !endpoint || endpoint.online) return null;
  const checked = formatEngineLastChecked(payload);
  return `Could not verify the Pro Model because the shell Gener8 engine is offline${checked ? `, last checked ${checked}` : ''}.`;
}

function inventoryHasProModel(inventory: unknown): boolean {
  const text = JSON.stringify(inventory ?? {}).toLowerCase();
  return text.includes('xl-base')
    || text.includes('pro_base')
    || text.includes('stem')
    || text.includes('reference')
    || text.includes('cover');
}

async function proModelPresent(): Promise<boolean> {
  return inventoryHasProModel(await gener8EngineModels());
}

export async function ensureModel(model: string): Promise<boolean> {
  if (model !== 'base' && model !== 'pro_base') return true;
  const engineDown = aceServerDownMessage();
  if (engineDown) {
    showToast({
      kind: 'error',
      eyebrow: 'Everywear · model lifecycle',
      message: engineDown,
      durationMs: 8000,
    });
    return false;
  }
  try {
    if (await proModelPresent()) {
      showToast({
        kind: 'info',
        eyebrow: 'Everywear · model lifecycle',
        message: 'Pro Model ready. DAW stem separation can start.',
        durationMs: 4500,
      });
      return true;
    }
    showToast({
      kind: 'warning',
      eyebrow: 'Everywear · model lifecycle',
      message: `DAW requested ${PRO_PACK_ID}, but the shell model inventory does not expose a Pro capability model yet.`,
      durationMs: 9000,
    });
    return false;
  } catch (err) {
    showToast({
      kind: 'error',
      eyebrow: 'Everywear · model lifecycle',
      message: aceServerDownMessage()
        ?? 'Could not verify the Pro Model from the shell-owned Gener8 inventory.',
      durationMs: 8000,
    });
    return false;
  }
}

export function areModelsUnloaded(): boolean {
  return false;
}
