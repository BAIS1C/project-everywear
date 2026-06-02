import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { CharacterManager } from "./characterManager";

import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader';
import {
    EffectComposer,
    RenderPass,
    EffectPass,
    SMAAEffect,
    BloomEffect,
    ToneMappingEffect,
    ToneMappingMode,
} from "postprocessing";
import { getAssetBase } from "../lib/assetBase";

const ASSET_BASE = getAssetBase().replace(/\/$/, "");

// Builds a soft vertical studio-dome gradient (zenith dark, horizon lit, nadir
// dark) for the 360 backdrop sphere. Replaced at runtime by setBackdrop().
function makeStudioDomeTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0.0, "#0c0f15");
    gradient.addColorStop(0.5, "#3a4a5e");
    gradient.addColorStop(1.0, "#0a0d12");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

// Builds a soft radial blob used as a fake contact shadow under the avatar.
function makeBlobShadowTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, "rgba(0,0,0,0.45)");
    gradient.addColorStop(0.7, "rgba(0,0,0,0.13)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(canvas);
}

export function sceneInitializer(canvasId) {
    const scene = new THREE.Scene()

    
    new RGBELoader().load(`${ASSET_BASE}/hdr/studio_small_09_2k.hdr`, (hdr_) => {
        hdr_.mapping = THREE.EquirectangularReflectionMapping;
        hdr_.colorSpace = THREE.LinearSRGBColorSpace
        scene.environment = hdr_;
    }, undefined, (error) => {
        console.warn("Avatar Studio HDR environment failed to load", error);
    })
    scene.environmentIntensity = 0.5

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);

    // rotate the directional light to be a key light
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);

    // --- Editor-only beauty rig (NOT seen by export renders) ---
    // Everything in this group is hidden by screenshotManager during export, so
    // the deterministic export paths (screenshot/thumbnail/sprite/LoRA) stay
    // byte-stable. The shared ambient + directional above remain the export
    // lighting, untouched.
    const editorRig = new THREE.Group();
    editorRig.name = "STRANDS_EDITOR_RIG";

    // Rim / back light: edge-lights the silhouette so the avatar separates from
    // the backdrop instead of sitting flat against it.
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.4);
    rimLight.position.set(-0.6, 1.8, -1.8);
    editorRig.add(rimLight);

    // Cool, soft fill to open up the shadow side.
    const fillLight = new THREE.DirectionalLight(0xbcd2ff, 0.35);
    fillLight.position.set(-1.8, 1.0, 1.2);
    editorRig.add(fillLight);

    // Generatable 360 backdrop DOME. A large inverted sphere surrounds the
    // avatar so the backdrop wraps at every camera angle (no flat-plane edge,
    // no black drop-off). Default is a studio gradient; swap via setBackdrop()
    // with a 1magen image (ideally equirectangular) the user can save. BackSide
    // so we see the inside; unlit MeshBasic so it never affects model lighting.
    const backdropMaterial = new THREE.MeshBasicMaterial({
        map: makeStudioDomeTexture(),
        side: THREE.BackSide,
        depthWrite: false,
    });
    const backdrop = new THREE.Mesh(
        new THREE.SphereGeometry(50, 48, 32),
        backdropMaterial,
    );
    backdrop.name = "STRANDS_BACKDROP";
    backdrop.position.set(0, 1.0, 0);
    backdrop.renderOrder = -1;
    editorRig.add(backdrop);

    // Soft blob contact shadow grounding the feet.
    const contactShadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 1.3),
        new THREE.MeshBasicMaterial({
            map: makeBlobShadowTexture(),
            transparent: true,
            depthWrite: false,
        }),
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(0, 0.01, 0);
    editorRig.add(contactShadow);

    scene.add(editorRig);

    // Hook for custom backdrops (1magen). Accepts an image URL or a THREE.Texture.
    const setBackdrop = (imageUrlOrTexture) => {
        const apply = (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            if (backdropMaterial.map && backdropMaterial.map.dispose) {
                backdropMaterial.map.dispose();
            }
            backdropMaterial.map = texture;
            backdropMaterial.needsUpdate = true;
        };
        if (typeof imageUrlOrTexture === "string") {
            new THREE.TextureLoader().load(imageUrlOrTexture, apply);
        } else if (imageUrlOrTexture) {
            apply(imageUrlOrTexture);
        }
    };

    const sceneElements = new THREE.Object3D();
    scene.add(sceneElements);

    const camera = new THREE.PerspectiveCamera(
        30,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    camera.position.set(0, 1.3, 2);


    const characterManager = new CharacterManager({parentModel: scene, createAnimationManager : true, renderCamera:camera})
    characterManager.addLookAtMouse(80,canvasId, camera, true);
   
    //"editor-scene"
    const canvasRef = document.getElementById(canvasId);
    const renderer = new THREE.WebGLRenderer({
        canvas: canvasRef,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
    });

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 1;
    controls.maxDistance = 4;
    controls.maxPolarAngle = Math.PI / 2;
    controls.enablePan = true;
    controls.target = new THREE.Vector3(0, 1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    const minPan = new THREE.Vector3(-0.5, 0, -0.5);
    const maxPan = new THREE.Vector3(0.5, 1.7, 0.5);

    const handleResize = () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
    };

    window.addEventListener("resize", handleResize);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Tonemapping is applied by the EffectComposer (ToneMappingEffect, AgX) below,
    // so the renderer must not also tonemap (prevents double tonemapping).
    renderer.toneMapping = THREE.NoToneMapping;

    // --- Render-quality pipeline: EDITOR VIEWPORT ONLY ---
    // Scoped to this renderer's loop. The deterministic export paths
    // (screenshotManager, textureImageDataRenderer, sprite/thumbnail/LoRA) use
    // their own renderers and are intentionally untouched, so exported pixels
    // stay byte-stable. Shared-scene lighting/environment are also left unchanged
    // for the same reason; the lighting rig is a separate, decoupled step.
    const composer = new EffectComposer(renderer, {
        frameBufferType: THREE.HalfFloatType,
    });
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(
        new EffectPass(
            camera,
            new SMAAEffect(),
            new BloomEffect({
                intensity: 0.35,
                luminanceThreshold: 0.85,
                luminanceSmoothing: 0.25,
                mipmapBlur: true,
            }),
            new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
        ),
    );

    const clock = new THREE.Clock();
    const animate = () => {
        requestAnimationFrame(animate);
        const delta = clock.getDelta();
        controls.target.clamp(minPan, maxPan);
        controls?.update();
        characterManager.update(delta);
        composer.render();
    };


    animate();

    const handleMouseClick = (event) => {
        const isCtrlPressed = event.ctrlKey;
        const rect = canvasRef.getBoundingClientRect();
        const mousex = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mousey = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        characterManager.cameraRaycastCulling(mousex,mousey,isCtrlPressed);
    };


    async function fetchScene() {
        // // load environment
        // const modelPath = "./3d/Platform.glb"
      
        // const loader = new GLTFLoader()
        // // load the modelPath
        // const gltf = await loader.loadAsync(modelPath)
        // sceneElements.add(gltf.scene);
    }
    fetchScene();

    
    canvasRef.addEventListener("click", handleMouseClick);

    return {
        scene,
        camera,
        controls,
        characterManager,
        sceneElements,
        clock,
        setBackdrop,
    };
}
