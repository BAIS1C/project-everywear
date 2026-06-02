import React, { useContext, useMemo } from "react"
import styles from "./Appearance.module.css"
import { ViewMode, ViewContext } from "../context/ViewContext"
import { SceneContext } from "../context/SceneContext"
import { LanguageContext } from "../context/LanguageContext"
import { SoundContext } from "../context/SoundContext"
import { AudioContext } from "../context/AudioContext"
import FileDropComponent from "../components/FileDropComponent"
import { TokenBox } from "../components/token-box/TokenBox"
import randomizeIcon from "../images/randomize.png"
import cancel from "../images/cancel.png"
import { getFileNameWithoutExtension } from "../library/utils"

/**
 * Tab definitions — maps trait groups to CHASSIS or IDENTITY
 * CHASSIS = physical form (body, torso, legs, feet, outer layers)
 * IDENTITY = face & personality (head, eyes, accessories)
 */
const TAB_CHASSIS = "CHASSIS"
const TAB_IDENTITY = "IDENTITY"

const CHASSIS_TRAITS = new Set(["body", "chest", "legs", "feet", "outer"])
const IDENTITY_TRAITS = new Set(["head", "eyes", "accessories"])

function Appearance() {
  const { isLoading, setViewMode, setIsLoading } = useContext(ViewContext)
  const {
    toggleDebugMode,
    characterManager,
    animationManager,
    moveCamera,
    setBackdropVisible,
  } = useContext(SceneContext)

  const { playSound } = useContext(SoundContext)
  const { isMute } = useContext(AudioContext)
  const { t } = useContext(LanguageContext)

  const [activeTab, setActiveTab] = React.useState(TAB_CHASSIS)
  const [selectedTraitGroup, setSelectedTraitGroup] = React.useState(null)
  const [selectedTrait, setSelectedTrait] = React.useState(null)
  const [traits, setTraits] = React.useState(null)
  const [backdropOn, setBackdropOn] = React.useState(true)

  // Group all trait groups by tab
  const allGroups = characterManager.getGroupTraits()
  const groupsByTab = useMemo(() => {
    const chassis = []
    const identity = []
    allGroups.forEach((group) => {
      const traitName = group.trait.toLowerCase()
      if (IDENTITY_TRAITS.has(traitName)) {
        identity.push(group)
      } else {
        // Default to chassis for any unmapped traits
        chassis.push(group)
      }
    })
    return { [TAB_CHASSIS]: chassis, [TAB_IDENTITY]: identity }
  }, [allGroups])

  const visibleGroups = groupsByTab[activeTab] || []

  // ---- Actions ----
  const back = () => {
    !isMute && playSound('backNextButton')
    characterManager.removeCurrentCharacter()
    characterManager.removeCurrentManifest()
    setViewMode(ViewMode.CREATE)
    toggleDebugMode(false)
  }

  const next = () => {
    !isMute && playSound('backNextButton')
    setViewMode(ViewMode.SAVE)
    toggleDebugMode(false)
  }

  const toggleBackdrop = () => {
    const nextState = !backdropOn
    setBackdropOn(nextState)
    setBackdropVisible?.(nextState)
  }

  const randomize = () => {
    setIsLoading(true)
    characterManager.loadRandomTraits().then(() => {
      if (selectedTraitGroup && selectedTraitGroup.trait !== "") {
        setSelectedTrait(characterManager.getCurrentTraitData(selectedTraitGroup.trait))
      }
      setIsLoading(false)
    }).catch((error) => {
      setIsLoading(false)
      console.error("Error loading random traits:", error.message)
    })
  }

  const selectTraitGroup = (traitGroup) => {
    !isMute && playSound('optionClick')
    if (selectedTraitGroup?.trait !== traitGroup.trait) {
      setTraits(characterManager.getTraits(traitGroup.trait))
      setSelectedTraitGroup(traitGroup)
      const selectedT = characterManager.getCurrentTraitData(traitGroup.trait)
      setSelectedTrait(selectedT)
      moveCamera({ targetY: traitGroup.cameraTarget.height, distance: traitGroup.cameraTarget.distance })
    } else {
      // Deselect
      setTraits(null)
      setSelectedTraitGroup(null)
      setSelectedTrait(null)
      moveCamera({ targetY: 0.8, distance: 3.2 })
    }
  }

  const selectTrait = (trait) => {
    if (trait.id === selectedTrait?.id && trait.collectionID === selectedTrait?.collectionID) {
      return
    }
    setIsLoading(true)
    characterManager.loadTrait(trait.traitGroup.trait, trait.id, trait.collectionID).then(() => {
      setIsLoading(false)
      setSelectedTrait(trait)
    })
  }

  const removeTrait = (traitGroupName) => {
    characterManager.removeTrait(traitGroupName)
    setSelectedTrait(null)
  }

  const randomTrait = (traitGroupName) => {
    setIsLoading(true)
    characterManager.loadRandomTrait(traitGroupName).then(() => {
      setIsLoading(false)
      setSelectedTrait(characterManager.getCurrentTraitData(traitGroupName))
    })
  }

  const handleFilesDrop = async (files) => {
    const file = files[0]
    if (file && file.name.toLowerCase().endsWith('.fbx')) {
      const animName = getFileNameWithoutExtension(file.name)
      const path = URL.createObjectURL(file)
      await animationManager.loadAnimation(path, false, 0, true, "", animName)
    }
    if (file && file.name.toLowerCase().endsWith('.vrm')) {
      if (selectedTraitGroup && selectedTraitGroup.trait !== "") {
        setIsLoading(true)
        const path = URL.createObjectURL(file)
        characterManager.loadCustomTrait(selectedTraitGroup.trait, path).then(() => {
          setIsLoading(false)
        })
      }
    }
  }

  const switchTab = (tab) => {
    setActiveTab(tab)
    // Reset selection when switching tabs
    setTraits(null)
    setSelectedTraitGroup(null)
    setSelectedTrait(null)
    moveCamera({ targetY: 0.8, distance: 3.2 })
  }

  const getTraitCount = (traitGroup) => {
    try {
      const t = characterManager.getTraits(traitGroup.trait)
      return t ? t.length : 0
    } catch {
      return 0
    }
  }

  return (
    <div className={styles.container}>
      {/* Loading Overlay */}
      <div className={`${styles.loadingOverlay} ${isLoading ? styles.loadingOverlayActive : ""}`}>
        <img className={styles.loadingSpinner} src="ui/loading.svg" />
      </div>

      {/* File Drop (invisible, full screen) */}
      <FileDropComponent onFilesDrop={handleFilesDrop} />

      {/* ===== RIGHT PANEL ===== */}
      <div className={styles.rightPanel}>

        {/* Panel Header */}
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>Customize</div>
        </div>

        {/* Tab Bar */}
        <div className={styles.tabBar}>
          <div
            className={`${styles.tab} ${activeTab === TAB_CHASSIS ? styles.tabActive : ""}`}
            onClick={() => switchTab(TAB_CHASSIS)}
          >
            Chassis
          </div>
          <div
            className={`${styles.tab} ${activeTab === TAB_IDENTITY ? styles.tabActive : ""}`}
            onClick={() => switchTab(TAB_IDENTITY)}
          >
            Identity
          </div>
        </div>

        <div className={styles.divider} />

        {/* Scrollable Content */}
        <div className={styles.panelContent}>
          {/* Category Buttons */}
          <div className={styles.categoryList}>
            {visibleGroups.map((traitGroup, index) => {
              const isActive = selectedTraitGroup?.trait === traitGroup.trait
              const count = getTraitCount(traitGroup)

              return (
                <React.Fragment key={"cat_" + index}>
                  <div
                    className={`${styles.categoryButton} ${isActive ? styles.categoryButtonActive : ""}`}
                    onClick={() => selectTraitGroup(traitGroup)}
                  >
                    {traitGroup.fullIconSvg && (
                      <img
                        className={styles.categoryIcon}
                        src={traitGroup.fullIconSvg}
                        alt=""
                      />
                    )}
                    <span className={styles.categoryName}>
                      {traitGroup.name}
                    </span>
                    <span className={styles.categoryCount}>
                      {count > 0 ? count : ""}
                    </span>
                  </div>

                  {/* Trait Grid — renders inline below the active category */}
                  {isActive && traits && (
                    <div className={styles.traitSection}>
                      <div className={styles.traitSectionLabel}>
                        Select {traitGroup.name}
                      </div>
                      <div className={styles.traitGrid}>
                        {/* Randomize button */}
                        <div
                          className={styles.traitSpecialButton}
                          onClick={() => randomTrait(selectedTraitGroup.trait)}
                          title="Randomize"
                        >
                          <img src={randomizeIcon} alt="Random" />
                        </div>

                        {/* Remove button (if trait is optional) */}
                        {!characterManager.isTraitGroupRequired(selectedTraitGroup.trait) && (
                          <div
                            className={styles.traitSpecialButton}
                            onClick={() => removeTrait(selectedTraitGroup.trait)}
                            title="Remove"
                          >
                            <img src={cancel} alt="None" />
                          </div>
                        )}

                        {/* Trait options */}
                        {traits.map((trait, tIndex) => {
                          const active = (trait.id === selectedTrait?.id && trait.collectionID === selectedTrait?.collectionID)
                          return (
                            <div
                              key={tIndex}
                              className={`${styles.traitItem} ${active ? styles.traitItemActive : ""}`}
                              onClick={() => selectTrait(trait)}
                            >
                              <TokenBox
                                size={72}
                                icon={trait.fullThumbnail}
                                rarity={active ? "mythic" : "none"}
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </React.Fragment>
              )
            })}
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div className={styles.bottomBar}>
          <button className="ew-btn ew-btn--ghost" onClick={back}>
            &#8249; Back
          </button>
          <button className="ew-btn ew-btn--ghost" onClick={toggleBackdrop} title="Toggle studio backdrop">
            {backdropOn ? "Backdrop: On" : "Backdrop: Off"}
          </button>
          <div className={styles.bottomBar__spacer} />
          <button className="ew-btn ew-btn--warm" onClick={randomize}>
            &#10227; Randomize
          </button>
          {characterManager.canDownload() && (
            <button className="ew-btn ew-btn--primary" onClick={next}>
              Export &#8250;
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default Appearance
