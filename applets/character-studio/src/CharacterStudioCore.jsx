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

import React, { Component, Suspense, useEffect } from "react"
import { AccountProvider } from "./context/AccountContext"
import { AudioProvider } from "./context/AudioContext"
import { LanguageProvider } from "./context/LanguageContext"
import { SceneProvider } from "./context/SceneContext"
import { SoundProvider } from "./context/SoundContext"
import { ViewProvider } from "./context/ViewContext"
import App, { retryManifestLoad } from "./App"
import { getAssetBase } from "./lib/assetBase"

/** Visible loading state shown while the manifest and 3D scene initialize. */
function StudioLoading() {
  return (
    <div className="cs-status" role="status" aria-live="polite">
      <span className="cs-status__spinner" aria-hidden="true" />
      <div className="cs-status__message">Loading Avatar Studio...</div>
    </div>
  )
}

/**
 * Local error boundary for the studio. Catches manifest fetch failures
 * (thrown by the App suspense resource) and any render-time crash in the
 * 3D scene or UI, then offers a Retry that re-arms the manifest fetch.
 */
class StudioErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, errorInfo) {
    console.error("[character-studio] Studio failed to render:", error, errorInfo)
  }

  handleRetry = () => {
    retryManifestLoad()
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="cs-status cs-status--error" role="alert">
          <div className="cs-status__title">Avatar Studio could not start</div>
          <div className="cs-status__message">
            {this.state.error?.message || "Something went wrong while loading the studio."}
          </div>
          <button className="cs-status__retry" type="button" onClick={this.handleRetry}>
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

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
    script.onerror = () => {
      console.warn(
        `[character-studio] Failed to load KTX2 support from ${script.src}. ` +
        `Compressed textures may not decode.`
      )
    }
    document.head.appendChild(script)
  }, [])

  return (
    <div className="cs-app-layer">
      <StudioErrorBoundary>
        <AccountProvider>
          <LanguageProvider>
            <AudioProvider>
              <ViewProvider>
                <SceneProvider>
                  <SoundProvider>
                    <Suspense fallback={fallback ?? <StudioLoading />}>
                      <App />
                    </Suspense>
                  </SoundProvider>
                </SceneProvider>
              </ViewProvider>
            </AudioProvider>
          </LanguageProvider>
        </AccountProvider>
      </StudioErrorBoundary>
    </div>
  )
}
