import type { ComponentType, ReactNode } from "react";

export interface CharacterStudioCoreProps {
  fallback?: ReactNode;
  skin?: string;
  mode?: string;
  appletId?: string;
  launchManifest?: any;
}

declare const CharacterStudioCore: ComponentType<CharacterStudioCoreProps>;

export default CharacterStudioCore;
