/**
 * CharacterStudioCore — Portable avatar studio component.
 *
 * Wraps all required context providers (Account, Language, Audio, View, Scene, Sound)
 * and renders the main App component. Can be mounted inside:
 *   1. CharacterStudio standalone (Main.jsx renders this + Suspense boundary)
 *   2. Everywear OS at everywear.id (as a registered applet in a Window)
 *
 * When embedded in Everywear OS, the shell provides the window chrome, skin sync,
 * and EWDS token injection. This component only needs to be wrapped in a
 * React.Suspense boundary by the host.
 *
 * Consumes EWDS tokens via public/ewds/*.css (loaded by index.html or host shell).
 */

import React, { Suspense, useEffect } from "react"
import { AccountProvider } from "./context/AccountContext"
import { AudioProvider } from "./context/AudioContext"
import { LanguageProvider } from "./context/LanguageContext"
import { SceneProvider } from "./context/SceneContext"
import { SoundProvider } from "./context/SoundContext"
import { ViewProvider } from "./context/ViewContext"
import App from "./App"
import { getAssetBase } from "./lib/assetBase"

/**
 * CharacterStudioCore
 *
 * Props:
 *   - fallback: React node to show while loading (default: null)
 *
 * Usage in Everywear OS:
 *   import CharacterStudioCore from '@applets/character-studio/CharacterStudioCore'
 *   <Window applet="character-studio">
 *     <Suspense fallback={<LoadingSpinner />}>
 *       <CharacterStudioCore />
 *     </Suspense>
 *   </Window>
 */
/** Module-scoped guard so the libktx.js <script> is only injected once,
 *  even across remounts of CharacterStudioCore. */
const KTX2_SCRIPT_ID = "cs-libktx-loader"

export default function CharacterStudioCore({ fallback = null }) {
  // KTX2 (libktx.js) was loaded via a static <script> in the fork's index.html.
  // As an embedded applet there is no such markup, so inject it dynamically
  // from the runtime asset base, guarded against double-injection.
  useEffect(() => {
    if (typeof document === "undefined") return
    if (document.getElementById(KTX2_SCRIPT_ID)) return
    const assetBase = getAssetBase().replace(/\/$/, "")
    const script = document.createElement("script")
    script.id = KTX2_SCRIPT_ID
    script.src = `${assetBase}/ktx2/libktx.js`
    script.async = true
    document.head.appendChild(script)
  }, [])

  return (
    <div className="cs-app-layer">
      <AccountProvider>
        <LanguageProvider>
          <AudioProvider>
            <ViewProvider>
              <SceneProvider>
                <SoundProvider>
                  <Suspense fallback={fallback}>
                    <App />
                  </Suspense>
                </SoundProvider>
              </SceneProvider>
            </ViewProvider>
          </AudioProvider>
        </LanguageProvider>
      </AccountProvider>
    </div>
  )
}
