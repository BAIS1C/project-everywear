export function shouldMountProAudioModule(
  entitlementResolved: boolean,
  canUseGener8Pro: boolean,
): boolean {
  return entitlementResolved && canUseGener8Pro;
}
