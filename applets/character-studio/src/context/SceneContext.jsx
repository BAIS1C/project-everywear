import React, { createContext, useEffect, useState } from "react"

import gsap from "gsap"
import { sceneInitializer } from "../library/sceneInitializer"
import { LoraDataGenerator } from "../library/loraDataGenerator"
import { SpriteAtlasGenerator } from "../library/spriteAtlasGenerator"
import { ThumbnailGenerator } from "../library/thumbnailsGenerator"

export const SceneContext = createContext({
    /**
 * @typedef {import('../library/characterManager').CharacterManager} CharacterManager
 * @type {CharacterManager}
 */
  characterManager: null,
  /**
   * @typedef {Object} MoveCameraParam
   * @property {number} targetX
   * @property {number} targetY
   * @property {number} targetZ
   * @property {number} distance
   * @param {MoveCameraParam} _value
   */
  // eslint-disable-next-line no-unused-vars
  moveCamera: (_value) => {},
})

export const SceneProvider = (props) => {
  const [characterManager, setCharacterManager] = useState(null)
  const [loraDataGenerator, setLoraDataGenerator] = useState(null)
  const [spriteAtlasGenerator, setSpriteAtlasGenerator] = useState(null)
  const [decalManager, setDecalManager] = useState(null)
  const [thumbnailsGenerator, setThumbnailsGenerator] = useState(null)
  const [sceneElements, setSceneElements] = useState(null)
  const [animationManager, setAnimationManager] = useState(null)
  const [lookAtManager, setLookAtManager] = useState(null)
  const [scene, setScene] = useState(null)
  const [camera, setCamera] = useState(null)
  const [controls, setControls] = useState(null)

  const [manifest, setManifest] = useState(null)
  const [debugMode, setDebugMode] = useState(false);

  let loaded = false
  let [isLoaded, setIsLoaded] = useState(false)
  useEffect(()=>{
    // hacky prevention of double render
    if (loaded || isLoaded) return
    setIsLoaded(true)
    loaded = true;

    // Canvas internalization: the #editor-scene canvas previously lived in the
    // fork's index.html. As an embedded Everywear applet there is no such
    // static markup, so create it on demand before sceneInitializer reads it
    // via document.getElementById (sceneInitializer.js:~154).
    let editorCanvas = document.getElementById("editor-scene");
    let createdEditorCanvas = false;
    if (!editorCanvas) {
      editorCanvas = document.createElement("canvas");
      editorCanvas.id = "editor-scene";
      editorCanvas.style.cssText = "position:fixed;top:0;left:0;";
      document.body.appendChild(editorCanvas);
      createdEditorCanvas = true;
    }

    const {
      scene,
      camera,
      controls,
      characterManager,
      sceneElements
    } = sceneInitializer("editor-scene");
    setCamera(camera);
    setScene(scene);
    setCharacterManager(characterManager);
    setSceneElements(sceneElements);
    setAnimationManager(characterManager.animationManager)
    setLookAtManager(characterManager.lookAtManager)
    setDecalManager(characterManager.overlayedTextureManager)
    setControls(controls);
    setLoraDataGenerator(new LoraDataGenerator(characterManager))
    setSpriteAtlasGenerator(new SpriteAtlasGenerator(characterManager))
    setThumbnailsGenerator(new ThumbnailGenerator(characterManager))

    // Cleanup: only remove the canvas if this effect created it, so the host
    // shell can unmount/remount the applet window without leaking canvases.
    return () => {
      if (createdEditorCanvas && editorCanvas?.parentNode) {
        editorCanvas.parentNode.removeChild(editorCanvas);
      }
    }
  },[])


  const toggleDebugMode = (isDebug) => {
    if (isDebug == null)
      isDebug = !debugMode;

    setDebugMode(isDebug);
    scene.traverse((child) => {
      if (child.isMesh) {
        if (child.setDebugMode){
          child.setDebugMode(isDebug);
        }
      }
    });
  }
  useEffect(() => {
    if (manifest != null){
      if (manifest.defaultAnimations){
        const locationArray = manifest.defaultAnimations.map(animation => animation.location);
        animationManager.storeDefaultAnimationPaths(locationArray, "");
      }
    }
  }, [manifest])

  const showEnvironmentModels = (display) => {

    if (display){
        scene.add(sceneElements);
    }
    else{
        scene.remove(sceneElements);
    }

  }

  // Toggle the editor's 360 studio backdrop dome. The avatar itself is
  // unaffected, so this previews how it will look as a transparent desktop pet.
  const setBackdropVisible = (visible) => {
    if (!scene) return
    const backdrop = scene.getObjectByName("STRANDS_BACKDROP")
    if (backdrop) backdrop.visible = visible
  }

  const moveCamera = (value) => {
    if (!controls) return
    gsap.to(controls.target, {
      x: value.targetX ?? 0,
      y: value.targetY ?? 0,
      z: value.targetZ ?? 0,
      duration: 1,
    })

    gsap
      .fromTo(
        controls,
        {
          maxDistance: controls.getDistance(),
          minDistance: controls.getDistance(),
          minPolarAngle: controls.getPolarAngle(),
          maxPolarAngle: controls.getPolarAngle(),
          minAzimuthAngle: controls.getAzimuthalAngle(),
          maxAzimuthAngle: controls.getAzimuthalAngle(),
        },
        {
          maxDistance: value.distance,
          minDistance: value.distance,
          minPolarAngle: Math.PI / 2 - 0.11,
          maxPolarAngle: Math.PI / 2 - 0.11,
          minAzimuthAngle: -0.78,
          maxAzimuthAngle: -0.78,
          duration: 1,
        },
      )
      .then(() => {
        controls.minPolarAngle = 0
        controls.maxPolarAngle = 3.1415
        controls.minDistance = 0.5
        controls.maxDistance = 10
        controls.minAzimuthAngle = Infinity
        controls.maxAzimuthAngle = Infinity
      })
  }

  return (
    <SceneContext.Provider
      value={{
        manifest,
        setManifest,
        scene,
        decalManager,
        characterManager,
        loraDataGenerator,
        spriteAtlasGenerator,
        thumbnailsGenerator,
        showEnvironmentModels,
        setBackdropVisible,
        debugMode,
        toggleDebugMode,
        animationManager,
        lookAtManager,
        camera,
        moveCamera,
        controls,
        sceneElements,
      }}
    >
      {props.children}
    </SceneContext.Provider>
  )
}
