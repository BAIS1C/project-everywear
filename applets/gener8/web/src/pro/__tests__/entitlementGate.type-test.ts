import { shouldMountProAudioModule } from '../entitlementGate';

if (shouldMountProAudioModule(false, true)) {
  throw new Error('Pro audio must not mount during entitlement hydration.');
}

if (shouldMountProAudioModule(true, false)) {
  throw new Error('Pro audio must not mount for non-Pro users.');
}

if (!shouldMountProAudioModule(true, true)) {
  throw new Error('Pro audio must mount only after resolved Pro entitlement.');
}
