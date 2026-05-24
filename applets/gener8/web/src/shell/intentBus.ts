// @ts-nocheck
import { intentBus } from '../context/intentBus';

export { intentBus, openVidWithSong } from '../context/intentBus';

export function sendToStudio(sourceApp: string, songId: string, songTitle?: string) {
  intentBus.dispatch({
    source: sourceApp,
    target: 'daw-pro',
    action: 'send-to-studio',
    payload: { songId, songTitle },
  });
}

export async function ensureModel(_model: string): Promise<boolean> {
  return true;
}

export function areModelsUnloaded(): boolean {
  return false;
}
