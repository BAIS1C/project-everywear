import React from "react"
import styles from "./Landing.module.css"
import { ViewMode, ViewContext } from "../context/ViewContext"

import { SoundContext } from "../context/SoundContext"
import { AudioContext } from "../context/AudioContext"
import { SceneContext } from "../context/SceneContext"

function Landing() {
  const { setViewMode } = React.useContext(ViewContext)
  const { playSound } = React.useContext(SoundContext)
  const { isMute } = React.useContext(AudioContext)
  const { characterManager } = React.useContext(SceneContext)

  const createCharacter = () => {
    setViewMode(ViewMode.CREATE)
    !isMute && playSound('backNextButton');
  }

  const createVRMCharacter = () => {
    setViewMode(ViewMode.CLAIM)
    !isMute && playSound('backNextButton');
  }

  const optimizeCharacter = () => {
    setViewMode(ViewMode.OPTIMIZER)
    characterManager.loadOptimizerManifest();
    !isMute && playSound('backNextButton');
  }

  return (
    <div className={styles.container}>
      <div className={styles.buttonContainer}>
        <button
          type="button"
          className={styles.actionButton}
          onClick={createCharacter}
          aria-label="Create Character"
          title="Create Character"
          data-tour="avatar-create-character"
        >
          <span>Create</span>
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={createVRMCharacter}
          aria-label="Batch Download"
          title="Batch Download"
          data-tour="avatar-batch-download"
        >
          <span>Batch</span>
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={optimizeCharacter}
          aria-label="Optimise Character"
          title="Optimise Character"
          data-tour="avatar-optimize-character"
        >
          <span>Optimise</span>
        </button>
      </div>
    </div>
  )
}

export default Landing
