import React, { createContext, useEffect, useRef, useState } from "react"
import useSound from "use-sound"
import { getAssetBase } from "../lib/assetBase"

// Assets are resolved at runtime through the shell/app asset base. Nothing here is bundled.
const ASSET_BASE = getAssetBase().replace(/\/$/, "")
const soundUrl = `${ASSET_BASE}/sound/sounds.mp3`
const soundSpecsUrl = `${ASSET_BASE}/sound/sound-files.json`

export const SoundContext = createContext()

export const SoundProvider = (props) => {
  const [sprite, setSprite] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(soundSpecsUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch sound specs. Status: ${res.status}`)
        return res.json()
      })
      .then((specs) => {
        if (cancelled) return
        const find = (regex) => specs.find((f) => regex.test(f.name)) || { offset: 0, duration: 0 }
        const mk = (regex) => {
          const f = find(regex)
          return [f.offset, f.duration]
        }
        setSprite({
          switchItem: mk(/switchingItem/),
          classSelect: mk(/class-select/),
          characterLoad: mk(/character-load/),
          randomizeButton: mk(/randomize-button/),
          classMouseOver: mk(/class-mouse-over/),
          backNextButton: mk(/back-next-button/),
        })
      })
      .catch((error) => {
        console.error(`Error fetching sound specs: ${error.message}`)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // useSound (v5) reloads when url/options change, so the sprite sheet is only
  // fetched once the sprite map resolves. Until then play() is a no-op.
  const [play] = useSound(soundUrl, {
    volume: 0.35,
    sprite: sprite ?? {},
  })

  const playRef = useRef(play)
  playRef.current = play

  const playSound = (name, delay = 0) => {
    if (!sprite) return
    delay === 0
      ? playRef.current({ id: name })
      : setTimeout(() => {
          playRef.current({ id: name })
        }, delay)
  }

  return (
    <SoundContext.Provider
      value={{
        playSound,
      }}
    >
      {props.children}
    </SoundContext.Provider>
  )
}
