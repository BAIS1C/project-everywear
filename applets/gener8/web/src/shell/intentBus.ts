// @ts-nocheck
import { intentBus } from '../context/intentBus';
import { showToast } from '../components/ToastHost';
import { getApiBase } from '../services/api';

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

async function proModelPresent(): Promise<boolean> {
  const response = await fetch(`${getApiBase()}/api/engine/pack-status?pack_id=${PRO_PACK_ID}`, {
    credentials: 'omit',
  });
  if (!response.ok) return false;
  const status = await response.json();
  return status?.present === true;
}

async function pullProModel(): Promise<boolean> {
  showToast({
    kind: 'info',
    eyebrow: 'Everywear · model lifecycle',
    message: 'DAW requested the Pro Model. Everywear is pulling the VRAM-fit pack now.',
    durationMs: 9000,
  });

  const response = await fetch(`${getApiBase()}/api/engine/install-pack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pack_id: PRO_PACK_ID }),
    credentials: 'omit',
  });
  const text = await response.text().catch(() => '');
  if (!response.ok || text.includes('event: error')) {
    showToast({
      kind: 'error',
      eyebrow: 'Everywear · model lifecycle',
      message: 'Pro Model pull failed. Check the local engine logs before retrying stem separation.',
      durationMs: 9000,
    });
    return false;
  }

  showToast({
    kind: 'success',
    eyebrow: 'Everywear · model lifecycle',
    message: 'Pro Model is available for DAW stem separation.',
    durationMs: 6500,
  });
  return true;
}

export async function ensureModel(model: string): Promise<boolean> {
  if (model !== 'base' && model !== 'pro_base') return true;
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
    return await pullProModel();
  } catch (err) {
    showToast({
      kind: 'error',
      eyebrow: 'Everywear · model lifecycle',
      message: 'Could not verify the Pro Model because the local Gener8 engine is offline on localhost:3001.',
      durationMs: 8000,
    });
    return false;
  }
}

export function areModelsUnloaded(): boolean {
  return false;
}
