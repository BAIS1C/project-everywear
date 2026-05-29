import type { ModelInfo } from '@/services/api';

export function isCapabilityModelName(modelName: string): boolean {
  return modelName.toLowerCase().includes('xl-base');
}

export function resolveProCapabilityModel(
  models: ModelInfo[],
  canUseGener8Pro: boolean,
): string {
  if (!canUseGener8Pro) return '';
  return models.find((model) => isCapabilityModelName(model.name))?.name || '';
}
