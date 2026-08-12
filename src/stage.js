import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  applyBattleMapToSurface,
  createFallbackBoxMaterial,
  tickBattleMap,
} from "./battleMapLayer.js";
import { normalizeBattleMapState, resolveStageFxForBattleMap } from "./battleMaps.js";
import { syncMapRevealLayers } from "./mapLayers/deathHouseBasementLayers.js";
import {
  createProceduralCharacter,
  hasProceduralCharacter,
} from "./proceduralCharacters.js";
import { clampProjectorCorners } from "./sceneState.js";
import {
  configureOffAxisCamera,
  configureFaceMappedCamera,
  configureFaceOrthoCamera,
  configureTopDownMapCamera,
  configureTopDownMapAndStageCamera,
  configureProjectorCamera,
  createOffAxisCamera,
} from "./anamorphic.js";
import {
  buildBoxFaces,
  computeEyePosition,
  getBoxExtents,
  getProjectorById,
  normalizeVenueState,
  setViewerWorldPosition,
  areFaceCornersHealthy,
  areFaceCornersUsable,
  createDefaultFaceCorners,
  createDefaultContentCorners,
  isFullFrameCorners,
  faceCornersArea,
} from "./venueGeometry.js";
import {
  createDefaultStageFxState,
  normalizeStageFxState,
} from "./fx/stageFxState.js";
import { createStagePostProcessing } from "./fx/postProcessing.js";
import {
  composeCornerQuad,
  constrainMapKeystoneWindow,
  constrainStageKeystoneWindow,
  createProjectorWarp,
  transformCornersThroughQuadHomography,
} from "./fx/projectorWarp.js";
import {
  applyRimLightToObject,
  createRimLightUniforms,
  updateRimLightUniforms,
} from "./fx/rimLight.js";
import { createContactShadow, updateContactShadow } from "./fx/contactShadow.js";
import {
  applyCharacterLook,
  attachCharacterFx,
  combineCharacterFx,
} from "./fx/characterFx.js";
import {
  clampObjectTextures,
  disposeObjectResources,
  stripMaterialMaps,
} from "./fx/textureBudget.js";
import {
  createAtmosphere,
  disposeAtmosphere,
  updateAtmosphere,
} from "./fx/atmosphere.js";
import {
  createVenueFrustumHelpers,
  disposeVenueFrustumHelpers,
} from "./fx/venueFrustumHelpers.js";
import {
  createProjectorPrevizOverlay,
  disposeProjectorPrevizOverlay,
  rebuildProjectorPrevizFaces,
  updateProjectorPrevizOverlay,
} from "./fx/projectorPreviz.js";
import {
  clampActorInstanceScaleForCharacterStage,
  createDefaultCharacterStageState,
  DEFAULT_CHARACTER_MODEL_BOUNDS,
  getCharacterStageWorldPose,
  getMaxActorInstanceScaleForCharacterStage,
  getMaxActorWorldScaleForCharacterStage,
  MAX_SIZE,
  MIN_SIZE,
  normalizeCharacterStageState,
} from "./characterStage.js";
import {
  applyCharacterStageBackdrop,
  createCharacterStageVisual,
  disposeCharacterStageVisual,
  tickCharacterStageVisual,
  updateCharacterStageVisual,
} from "./fx/characterStageBackdrop.js";

const loader = new GLTFLoader();

export class StageRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.mode = options.mode || "single";
    this.testBackdrop = options.testBackdrop !== false;
    this.showBoxGuide = options.showBoxGuide !== false;
    this.calibrationGrid = Boolean(options.calibrationGrid);
    this.useProjectorWarp = options.useProjectorWarp !== false;
    /** When true, venue passes only draw/outline the calibration face (Mapping Studio). */
    this.focusCalibrationFace = Boolean(options.focusCalibrationFace);
    this.actors = new Map();
    this.clock = new THREE.Clock();
    this._raf = 0;
    this._syncToken = 0;
    this._contextLost = false;
    this.raycaster = new THREE.Raycaster();
    this._pointerNdc = new THREE.Vector2();
    this._floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._floorHit = new THREE.Vector3();
    this._dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._dragHit = new THREE.Vector3();
    this._worldToScreen = new THREE.Vector3();
    this.boxHalfExtent = 1.2;
    this._boxHalfDepth = 1.2;
    this.selectedActorIds = new Set();
    this.modelBoundsByCharacterId = new Map();

    this.corners = clampProjectorCorners({
      topLeft: { x: 0.15, y: 0.12 },
      topRight: { x: 0.85, y: 0.12 },
      bottomRight: { x: 0.88, y: 0.88 },
      bottomLeft: { x: 0.12, y: 0.88 },
    });

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(this.testBackdrop ? 0x141820 : 0x000000, 1);
    // Cap DPR — 4K displays were doubling fill-rate cost for little Stage gain.
    const maxPixelRatio = this.useProjectorWarp ? 1.25 : 1.5;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, maxPixelRatio)
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(
      this.testBackdrop ? 0x141820 : 0x000000
    );

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
    this.camera.position.set(0, 2.4, 4.2);
    this.camera.lookAt(0, 0.4, 0);

    /**
     * Projector stage view:
     * - "top" — overhead ortho cover-fill (default on projector stage; no bars).
     * - "perspective" — orbitable 3D camera (right-drag). Monsters read in 3D;
     *   may show black bars inside the keystone.
     */
    this.stageViewMode = this.useProjectorWarp ? "top" : "perspective";

    // Scroll zoom + right-drag orbit. Left click stays free for handle drags /
    // model picks on Control. Enabled on the projector stage too so you can
    // tilt the throw away from a flat top-down plate.
    this.orbitControls = new OrbitControls(this.camera, canvas);
    this.orbitControls.target.set(0, 0.15, 0);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.minDistance = 0.8;
    this.orbitControls.maxDistance = 48;
    this.orbitControls.maxPolarAngle = Math.PI * 0.495;
    // Stage mapping: left-drag = pan, right-drag = orbit/tilt, scroll = zoom.
    // (Corner handles sit above the canvas and keep left-drag for themselves.)
    this.orbitControls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: null,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.orbitControls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.orbitControls.screenSpacePanning = true;
    this.orbitControls.enablePan = true;
    this.orbitControls.enableRotate = true;
    this.orbitControls.enableZoom = true;
    // Top (default on projector) locks orbit; 3D mode re-enables it.
    this.orbitControls.enabled = this.stageViewMode !== "top";
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    // Anamorphic / face-aligned / fixed-FOV projector passes.
    this.offAxisCamera = createOffAxisCamera();
    this.faceCamera = new THREE.PerspectiveCamera(40, 1, 0.08, 250);
    this.faceOrthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.08, 250);
    this.projectorCamera = new THREE.PerspectiveCamera(40, 16 / 9, 0.08, 250);
    this.venueState = normalizeVenueState();
    this.boxFaces = buildBoxFaces(this.venueState.box);
    this._eyePosition = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._dollyDirection = new THREE.Vector3();
    this._previzFaceKey = "";

    this.fxState = normalizeStageFxState(
      options.stageFx || createDefaultStageFxState()
    );
    this.rimLightUniforms = createRimLightUniforms();

    const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 1.35);
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(2.5, 5, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
    // Tight ortho box around the play area keeps the shadow texels dense.
    key.shadow.camera.left = -2.2;
    key.shadow.camera.right = 2.2;
    key.shadow.camera.top = 2.2;
    key.shadow.camera.bottom = -2.2;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 14;
    this.keyLight = key;
    this._keyLightBaseIntensity = 2.8;
    const fill = new THREE.DirectionalLight(0xaaccff, 1.2);
    fill.position.set(-3, 2, -2);
    this.fillLight = fill;
    const front = new THREE.DirectionalLight(0xffffff, 1.4);
    front.position.set(0, 1.5, 4);
    this.frontLight = front;
    this.scene.add(hemi, key, fill, front);

    this.battleMapState = normalizeBattleMapState();
    this._battleMapLoadToken = 0;

    this.boxSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      createFallbackBoxMaterial(this.testBackdrop ? 0.55 : 0.18)
    );
    this.boxSurface.rotation.x = -Math.PI / 2;
    this.boxSurface.position.y = -0.002;
    this.boxSurface.receiveShadow = true;
    this.boxSurface.frustumCulled = !this.useProjectorWarp;
    this.boxSurface.material.side = THREE.DoubleSide;
    this.boxSurface.material.polygonOffset = true;
    this.boxSurface.material.polygonOffsetFactor = 1;
    this.boxSurface.material.polygonOffsetUnits = 1;
    this.boxSurface.userData.fallbackMaterial = this.boxSurface.material;
    this.boxSurface.userData.usingBattleMap = false;
    this.scene.add(this.boxSurface);

    // Shadow catcher for the battle-map shader, which cannot receive shadows itself.
    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.ShadowMaterial({ opacity: 0.55 })
    );
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.position.y = 0.004;
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.raycast = () => {};
    this.scene.add(this.shadowCatcher);

    this.groundFxRoot = new THREE.Group();
    this.groundFxRoot.name = "ground-fx";
    this.scene.add(this.groundFxRoot);

    this.atmosphere = createAtmosphere(this.boxHalfExtent);
    this.scene.add(this.atmosphere.group);

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(2.4, 2.4)),
      new THREE.LineBasicMaterial({ color: 0xd4a017 })
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.002;
    this.boxEdge = edge;
    this.scene.add(edge);

    this.gridHelper = new THREE.GridHelper(2.4, 8, 0x6688aa, 0x334455);
    this.gridHelper.position.y = 0.003;
    this.gridHelper.visible = false;
    this.scene.add(this.gridHelper);

    // Dark room floor so zooming out still reads as a stage (mapping-tool feel).
    this.roomFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.MeshStandardMaterial({
        color: 0x12151c,
        roughness: 0.92,
        metalness: 0.05,
      })
    );
    this.roomFloor.rotation.x = -Math.PI / 2;
    this.roomFloor.position.y = -0.02;
    this.roomFloor.receiveShadow = true;
    this.roomFloor.raycast = () => {};
    this.roomFloor.visible = !this.useProjectorWarp;
    this.scene.add(this.roomFloor);

    this.roomGrid = new THREE.GridHelper(24, 24, 0x2a3344, 0x1a2030);
    this.roomGrid.position.y = -0.015;
    this.roomGrid.raycast = () => {};
    this.roomGrid.visible = !this.useProjectorWarp;
    this.scene.add(this.roomGrid);

    this.actorRoot = new THREE.Group();
    this.scene.add(this.actorRoot);

    this.characterStageState = createDefaultCharacterStageState();
    this.characterStageRoot = createCharacterStageVisual();
    this.scene.add(this.characterStageRoot);
    applyCharacterStageBackdrop(
      this.characterStageRoot,
      this.characterStageState.backdrop
    );
    this.syncCharacterStage();

    // Real-world eye + frustum pyramids (control preview only).
    this.venueHelperRoot = createVenueFrustumHelpers(this.venueState);
    this.scene.add(this.venueHelperRoot);

    // Projected light on the box (Mapping Studio / control 3D previz only).
    this.projectorPrevizRoot = createProjectorPrevizOverlay();
    this.scene.add(this.projectorPrevizRoot);

    this.sceneTarget = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    });
    this.sceneTarget.texture.colorSpace = THREE.SRGBColorSpace;
    this.sceneTarget.texture.flipY = false;

    this.projectorWarp = createProjectorWarp(this.sceneTarget.texture);
    this.postProcessing = createStagePostProcessing(
      this.renderer,
      this.scene,
      this.camera,
      2,
      2
    );
    this.postProcessing.updateFromState(this.fxState);
    this.applyStageFxToScene();

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);

    canvas.addEventListener(
      "webglcontextlost",
      (event) => {
        event.preventDefault();
        this._contextLost = true;
        cancelAnimationFrame(this._raf);
      },
      false
    );
    canvas.addEventListener(
      "webglcontextrestored",
      () => {
        this._contextLost = false;
        this.resize();
        this.animate();
      },
      false
    );

    this.resize();
    if (this.useProjectorWarp) {
      this.setStageViewMode("perspective");
    }
    this.animate();
  }

  /** Global stage FX merged with the active battle map's optional overrides. */
  getEffectiveStageFxState() {
    return resolveStageFxForBattleMap(
      this.fxState,
      this.battleMapState?.mapId
    );
  }

  syncPostProcessingToBattleMap() {
    this.postProcessing?.updateFromState(this.getEffectiveStageFxState());
  }

  /** Push FX settings onto everything that is not a post-processing pass. */
  applyStageFxToScene() {
    const fx = this.fxState;
    const shadowsOn = fx.enabled && fx.shadowsEnabled;

    this.renderer.shadowMap.enabled = shadowsOn;
    this.keyLight.castShadow = shadowsOn;
    this.shadowCatcher.visible = shadowsOn;
    this.shadowCatcher.material.opacity = fx.shadowOpacity;

    updateRimLightUniforms(this.rimLightUniforms, fx);

    const contactStrength = fx.enabled ? fx.contactShadowStrength : 0;
    for (const entry of this.actors.values()) {
      updateContactShadow(entry.contactShadow, {
        strength: contactStrength,
        elevation: entry.elevation || 0,
      });
    }
  }

  setStageFx(stageFx) {
    this.fxState = normalizeStageFxState(stageFx || {});
    this.syncPostProcessingToBattleMap();
    this.applyStageFxToScene();
    return this.fxState;
  }

  setVenueState(venueState) {
    this.venueState = normalizeVenueState(venueState || {});
    this.boxFaces = buildBoxFaces(this.venueState.box);
    this.syncBoxSurfaceToVenue();
    this._previzFaceKey = "";
    this.refreshVenueHelpers();
    return this.venueState;
  }

  /**
   * Keep the battle-map plane sized to the physical top face. Otherwise a deep
   * or shallow box leaves black bars inside the projector feed and keystone
   * cannot stretch the map into those corners.
   */
  syncBoxSurfaceToVenue() {
    const { halfWidth, halfDepth } = getBoxExtents(
      this.venueState?.box || { widthCm: 120, depthCm: 120, heightCm: 60 }
    );
    const width = Math.max(0.01, halfWidth * 2);
    const depth = Math.max(0.01, halfDepth * 2);
    this.boxHalfExtent = halfWidth;
    this._boxHalfDepth = halfDepth;

    const replaceHorizontalPlane = (mesh, makeGeometry) => {
      if (!mesh) return;
      mesh.geometry?.dispose?.();
      mesh.geometry = makeGeometry(width, depth);
    };

    replaceHorizontalPlane(
      this.boxSurface,
      (planeWidth, planeDepth) => new THREE.PlaneGeometry(planeWidth, planeDepth)
    );
    replaceHorizontalPlane(
      this.shadowCatcher,
      (planeWidth, planeDepth) => new THREE.PlaneGeometry(planeWidth, planeDepth)
    );
    if (this.boxEdge) {
      this.boxEdge.geometry?.dispose?.();
      this.boxEdge.geometry = new THREE.EdgesGeometry(
        new THREE.PlaneGeometry(width, depth)
      );
    }
    this.syncCharacterStage();
  }

  setCharacterStage(characterStage) {
    this.characterStageState = normalizeCharacterStageState(
      characterStage || {}
    );
    this.syncCharacterStage();
    return this.characterStageState;
  }

  getCharacterStageState() {
    return normalizeCharacterStageState(this.characterStageState);
  }

  setCharacterStageSize(size) {
    const next = normalizeCharacterStageState({
      ...this.characterStageState,
      size,
    });
    this.characterStageState = next;
    this.syncCharacterStage();
    return next;
  }

  syncCharacterStage() {
    if (!this.characterStageRoot) return;
    const pose = getCharacterStageWorldPose(
      this.characterStageState,
      this.boxHalfExtent,
      this._boxHalfDepth
    );
    updateCharacterStageVisual(this.characterStageRoot, pose);
  }

  /** Camera used for stage-handle projection / drag math. */
  getCharacterStageInteractionCamera() {
    return this.useProjectorWarp && this.stageViewMode === "top"
      ? this.faceOrthoCamera
      : this.camera;
  }

  projectWorldToClient(worldX, worldY, worldZ, camera = null) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const activeCamera = camera || this.getCharacterStageInteractionCamera();
    this._worldToScreen.set(worldX, worldY, worldZ);
    this._worldToScreen.project(activeCamera);
    const ndcX = this._worldToScreen.x;
    const ndcY = this._worldToScreen.y;
    const visible =
      this._worldToScreen.z <= 1 &&
      Math.abs(ndcX) <= 1.6 &&
      Math.abs(ndcY) <= 1.6;
    return {
      x: ((ndcX + 1) / 2) * rect.width + rect.left,
      y: ((-ndcY + 1) / 2) * rect.height + rect.top,
      visible,
      rect,
    };
  }

  /**
   * Project the four floor corners of the 3D stage into client pixels.
   * Used by Open Stage drag-handles. Returns null when the stage is off.
   */
  projectCharacterStageCorners() {
    const pose = getCharacterStageWorldPose(
      this.characterStageState,
      this.boxHalfExtent,
      this._boxHalfDepth
    );
    if (!pose.enabled) return null;

    const half = pose.halfSize;
    const y = pose.centerY + 0.01;
    const worldCorners = {
      nw: { x: pose.centerX - half, y, z: pose.centerZ - half },
      ne: { x: pose.centerX + half, y, z: pose.centerZ - half },
      se: { x: pose.centerX + half, y, z: pose.centerZ + half },
      sw: { x: pose.centerX - half, y, z: pose.centerZ + half },
    };

    const camera = this.getCharacterStageInteractionCamera();
    const projected = {};
    let rect = null;
    for (const [key, point] of Object.entries(worldCorners)) {
      const screen = this.projectWorldToClient(point.x, point.y, point.z, camera);
      if (!screen) return null;
      rect = screen.rect;
      projected[key] = screen;
    }

    // Map-edge attachment point — fixed in world as size changes (scale origin).
    const halfDepth = this._boxHalfDepth ?? this.boxHalfExtent;
    const anchor = this.projectWorldToClient(
      pose.centerX,
      y,
      -halfDepth,
      camera
    );

    return { pose, corners: projected, rect, anchor };
  }

  /**
   * Start a mouse resize. Freezes the map-edge anchor in screen space so
   * growing/shrinking the booth cannot fight a moving centre.
   */
  beginCharacterStageResize(clientX, clientY, cornerKey = "se") {
    const projected = this.projectCharacterStageCorners();
    if (!projected?.anchor) return null;

    const corner = projected.corners[cornerKey] || projected.corners.se;
    const anchorX = projected.anchor.x;
    const anchorY = projected.anchor.y;
    const pointerDist = Math.hypot(clientX - anchorX, clientY - anchorY);
    const cornerDist = corner
      ? Math.hypot(corner.x - anchorX, corner.y - anchorY)
      : pointerDist;
    // Prefer corner→anchor length so the grab doesn't jump on pointer-down.
    const startDist = Math.max(28, cornerDist || pointerDist);

    return {
      cornerKey,
      startSize: projected.pose.size,
      startDist,
      anchorX,
      anchorY,
      startClientX: clientX,
      startClientY: clientY,
    };
  }

  /**
   * Continue a mouse resize from beginCharacterStageResize().
   * Screen-space proportional scale — stable in 3D orbit and top-down.
   */
  resizeCharacterStageFromDrag(clientX, clientY, dragState) {
    if (!dragState) return null;
    const dist = Math.hypot(
      clientX - dragState.anchorX,
      clientY - dragState.anchorY
    );
    const safeDist = Math.max(12, dist);
    const ratio = safeDist / dragState.startDist;
    // Soften extreme pulls so tiny hand jitter near the anchor doesn't explode.
    const easedRatio = THREE.MathUtils.clamp(ratio, 0.15, 6);
    const nextSize = THREE.MathUtils.clamp(
      dragState.startSize * easedRatio,
      MIN_SIZE,
      MAX_SIZE
    );
    return this.setCharacterStageSize(nextSize);
  }

  /**
   * World-space fallback: size from the fixed map-edge attachment (not the
   * moving booth centre — that was what made drag feel broken).
   */
  resizeCharacterStageFromPointer(clientX, clientY) {
    const pose = getCharacterStageWorldPose(
      this.characterStageState,
      this.boxHalfExtent,
      this._boxHalfDepth
    );
    if (!pose.enabled) return null;

    const ndc = this.getPointerNdc(clientX, clientY);
    if (!ndc) return null;
    this._pointerNdc.set(ndc.x, ndc.y);
    this.raycaster.setFromCamera(
      this._pointerNdc,
      this.getCharacterStageInteractionCamera()
    );

    this._dragPlane.set(new THREE.Vector3(0, 1, 0), -pose.centerY);
    if (!this.raycaster.ray.intersectPlane(this._dragPlane, this._dragHit)) {
      return null;
    }

    const halfDepth = this._boxHalfDepth ?? this.boxHalfExtent;
    const mapEdgeZ = -halfDepth;
    const extentX = Math.abs(this._dragHit.x - pose.centerX) * 2;
    // Stage only lives on the −Z side of the map's far edge.
    const extentZ = Math.max(0.001, mapEdgeZ - this._dragHit.z);
    const nextSize = THREE.MathUtils.clamp(
      Math.max(extentX, extentZ),
      MIN_SIZE,
      MAX_SIZE
    );
    return this.setCharacterStageSize(nextSize);
  }

  /** Rebuild eye / frustum helpers from the current venue measurements. */
  refreshVenueHelpers() {
    if (this.venueHelperRoot) {
      this.scene.remove(this.venueHelperRoot);
      disposeVenueFrustumHelpers(this.venueHelperRoot);
    }
    this.venueHelperRoot = createVenueFrustumHelpers(this.venueState);
    this.scene.add(this.venueHelperRoot);
    this.setVenueHelpersVisible(this.shouldShowVenueHelpers());
  }

  /** Helpers belong in the control preview, never in projector output. */
  shouldShowVenueHelpers() {
    return (
      Boolean(this.venueState?.showFrustumHelpers) &&
      !this.useProjectorWarp
    );
  }

  setVenueHelpersVisible(visible) {
    if (this.venueHelperRoot) {
      this.venueHelperRoot.visible = Boolean(visible);
    }
    if (this.projectorPrevizRoot && !visible) {
      this.projectorPrevizRoot.visible = false;
    }
  }

  /** Place the control camera at the active projector's real-world eye. */
  frameActiveProjectorEye() {
    const projector = getProjectorById(
      this.venueState,
      this.venueState.activeProjectorId
    );
    if (!projector) return false;
    computeEyePosition(projector.viewer, this.venueState.box, this._eyePosition);
    this.camera.position.copy(this._eyePosition);
    this.camera.fov = projector.fovDegrees ?? 40;
    this.camera.aspect =
      (this.canvas.clientWidth || 1) / Math.max(1, this.canvas.clientHeight || 1);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 0.25, 0);
    this.camera.updateMatrixWorld(true);
    if (this.orbitControls) {
      this.orbitControls.target.set(0, 0.25, 0);
      this.orbitControls.update();
    }
    return true;
  }

  resetPreviewCamera() {
    this.framePlaySurface3D();
  }

  /** Slightly angled overhead — monsters read in 3D, map still fills the throw. */
  framePlaySurface3D() {
    const { halfWidth, halfDepth } = getBoxExtents(
      this.venueState?.box || { widthCm: 120, depthCm: 120, heightCm: 60 }
    );
    const span = Math.max(halfWidth, halfDepth, 0.6);
    this.camera.position.set(span * 0.15, span * 2.05, span * 1.55);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0.05, 0);
    this.camera.updateMatrixWorld(true);
    if (this.orbitControls) {
      this.orbitControls.target.set(0, 0.05, 0);
      this.orbitControls.update();
    }
  }

  /** Classic straight-down framing used by the Top view mode. */
  framePlaySurfaceTop() {
    const { halfWidth, halfDepth } = getBoxExtents(
      this.venueState?.box || { widthCm: 120, depthCm: 120, heightCm: 60 }
    );
    const span = Math.max(halfWidth, halfDepth, 0.6);
    this.camera.position.set(0, span * 3.2, 0.001);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld(true);
    if (this.orbitControls) {
      this.orbitControls.target.set(0, 0, 0);
      this.orbitControls.update();
    }
  }

  /**
   * @param {"perspective"|"top"} mode
   */
  setStageViewMode(mode) {
    const next = mode === "top" ? "top" : "perspective";
    this.stageViewMode = next;
    if (next === "top") {
      this.framePlaySurfaceTop();
      // Lock orbit in top mode so a stray right-click doesn't leave ortho land.
      this.setOrbitEnabled(false);
    } else {
      this.framePlaySurface3D();
      this.setOrbitEnabled(true);
    }
    return this.stageViewMode;
  }

  getStageViewMode() {
    return this.stageViewMode || "perspective";
  }

  /** Temporarily lock orbit while dragging a projector / model / corner. */
  setOrbitEnabled(enabled) {
    if (this.orbitControls) {
      // Top view keeps orbit off even if a caller asks to enable it.
      if (this.stageViewMode === "top") {
        this.orbitControls.enabled = false;
        return;
      }
      this.orbitControls.enabled = Boolean(enabled);
    }
  }

  /**
   * Pick a placeable projector camera in the control preview.
   * Returns { projectorId, worldPosition } or null.
   */
  pickProjector(clientX, clientY) {
    if (this.useProjectorWarp) return null;
    if (!this.venueHelperRoot?.visible) return null;
    const ndc = this.getPointerNdc(clientX, clientY);
    if (!ndc) return null;
    this._pointerNdc.set(ndc.x, ndc.y);
    this.raycaster.setFromCamera(this._pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.venueHelperRoot.children,
      true
    );
    for (const hit of hits) {
      let object = hit.object;
      while (object) {
        if (object.userData?.kind === "projector-camera" && object.userData.projectorId) {
          const projector = getProjectorById(
            this.venueState,
            object.userData.projectorId
          );
          if (!projector) return null;
          computeEyePosition(
            projector.viewer,
            this.venueState.box,
            this._eyePosition
          );
          return {
            projectorId: projector.id,
            x: this._eyePosition.x,
            y: this._eyePosition.y,
            z: this._eyePosition.z,
          };
        }
        object = object.parent;
      }
    }
    return null;
  }

  /**
   * Raycast onto a horizontal plane at world Y (for dragging a projector
   * around the balcony without clamping to the box footprint).
   */
  hitHorizontalPlane(clientX, clientY, planeY = 0) {
    if (this.useProjectorWarp) return null;
    const ndc = this.getPointerNdc(clientX, clientY);
    if (!ndc) return null;
    this._pointerNdc.set(ndc.x, ndc.y);
    this.raycaster.setFromCamera(this._pointerNdc, this.camera);
    this._dragPlane.set(new THREE.Vector3(0, 1, 0), -planeY);
    if (!this.raycaster.ray.intersectPlane(this._dragPlane, this._dragHit)) {
      return null;
    }
    return {
      x: this._dragHit.x,
      y: planeY,
      z: this._dragHit.z,
    };
  }

  /**
   * Move a projector's eye in world units and rebuild frustum helpers.
   * Returns the updated venue state (also stored on this.venueState).
   */
  setProjectorWorldPosition(projectorId, worldPosition) {
    const venue = normalizeVenueState(structuredClone(this.venueState));
    const projector = getProjectorById(venue, projectorId);
    if (!projector) return this.venueState;
    // Keep cameras above the top face when that face is covered — under the
    // plane the anamorphic/camera view of "top" is empty.
    const nextPosition = {
      x: worldPosition.x,
      y: worldPosition.y,
      z: worldPosition.z,
    };
    if (projector.faceIds?.includes("top")) {
      nextPosition.y = Math.max(0.35, nextPosition.y);
    }
    setViewerWorldPosition(projector.viewer, venue.box, nextPosition);
    projector.azimuthDegrees = projector.viewer.azimuthDegrees;
    venue.activeProjectorId = projectorId;
    return this.setVenueState(venue);
  }

  /**
   * Dolly the projector toward / away from the box centre (scroll while held).
   */
  dollyProjector(projectorId, scrollDeltaY) {
    const projector = getProjectorById(this.venueState, projectorId);
    if (!projector) return this.venueState;
    computeEyePosition(projector.viewer, this.venueState.box, this._eyePosition);
    this._lookTarget.set(0, 0, 0);
    this._dollyDirection.subVectors(this._lookTarget, this._eyePosition);
    const distance = this._dollyDirection.length();
    if (distance < 1e-4) return this.venueState;
    this._dollyDirection.multiplyScalar(1 / distance);
    // Wheel up (negative delta) → move closer.
    const step = THREE.MathUtils.clamp(-scrollDeltaY * 0.01, -1.2, 1.2);
    const nextDistance = THREE.MathUtils.clamp(distance - step, 0.6, 40);
    this._eyePosition
      .copy(this._lookTarget)
      .addScaledVector(this._dollyDirection, -nextDistance);
    return this.setProjectorWorldPosition(projectorId, this._eyePosition);
  }

  /** Aim key / fill lights from the active projector for stronger 3D read. */
  updateVenueLighting() {
    if (!this.venueState?.enabled) {
      this.keyLight.intensity = this._keyLightBaseIntensity;
      return;
    }
    const projector = getProjectorById(
      this.venueState,
      this.venueState.activeProjectorId
    );
    if (!projector) return;
    computeEyePosition(projector.viewer, this.venueState.box, this._eyePosition);
    this.keyLight.position.copy(this._eyePosition);
    this.keyLight.intensity = 3.4;
    if (this.fillLight) {
      this.fillLight.position.set(
        -this._eyePosition.x * 0.35,
        Math.max(2, this._eyePosition.y * 0.5),
        -this._eyePosition.z * 0.35
      );
    }
  }

  /** True when output geometry comes from the anamorphic multi-face path. */
  isVenueModeActive() {
    return Boolean(this.venueState.enabled) && this.useProjectorWarp;
  }

  setTestBackdrop(enabled) {
    this.testBackdrop = Boolean(enabled);
    const color = this.testBackdrop ? 0x141820 : 0x000000;
    this.scene.background = new THREE.Color(color);
    this.renderer.setClearColor(color, 1);
    if (!this.boxSurface.userData.usingBattleMap) {
      // Projector feed needs a readable surface even without a battle map.
      const opacity = this.useProjectorWarp
        ? 1
        : this.testBackdrop
          ? 0.55
          : 0.18;
      if (this.boxSurface.material?.opacity !== undefined) {
        this.boxSurface.material.opacity = opacity;
      }
      if (this.boxSurface.material?.transparent !== undefined && this.useProjectorWarp) {
        this.boxSurface.material.transparent = false;
        this.boxSurface.material.opacity = 1;
      }
    }
    this.refreshBoxSurfaceVisibility();
  }

  setShowBoxGuide(enabled) {
    this.showBoxGuide = Boolean(enabled);
    this.refreshBoxSurfaceVisibility();
    this.boxEdge.visible = this.showBoxGuide;
  }

  refreshBoxSurfaceVisibility() {
    // Projector feed always needs the play surface — otherwise the warp RT is
    // empty black even with healthy full-frame corners.
    if (this.useProjectorWarp) {
      this.boxSurface.visible = true;
      return;
    }
    const mapOn = Boolean(this.boxSurface?.userData?.usingBattleMap);
    this.boxSurface.visible =
      mapOn || this.showBoxGuide || this.testBackdrop;
  }

  async setBattleMap(battleMapState) {
    this.battleMapState = normalizeBattleMapState(battleMapState || {});
    const loadToken = ++this._battleMapLoadToken;
    const fallbackOpacity = this.useProjectorWarp
      ? 1
      : this.testBackdrop
        ? 0.55
        : 0.18;
    const result = await applyBattleMapToSurface(
      this.boxSurface,
      this.battleMapState,
      { fallbackOpacity }
    );
    if (loadToken !== this._battleMapLoadToken) return result;
    if (
      this.useProjectorWarp &&
      !this.boxSurface.userData.usingBattleMap &&
      this.boxSurface.material
    ) {
      this.boxSurface.material.transparent = false;
      this.boxSurface.material.opacity = 1;
    }
    this.refreshBoxSurfaceVisibility();
    this.syncPostProcessingToBattleMap();
    return result;
  }

  updateFogOfWarReveal(battleMapState) {
    this.battleMapState = normalizeBattleMapState(battleMapState || {});
    const revealedRegions = this.battleMapState.fogOfWar?.revealedRegions || [];
    syncMapRevealLayers(this.boxSurface, revealedRegions);
  }

  setCalibrationGrid(enabled) {
    this.calibrationGrid = Boolean(enabled);
    this.gridHelper.visible = this.calibrationGrid;
  }

  setMode(mode) {
    this.mode = mode === "ghost" ? "ghost" : "single";
  }

  setProjectorCorners(corners) {
    this.corners = clampProjectorCorners(corners);
  }

  setUseProjectorWarp(enabled) {
    this.useProjectorWarp = Boolean(enabled);
    this.setVenueHelpersVisible(this.shouldShowVenueHelpers());
  }

  getPointerNdc(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -((clientY - rect.top) / rect.height) * 2 + 1,
      rect,
    };
  }

  /** World XZ on the box floor under the pointer (clamped to the box). */
  hitBoxFloor(clientX, clientY) {
    if (this.useProjectorWarp) return null;
    const ndc = this.getPointerNdc(clientX, clientY);
    if (!ndc) return null;
    this._pointerNdc.set(ndc.x, ndc.y);
    this.raycaster.setFromCamera(this._pointerNdc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this._floorPlane, this._floorHit)) {
      return null;
    }
    const halfWidth = this.boxHalfExtent;
    const halfDepth = this._boxHalfDepth ?? this.boxHalfExtent;
    return {
      x: Math.min(halfWidth, Math.max(-halfWidth, this._floorHit.x)),
      z: Math.min(halfDepth, Math.max(-halfDepth, this._floorHit.z)),
      outside:
        Math.abs(this._floorHit.x) > halfWidth + 0.001 ||
        Math.abs(this._floorHit.z) > halfDepth + 0.001,
    };
  }

  /** True when the pointer is over a loaded actor mesh. */
  hitActor(clientX, clientY, actorId = null) {
    return Boolean(this.pickActor(clientX, clientY, actorId));
  }

  /**
   * Closest actor under the pointer. Pass actorId to restrict to one id,
   * or an array/Set of ids. Near-floor fallback uses 0.55 world units.
   */
  pickActor(clientX, clientY, actorId = null) {
    if (this.useProjectorWarp) return null;
    const ndc = this.getPointerNdc(clientX, clientY);
    if (!ndc) return null;
    this._pointerNdc.set(ndc.x, ndc.y);
    this.raycaster.setFromCamera(this._pointerNdc, this.camera);

    const allowedIds =
      actorId == null
        ? null
        : actorId instanceof Set
          ? actorId
          : Array.isArray(actorId)
            ? new Set(actorId)
            : new Set([actorId]);

    const roots = [];
    for (const entry of this.actors.values()) {
      if (!entry.wrapper.visible || !entry.model) continue;
      if (allowedIds && !allowedIds.has(entry.id)) continue;
      roots.push(entry.wrapper);
    }

    if (roots.length) {
      const hits = this.raycaster.intersectObjects(roots, true);
      if (hits.length) {
        let hitObject = hits[0].object;
        while (hitObject) {
          for (const entry of this.actors.values()) {
            if (entry.wrapper === hitObject) {
              return {
                id: entry.id,
                x: entry.wrapper.position.x,
                z: entry.wrapper.position.z,
              };
            }
          }
          hitObject = hitObject.parent;
        }
      }
    }

    const floor = this.hitBoxFloor(clientX, clientY);
    if (!floor) return null;

    let best = null;
    let bestDistance = 0.55;
    for (const entry of this.actors.values()) {
      if (!entry.wrapper.visible || !entry.model) continue;
      if (allowedIds && !allowedIds.has(entry.id)) continue;
      const distance = Math.hypot(
        floor.x - entry.wrapper.position.x,
        floor.z - entry.wrapper.position.z
      );
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = {
          id: entry.id,
          x: entry.wrapper.position.x,
          z: entry.wrapper.position.z,
        };
      }
    }
    return best;
  }

  /** Client-space rectangle containing the actor's floor position, or null. */
  projectActorToClient(actorId) {
    const entry = this.actors.get(actorId);
    if (!entry?.wrapper) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this._worldToScreen.set(
      entry.wrapper.position.x,
      0.15,
      entry.wrapper.position.z
    );
    this._worldToScreen.project(this.camera);
    return {
      x: ((this._worldToScreen.x + 1) / 2) * rect.width + rect.left,
      y: ((-this._worldToScreen.y + 1) / 2) * rect.height + rect.top,
    };
  }

  /** Actor ids whose projected floor points lie inside a client-space rect. */
  pickActorsInClientRect(left, top, right, bottom) {
    const minX = Math.min(left, right);
    const maxX = Math.max(left, right);
    const minY = Math.min(top, bottom);
    const maxY = Math.max(top, bottom);
    const ids = [];
    for (const entry of this.actors.values()) {
      if (!entry.wrapper.visible) continue;
      const point = this.projectActorToClient(entry.id);
      if (!point) continue;
      if (
        point.x >= minX &&
        point.x <= maxX &&
        point.y >= minY &&
        point.y <= maxY
      ) {
        ids.push(entry.id);
      }
    }
    return ids;
  }

  createSelectionRing() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.32, 48),
      new THREE.MeshBasicMaterial({
        color: 0xe0b13a,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    ring.name = "selection-ring";
    ring.visible = false;
    ring.raycast = () => {};
    return ring;
  }

  setSelectedActorIds(ids = []) {
    this.selectedActorIds = new Set(ids);
    for (const entry of this.actors.values()) {
      if (entry.selectionRing) {
        // No gold ring under stage characters — the booth already frames them.
        entry.selectionRing.visible =
          !entry.onCharacterStage && this.selectedActorIds.has(entry.id);
      }
    }
  }

  /**
   * Start a model drag if the pointer is on the actor, or on the box near it.
   * Returns floor hit when drag should begin.
   */
  beginModelDrag(clientX, clientY, actorId, actorPosition = null) {
    const floor = this.hitBoxFloor(clientX, clientY);
    if (!floor) return null;
    if (this.hitActor(clientX, clientY, actorId)) {
      return floor;
    }
    if (actorPosition) {
      const distance = Math.hypot(
        floor.x - (actorPosition.x || 0),
        floor.z - (actorPosition.z || 0)
      );
      if (distance <= 0.55) return floor;
    }
    return null;
  }

  resize() {
    if (this._contextLost) return;
    const parent = this.canvas.parentElement;
    const width = Math.max(
      this.canvas.clientWidth || parent?.clientWidth || window.innerWidth || 1,
      1
    );
    const height = Math.max(
      this.canvas.clientHeight || parent?.clientHeight || window.innerHeight || 1,
      1
    );
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Mild supersample on the projector face buffer — 1.75 was crushing GPUs
    // when Spider/Demon brought multi‑4K textures.
    const pixelRatio = this.renderer.getPixelRatio();
    const qualityScale = this.useProjectorWarp ? 1.15 : 1;
    const bufferWidth = Math.max(
      1,
      Math.floor(width * pixelRatio * qualityScale)
    );
    const bufferHeight = Math.max(
      1,
      Math.floor(height * pixelRatio * qualityScale)
    );
    this.sceneTarget.setSize(bufferWidth, bufferHeight);
    this.postProcessing?.setSize(bufferWidth, bufferHeight);
    this.faceCamera.aspect = bufferWidth / Math.max(1, bufferHeight);
    this.faceCamera.updateProjectionMatrix();
    this.projectorCamera.aspect = bufferWidth / Math.max(1, bufferHeight);
    this.projectorCamera.updateProjectionMatrix();
  }

  disposeObject(root) {
    disposeObjectResources(root);
  }

  normalizeModel(root, scaleMultiplier = 1) {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);

    let box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);

    const tallest = Math.max(size.x, size.y, size.z, 0.001);
    root.scale.setScalar((1.15 / tallest) * scaleMultiplier);
    root.updateMatrixWorld(true);

    box = new THREE.Box3().setFromObject(root);
    box.getSize(size);
    root.userData.normalizedBounds = {
      x: Math.max(size.x, 0.001),
      y: Math.max(size.y, 0.001),
      z: Math.max(size.z, 0.001),
    };
    box.getCenter(center);
    root.position.x += -center.x;
    root.position.z += -center.z;
    root.position.y += -box.min.y;
  }

  rememberCharacterModelBounds(characterId, bounds) {
    if (!characterId || !bounds) return;
    this.modelBoundsByCharacterId.set(characterId, {
      x: Math.max(Number(bounds.x) || 0, 0.001),
      y: Math.max(Number(bounds.y) || 0, 0.001),
      z: Math.max(Number(bounds.z) || 0, 0.001),
    });
  }

  getCharacterModelBounds(characterId) {
    return (
      this.modelBoundsByCharacterId.get(characterId) ||
      DEFAULT_CHARACTER_MODEL_BOUNDS
    );
  }

  getMaxActorInstanceScaleForCharacterStage(characterId, characterStageState) {
    return getMaxActorInstanceScaleForCharacterStage(
      this.getCharacterModelBounds(characterId),
      characterStageState,
      this.boxHalfExtent,
      this._boxHalfDepth
    );
  }

  prepareMaterials(root, { preserveDark = false } = {}) {
    // Shrink 4K character maps before first GPU upload / draw.
    clampObjectTextures(root);

    let triangleCount = 0;
    root.traverse((object) => {
      if (!object.isMesh) return;
      const position = object.geometry?.attributes?.position;
      if (position) triangleCount += Math.floor(position.count / 3);
    });
    // Dense hero meshes (e.g. Shadow Demon ~2M tris) skip shadow casting —
    // the map still reads; shadows were a huge cost.
    const castShadows = triangleCount < 120_000;

    root.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = castShadows;
      object.receiveShadow = false;
      object.frustumCulled = !this.useProjectorWarp;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (!material) continue;
        material.side = THREE.FrontSide;
        if (material.map) {
          material.map.colorSpace = THREE.SRGBColorSpace;
          material.map.anisotropy = 1;
        }
        if (material.normalMap) material.normalMap.anisotropy = 1;
        if (material.color && !preserveDark) {
          const hsl = { h: 0, s: 0, l: 0 };
          material.color.getHSL(hsl);
          if (hsl.l < 0.12 && !material.map) {
            material.color.setHSL(hsl.h, hsl.s, 0.28);
          }
        }
        material.roughness = Math.min(material.roughness ?? 0.7, 0.85);
        material.metalness = Math.min(material.metalness ?? 0.05, 0.15);
        material.needsUpdate = true;
      }
    });
    applyRimLightToObject(root, this.rimLightUniforms);
  }

  finishModelLoad(root, actor) {
    const lookId = actor?.look || "";
    const preserveDark = lookId === "void-black";
    // Void silhouette never uses albedo/normal/ORM — dump 4K maps before clamp.
    if (preserveDark) {
      root.traverse((object) => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) {
          stripMaterialMaps(material, { keepColorMap: false });
        }
      });
    }
    this.prepareMaterials(root, { preserveDark });
    this.normalizeModel(root, 1);
    const characterKey = actor?.characterId || actor?.id;
    if (characterKey && root.userData.normalizedBounds) {
      this.rememberCharacterModelBounds(
        characterKey,
        root.userData.normalizedBounds
      );
    }
    const characterFx = combineCharacterFx([
      applyCharacterLook(root, lookId, {
        faceForward: actor?.faceForward ?? null,
      }),
      attachCharacterFx(root, actor?.fx || ""),
    ]);
    return { root, characterFx };
  }

  async loadModelRoot(actor) {
    const characterKey = actor.characterId || actor.id;
    const fileCandidates = [actor.file, actor.fallbackFile].filter(Boolean);

    for (const filePath of fileCandidates) {
      try {
        const gltf = await loader.loadAsync(filePath);
        const finished = this.finishModelLoad(gltf.scene, actor);
        let mixer = null;
        if (gltf.animations?.length) {
          mixer = new THREE.AnimationMixer(finished.root);
          const clip =
            gltf.animations.find((item) =>
              /idle|stand|breath/i.test(item.name)
            ) || gltf.animations[0];
          mixer.clipAction(clip).play();
        }
        return {
          root: finished.root,
          mixer,
          source: "file",
          characterFx: finished.characterFx,
        };
      } catch (error) {
        console.warn(
          `GLB missing at ${filePath} for ${characterKey}, trying next…`,
          error
        );
      }
    }

    if (!hasProceduralCharacter(characterKey)) {
      throw new Error(`No model for ${characterKey}`);
    }
    const root = createProceduralCharacter(characterKey);
    const finished = this.finishModelLoad(root, actor);
    return {
      root: finished.root,
      mixer: null,
      source: "procedural",
      characterFx: finished.characterFx,
    };
  }

  applyActorTransform(entry, actor) {
    const visible = Boolean(actor.enabled);
    const scaleValue = Number(actor.scale);
    let scale = Number.isFinite(scaleValue) && scaleValue > 0 ? scaleValue : 1;
    const elevationValue = Number(actor.elevation);
    const elevation = Number.isFinite(elevationValue) ? elevationValue : 0;
    const rotationValue = Number(actor.rotation);
    const rotationDegrees = Number.isFinite(rotationValue)
      ? ((rotationValue % 360) + 360) % 360
      : 0;

    entry.wrapper.visible = visible;
    entry.wrapper.position.set(actor.x ?? 0, elevation, actor.z ?? 0);
    entry.onCharacterStage = Boolean(actor.onCharacterStage);
    if (entry.onCharacterStage) {
      const modelBounds =
        entry.model?.userData?.normalizedBounds ||
        this.getCharacterModelBounds(entry.characterId || actor.characterId);
      const maxWorldScale = getMaxActorWorldScaleForCharacterStage(
        modelBounds,
        this.characterStageState,
        this.boxHalfExtent,
        this._boxHalfDepth
      );
      if (Number.isFinite(maxWorldScale) && maxWorldScale > 0) {
        scale = Math.min(scale, maxWorldScale);
      }
    }
    entry.wrapper.scale.setScalar(scale);
    entry.wrapper.rotation.y = (rotationDegrees * Math.PI) / 180;
    entry.rotation = rotationDegrees;
    entry.elevation = elevation;
    entry.hover = actor.hover === true;
    entry.hoverAmplitude = Number(actor.hoverAmplitude) || 0.06;
    if (entry.model) {
      entry.model.rotation.y = 0;
    }
    if (entry.selectionRing) {
      entry.selectionRing.visible =
        !entry.onCharacterStage && this.selectedActorIds.has(entry.id);
    }

    if (entry.contactShadow) {
      // Soft blob under stage characters reads as another "circle" — hide it;
      // the booth floor + lighting already ground the model.
      if (entry.onCharacterStage) {
        entry.contactShadow.visible = false;
      } else {
        entry.contactShadow.visible = visible;
        entry.contactShadow.position.set(actor.x ?? 0, 0.006, actor.z ?? 0);
        updateContactShadow(entry.contactShadow, {
          strength: this.fxState.enabled ? this.fxState.contactShadowStrength : 0,
          elevation,
          footprint: scale * 0.9,
        });
      }
    }
  }

  /** Fast path when the model is already loaded — no await. */
  setActorTransform(actor) {
    if (!actor?.id) return false;
    const entry = this.actors.get(actor.id);
    if (!entry?.model) return false;
    this.applyActorTransform(entry, actor);
    return true;
  }

  async ensureActor(actor, syncToken) {
    let entry = this.actors.get(actor.id);
    if (!entry) {
      const wrapper = new THREE.Group();
      wrapper.name = `actor-${actor.id}`;
      const selectionRing = this.createSelectionRing();
      wrapper.add(selectionRing);
      this.actorRoot.add(wrapper);
      // Kept outside the wrapper so a floating actor's shadow stays on the box.
      const contactShadow = createContactShadow();
      this.groundFxRoot.add(contactShadow);
      entry = {
        id: actor.id,
        characterId: actor.characterId || actor.id,
        wrapper,
        selectionRing,
        contactShadow,
        model: null,
        mixer: null,
        characterFx: null,
        elevation: 0,
        onCharacterStage: false,
        rotation: 0,
        hover: false,
        hoverAmplitude: 0.06,
        hoverPhase: Math.random() * Math.PI * 2,
        source: null,
        loading: null,
      };
      this.actors.set(actor.id, entry);
    } else {
      entry.characterId = actor.characterId || entry.characterId || actor.id;
      if (!entry.selectionRing) {
        entry.selectionRing = this.createSelectionRing();
        entry.wrapper.add(entry.selectionRing);
      }
    }
    if (entry.selectionRing) {
      entry.selectionRing.visible =
        !entry.onCharacterStage && this.selectedActorIds.has(actor.id);
    }

    // Already-loaded demons keep the old (broken) eye kit across hot reloads.
    // Re-stamp void-black when the kit version changes so eyes update in place.
    if (
      entry.model &&
      !entry.loading &&
      actor.look === "void-black" &&
      entry.model.userData.lookKitVersion !== "void-eyes-v5-gothic"
    ) {
      entry.characterFx?.dispose?.();
      entry.characterFx = combineCharacterFx([
        applyCharacterLook(entry.model, actor.look, {
          faceForward: actor.faceForward ?? null,
        }),
        actor.fx ? attachCharacterFx(entry.model, actor.fx) : null,
      ]);
    }

    if (!entry.model && !entry.loading) {
      const tokenAtStart = syncToken;
      entry.loading = this.loadModelRoot(actor)
        .then((loaded) => {
          if (tokenAtStart !== this._syncToken) {
            loaded.characterFx?.dispose?.();
            this.disposeObject(loaded.root);
            entry.loading = null;
            return entry;
          }
          if (entry.model) {
            entry.wrapper.remove(entry.model);
            entry.characterFx?.dispose?.();
            this.disposeObject(entry.model);
          }
          entry.model = loaded.root;
          entry.mixer = loaded.mixer;
          entry.characterFx = loaded.characterFx || null;
          entry.source = loaded.source;
          entry.wrapper.add(loaded.root);
          entry.loading = null;
          return entry;
        })
        .catch((error) => {
          entry.loading = null;
          throw error;
        });
    }

    if (entry.loading) await entry.loading;
    if (syncToken !== this._syncToken) {
      return entry;
    }
    this.applyActorTransform(entry, actor);
    return entry;
  }

  async syncActors(actorStates) {
    const syncToken = ++this._syncToken;
    const list = Array.isArray(actorStates) ? actorStates : [];
    const keepIds = new Set(list.map((actor) => actor.id));

    for (const [id, entry] of this.actors) {
      if (!keepIds.has(id)) {
        this.actorRoot.remove(entry.wrapper);
        entry.characterFx?.dispose?.();
        if (entry.model) this.disposeObject(entry.model);
        if (entry.selectionRing) {
          entry.selectionRing.geometry?.dispose?.();
          entry.selectionRing.material?.dispose?.();
        }
        if (entry.contactShadow) {
          this.groundFxRoot.remove(entry.contactShadow);
          entry.contactShadow.geometry?.dispose?.();
          entry.contactShadow.material?.dispose?.();
        }
        this.actors.delete(id);
      }
    }

    const results = [];
    for (const actor of list) {
      try {
        const entry = await this.ensureActor(actor, syncToken);
        if (syncToken !== this._syncToken) {
          results.push({ id: actor.id, ok: true, stale: true });
          continue;
        }
        results.push({
          id: actor.id,
          ok: true,
          source: entry.source,
          enabled: actor.enabled,
        });
      } catch (error) {
        results.push({ id: actor.id, ok: false, error: error.message });
      }
    }
    return results;
  }

  async applySceneState(state) {
    if (!state) return;
    if (state.mode) this.setMode(state.mode);
    if (typeof state.testBackdrop === "boolean") {
      this.setTestBackdrop(state.testBackdrop);
    }
    if (typeof state.showBoxGuide === "boolean") {
      this.setShowBoxGuide(state.showBoxGuide);
    }
    if (typeof state.calibrationGrid === "boolean") {
      this.setCalibrationGrid(state.calibrationGrid);
    }
    if (state.projector?.corners) {
      this.setProjectorCorners(state.projector.corners);
    }
    // Await map texture so Stage/Align never announce ready on a stale PNG.
    if (state.battleMap) {
      await this.setBattleMap(state.battleMap);
    }
    if (state.venue) {
      this.setVenueState(state.venue);
    }
    if (state.stageFx) {
      this.setStageFx(state.stageFx);
    }
    if (state.characterStage) {
      this.setCharacterStage(state.characterStage);
    }
  }

  /**
   * Render the scene from one camera into the warp blit target.
   * Scene-level FX (rim, shadows, atmosphere, particles) apply here. Bloom and
   * colour grade run only on the direct preview path — sampling a composer
   * buffer through the warp material goes black on several GL stacks.
   *
   * @param {object} [options]
   * @param {number} [options.clearAlpha=1] — use 0 for additive layer passes
   *   (3D stage over map) so empty pixels don't stamp black over the map.
   * @param {boolean} [options.preserveLayerVisibility=false] — when true, do
   *   not force the battle-map plane visible (needed for stage-only RT passes).
   */
  renderSceneToTexture(camera, options = {}) {
    const clearAlpha =
      typeof options.clearAlpha === "number" ? options.clearAlpha : 1;
    const preserveLayerVisibility = Boolean(options.preserveLayerVisibility);
    const transparentLayer = clearAlpha < 0.999;

    // Never bake the rig diagram into a projector face pass.
    const helpersWereVisible = Boolean(this.venueHelperRoot?.visible);
    const previzWasVisible = Boolean(this.projectorPrevizRoot?.visible);
    this.setVenueHelpersVisible(false);
    if (this.projectorPrevizRoot) this.projectorPrevizRoot.visible = false;

    // Shadow catcher can bake a solid black slab into the feed.
    const shadowWasVisible = Boolean(this.shadowCatcher?.visible);
    if (this.shadowCatcher) this.shadowCatcher.visible = false;
    const edgeWasVisible = Boolean(this.boxEdge?.visible);
    if (this.boxEdge) this.boxEdge.visible = false;

    // Keep the play surface on the face plane for a tight fill — but only when
    // this pass is supposed to show the map. Forcing it on here used to bake
    // the PNG into the TL2 stage pass, so TL1/TL2 always moved together.
    const boxPreviousY = this.boxSurface.position.y;
    const boxWasVisible = this.boxSurface.visible;
    this.boxSurface.position.y = 0;
    if (!preserveLayerVisibility) {
      this.boxSurface.visible = true;
    }

    // Scene.background is an opaque full-frame fill. For stage-over-map passes
    // it must be cleared or TL2 becomes a black/grey slab over the map.
    const previousBackground = this.scene.background;
    if (transparentLayer) {
      this.scene.background = null;
    }

    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.setClearColor(
      this.testBackdrop && !transparentLayer ? 0x141820 : 0x000000,
      clearAlpha
    );
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, camera);
    this.renderer.setRenderTarget(null);

    this.scene.background = previousBackground;
    this.boxSurface.position.y = boxPreviousY;
    this.boxSurface.visible = boxWasVisible;
    if (this.shadowCatcher) this.shadowCatcher.visible = shadowWasVisible;
    if (this.boxEdge) this.boxEdge.visible = edgeWasVisible;
    this.setVenueHelpersVisible(helpersWereVisible);
    if (this.projectorPrevizRoot) {
      this.projectorPrevizRoot.visible = previzWasVisible;
    }
    return this.sceneTarget.texture;
  }

  /**
   * TouchDesigner-style previz: render from the active projector and project
   * that image onto the box faces in the 3D orbit view.
   */
  updateProjectorPreviz() {
    if (this.useProjectorWarp || !this.projectorPrevizRoot) return;
    if (!this.venueState?.enabled || !this.shouldShowVenueHelpers()) {
      this.projectorPrevizRoot.visible = false;
      return;
    }

    const projector = getProjectorById(
      this.venueState,
      this.venueState.activeProjectorId
    );
    if (!projector?.enabled) {
      this.projectorPrevizRoot.visible = false;
      return;
    }

    const faceKey = `${projector.id}|${(projector.faceIds || []).join(",")}|${JSON.stringify(this.venueState.box)}`;
    if (faceKey !== this._previzFaceKey) {
      rebuildProjectorPrevizFaces(
        this.projectorPrevizRoot,
        this.boxFaces,
        projector.faceIds,
        this.sceneTarget.texture
      );
      this._previzFaceKey = faceKey;
    }

    computeEyePosition(projector.viewer, this.venueState.box, this._eyePosition);
    this._lookTarget.set(0, 0.25, 0);
    const aspect =
      this.sceneTarget.width / Math.max(1, this.sceneTarget.height);
    configureProjectorCamera(
      this.projectorCamera,
      this._eyePosition,
      this._lookTarget,
      {
        fov: projector.fovDegrees ?? 40,
        aspect,
      }
    );

    const helpersWereVisible = Boolean(this.venueHelperRoot?.visible);
    if (this.projectorPrevizRoot) this.projectorPrevizRoot.visible = false;
    this.setVenueHelpersVisible(false);
    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.setClearColor(this.testBackdrop ? 0x141820 : 0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, this.projectorCamera);
    this.renderer.setRenderTarget(null);
    this.setVenueHelpersVisible(helpersWereVisible);

    updateProjectorPrevizOverlay(
      this.projectorPrevizRoot,
      this.projectorCamera,
      this.sceneTarget.texture
    );
  }

  /** Preview / non-warp path — draw straight to the canvas. */
  renderDirect(delta) {
    // Never show the projective "mirror" overlay on home / 3D previz — frustum
    // helpers are enough for aiming; the duplicate on the box looked wrong.
    if (this.projectorPrevizRoot) this.projectorPrevizRoot.visible = false;
    this.setVenueHelpersVisible(this.shouldShowVenueHelpers());
    this.renderer.setRenderTarget(null);
    this.renderer.setScissorTest(false);
    this.renderer.autoClear = true;
    this.renderer.setClearColor(this.testBackdrop ? 0x141820 : 0x000000, 1);
    if (this.fxState.enabled) {
      this.postProcessing.setCamera(this.camera);
      this.syncPostProcessingToBattleMap();
      this.postProcessing.render(delta, { toScreen: true });
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Project the battle-map top plane into 0–1 image UVs (y down).
   * The far edge (−Z) is the seam where the 3D booth meets the map — used to
   * stop BL2/BR2 from dragging the booth onto the PNG.
   */
  projectMapPlaneToContentCorners(camera = null) {
    const activeCamera = camera || this.faceOrthoCamera;
    const halfWidth = Math.max(0.05, this.boxHalfExtent || 1.2);
    const halfDepth = Math.max(0.05, this._boxHalfDepth || 1.2);
    const floorY = 0.01;
    const worldCorners = {
      // Image-top is world −Z with the top-down ortho.
      topLeft: { x: -halfWidth, y: floorY, z: -halfDepth },
      topRight: { x: halfWidth, y: floorY, z: -halfDepth },
      bottomRight: { x: halfWidth, y: floorY, z: halfDepth },
      bottomLeft: { x: -halfWidth, y: floorY, z: halfDepth },
    };

    const toImageUv = (point) => {
      this._worldToScreen.set(point.x, point.y, point.z);
      this._worldToScreen.project(activeCamera);
      return {
        x: THREE.MathUtils.clamp((this._worldToScreen.x + 1) * 0.5, -0.35, 1.35),
        y: THREE.MathUtils.clamp((1 - this._worldToScreen.y) * 0.5, -0.35, 1.35),
      };
    };

    const corners = {
      topLeft: toImageUv(worldCorners.topLeft),
      topRight: toImageUv(worldCorners.topRight),
      bottomRight: toImageUv(worldCorners.bottomRight),
      bottomLeft: toImageUv(worldCorners.bottomLeft),
    };
    return areFaceCornersUsable(corners)
      ? corners
      : createDefaultFaceCorners("top");
  }

  /**
   * Project the 3D stage volume into 0–1 image UVs (y down) for a camera.
   * Uses floor + roof corners so perspective views still cover the full booth.
   */
  projectCharacterStageToContentCorners(camera = null, options = {}) {
    const pose = getCharacterStageWorldPose(
      this.characterStageState,
      this.boxHalfExtent,
      this._boxHalfDepth
    );
    if (!pose.enabled) {
      return {
        topLeft: { x: 0.32, y: 0.02 },
        topRight: { x: 0.68, y: 0.02 },
        bottomRight: { x: 0.68, y: 0.28 },
        bottomLeft: { x: 0.32, y: 0.28 },
      };
    }

    const activeCamera = camera || this.faceOrthoCamera;
    const pad = Number(options.padding) || 1.06;
    const half = pose.halfSize * pad;
    const floorY = pose.centerY + 0.02;
    const roofY = pose.centerY + Math.max(0.4, pose.height || 1.15) * pad;
    const xz = [
      [pose.centerX - half, pose.centerZ - half],
      [pose.centerX + half, pose.centerZ - half],
      [pose.centerX + half, pose.centerZ + half],
      [pose.centerX - half, pose.centerZ + half],
    ];

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [worldX, worldZ] of xz) {
      for (const worldY of [floorY, roofY]) {
        this._worldToScreen.set(worldX, worldY, worldZ);
        this._worldToScreen.project(activeCamera);
        const imageU = (this._worldToScreen.x + 1) * 0.5;
        const imageV = (1 - this._worldToScreen.y) * 0.5;
        if (!Number.isFinite(imageU) || !Number.isFinite(imageV)) continue;
        minU = Math.min(minU, imageU);
        maxU = Math.max(maxU, imageU);
        minV = Math.min(minV, imageV);
        maxV = Math.max(maxV, imageV);
      }
    }

    if (!(maxU > minU) || !(maxV > minV)) {
      return {
        topLeft: { x: 0.32, y: 0.02 },
        topRight: { x: 0.68, y: 0.02 },
        bottomRight: { x: 0.68, y: 0.28 },
        bottomLeft: { x: 0.32, y: 0.28 },
      };
    }

    const clampAxis = (value) =>
      THREE.MathUtils.clamp(value, -0.35, 1.35);
    const corners = {
      topLeft: { x: clampAxis(minU), y: clampAxis(minV) },
      topRight: { x: clampAxis(maxU), y: clampAxis(minV) },
      bottomRight: { x: clampAxis(maxU), y: clampAxis(maxV) },
      bottomLeft: { x: clampAxis(minU), y: clampAxis(maxV) },
    };
    if (areFaceCornersUsable(corners) && !isFullFrameCorners(corners)) {
      return corners;
    }
    return {
      topLeft: { x: 0.32, y: 0.02 },
      topRight: { x: 0.68, y: 0.02 },
      bottomRight: { x: 0.68, y: 0.28 },
      bottomLeft: { x: 0.32, y: 0.28 },
    };
  }

  /**
   * Snapshot TL2 content corners around the booth using a cover-fit camera that
   * includes both the map and the booth — call before the user starts dragging TL2.
   */
  /**
   * Snapshot TL2 content corners around the booth in the *current* stage view
   * (top or 3D) so the first grab does not jump to a flat top-down window.
   */
  captureCharacterStageContentCorners() {
    const boxExtents = getBoxExtents(
      this.venueState?.box || { widthCm: 120, depthCm: 120, heightCm: 60 }
    );
    const aspect =
      this.sceneTarget.width / Math.max(1, this.sceneTarget.height);
    const stagePose = getCharacterStageWorldPose(
      this.characterStageState,
      this.boxHalfExtent,
      this._boxHalfDepth
    );

    let camera = this.camera;
    if (this.stageViewMode === "top") {
      if (stagePose.enabled !== false) {
        configureTopDownMapAndStageCamera(
          this.faceOrthoCamera,
          boxExtents,
          stagePose,
          { padding: 1.02, aspect }
        );
      } else {
        configureTopDownMapCamera(this.faceOrthoCamera, boxExtents, {
          padding: 1.0,
          aspect,
        });
      }
      camera = this.faceOrthoCamera;
    } else {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }

    return this.projectCharacterStageToContentCorners(camera, {
      padding: 1.06,
    });
  }

  /** Map-plane UV snapshot with the same framing as captureCharacterStageContentCorners. */
  captureMapPlaneContentCorners() {
    const boxExtents = getBoxExtents(
      this.venueState?.box || { widthCm: 120, depthCm: 120, heightCm: 60 }
    );
    const aspect =
      this.sceneTarget.width / Math.max(1, this.sceneTarget.height);
    const stagePose = getCharacterStageWorldPose(
      this.characterStageState,
      this.boxHalfExtent,
      this._boxHalfDepth
    );

    let camera = this.camera;
    if (this.stageViewMode === "top") {
      if (stagePose.enabled !== false) {
        configureTopDownMapAndStageCamera(
          this.faceOrthoCamera,
          boxExtents,
          stagePose,
          { padding: 1.02, aspect }
        );
      } else {
        configureTopDownMapCamera(this.faceOrthoCamera, boxExtents, {
          padding: 1.0,
          aspect,
        });
      }
      camera = this.faceOrthoCamera;
    } else {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    return this.projectMapPlaneToContentCorners(camera);
  }

  /**
   * Show only the battle-map layer, only the 3D stage booth, or everything.
   * Used to keystone map (TL1…) and stage (TL2…) as separate projector quads.
   * `actorBaseVisibility` preserves enabled/disabled from the last sync.
   */
  applyContentLayerVisibility(layer = "all", actorBaseVisibility = null) {
    const showMap = layer === "all" || layer === "map";
    const showStage = layer === "all" || layer === "stage";
    const stageEnabled = this.characterStageState?.enabled !== false;

    if (this.boxSurface) this.boxSurface.visible = showMap;
    if (this.shadowCatcher) {
      this.shadowCatcher.visible =
        showMap && Boolean(this.fxState?.enabled && this.fxState?.shadowsEnabled);
    }
    if (this.boxEdge) this.boxEdge.visible = showMap && this.showBoxGuide;
    if (this.gridHelper) {
      this.gridHelper.visible = showMap && this.calibrationGrid;
    }
    if (this.characterStageRoot) {
      this.characterStageRoot.visible = showStage && stageEnabled;
    }
    for (const [actorId, entry] of this.actors) {
      if (!entry.wrapper) continue;
      const baseVisible = actorBaseVisibility?.has(actorId)
        ? actorBaseVisibility.get(actorId)
        : entry.wrapper.visible;
      if (entry.onCharacterStage) {
        entry.wrapper.visible = showStage && stageEnabled && baseVisible;
        if (entry.contactShadow) entry.contactShadow.visible = false;
      } else {
        entry.wrapper.visible = showMap && baseVisible;
        if (entry.contactShadow) {
          entry.contactShadow.visible =
            showMap &&
            baseVisible &&
            Boolean(this.fxState?.enabled && this.fxState?.contactShadowStrength);
        }
      }
    }
  }

  /**
   * Draw map and/or 3D stage into the projector warp.
   *
   * - Default: one pass (map + booth together) — booth seated on the map far edge.
   * - TL1: map → TL1 nest; booth rides the same map homography (revolves with
   *   TL1/TR1/BL1/BR1), including when TL2 has its own keystone window.
   * - TL2: each booth corner (TL2/TR2/BL2/BR2) keystones independently, then
   *   that window is projected through the TL1 map warp when map is custom.
   */
  drawVenueContentWarp({
    renderCamera,
    globalCorners: _unusedWholeCorners,
    fullFrameCorners,
    boxExtents,
    aspect,
    facesDrawn,
  }) {
    const projector = getProjectorById(
      this.venueState,
      this.venueState.activeProjectorId
    );
    const content = projector?.contentCorners || createDefaultContentCorners();
    const mapCornersRaw = areFaceCornersUsable(content.battleMap)
      ? content.battleMap
      : fullFrameCorners;
    const stageCorners = areFaceCornersUsable(content.characterStage)
      ? content.characterStage
      : fullFrameCorners;
    // Whole-projection TL/TR/BR/BL is unused — TL1/TL2 own the throw.
    const global = fullFrameCorners;

    const stageEnabled = this.characterStageState?.enabled !== false;
    const stagePose = getCharacterStageWorldPose(
      this.characterStageState,
      this.boxHalfExtent,
      this._boxHalfDepth
    );
    const mapCustom = !isFullFrameCorners(mapCornersRaw);
    const stageCustom = !isFullFrameCorners(stageCorners);
    // Only treat TL2 as an independent window once it is a real small quad.
    // Half-dragged full-frame TL2 must not steal the booth into a smear.
    const userStageWindow =
      stageEnabled && stageCustom && faceCornersArea(stageCorners) < 0.32;
    const splitContent = mapCustom || userStageWindow;

    const actorBaseVisibility = new Map();
    for (const [actorId, entry] of this.actors) {
      actorBaseVisibility.set(actorId, Boolean(entry.wrapper?.visible));
    }

    let drawn = facesDrawn;

    const useTopFraming =
      this.stageViewMode === "top" || renderCamera === this.faceOrthoCamera;

    // Shared framing that includes map + booth (historic seated look).
    const configureSharedTopCamera = () => {
      if (!useTopFraming) return renderCamera;
      if (stageEnabled) {
        configureTopDownMapAndStageCamera(
          this.faceOrthoCamera,
          boxExtents,
          stagePose,
          { padding: 1.02, aspect }
        );
      } else {
        configureTopDownMapCamera(this.faceOrthoCamera, boxExtents, {
          padding: 1.0,
          aspect,
        });
      }
      return this.faceOrthoCamera;
    };

    if (!splitContent) {
      this.applyContentLayerVisibility("all", actorBaseVisibility);
      const texture = this.renderSceneToTexture(configureSharedTopCamera());
      if (drawn === 0) {
        this.projectorWarp.drawFace(this.renderer, texture, global);
      } else {
        this.projectorWarp.drawFaceAdditive(this.renderer, texture, global);
      }
      return drawn + 1;
    }

    const sharedCamera = configureSharedTopCamera();
    const mapPlaneUv = this.projectMapPlaneToContentCorners(sharedCamera);
    const mapCorners = mapCustom
      ? constrainMapKeystoneWindow(mapCornersRaw, mapPlaneUv)
      : mapCornersRaw;

    // Pass A — battle map only.
    // TL1: crop map-plane UV → TL1 so one corner pin is independent.
    // TL2-only (map still full-frame): do NOT crop map-plane → full throw —
    // that zoomed the map top-down and dropped the booth onto the PNG.
    this.applyContentLayerVisibility("map", actorBaseVisibility);
    const mapTexture = this.renderSceneToTexture(sharedCamera, {
      preserveLayerVisibility: true,
    });
    const mapDest = composeCornerQuad(global, mapCorners);
    const mapSourceUv = mapCustom ? mapPlaneUv : null;
    if (drawn === 0) {
      this.projectorWarp.drawFace(
        this.renderer,
        mapTexture,
        mapDest,
        mapSourceUv
      );
    } else {
      this.projectorWarp.drawFaceAdditive(
        this.renderer,
        mapTexture,
        mapDest,
        mapSourceUv
      );
    }
    drawn += 1;

    // Pass B — 3D stage only.
    // TL2 keystones the booth in map-plane UV space; when TL1 is active that
    // window is projected through the same map homography so the booth revolves
    // with TL1/TR1 (and BL1/BR1) instead of floating while the map stretches.
    if (stageEnabled) {
      this.applyContentLayerVisibility("stage", actorBaseVisibility);
      const stageCamera = configureSharedTopCamera();
      const stageTexture = this.renderSceneToTexture(stageCamera, {
        clearAlpha: 0,
        preserveLayerVisibility: true,
      });
      const boothSourceUv = this.projectCharacterStageToContentCorners(
        stageCamera,
        { padding: 1.06 }
      );

      let stageWindowCorners = boothSourceUv;
      if (userStageWindow) {
        const clampedStageCorners = constrainStageKeystoneWindow(
          stageCorners,
          boothSourceUv,
          mapPlaneUv
        );
        stageWindowCorners =
          faceCornersArea(clampedStageCorners) > 0.28
            ? boothSourceUv
            : clampedStageCorners;
      }

      let stageDestCorners = stageWindowCorners;
      if (mapCustom) {
        stageDestCorners = transformCornersThroughQuadHomography(
          mapPlaneUv,
          mapCorners,
          stageWindowCorners
        );
      }

      const stageDest = composeCornerQuad(global, stageDestCorners);
      const mapFootprint = mapCustom
        ? mapDest
        : composeCornerQuad(global, mapPlaneUv);
      // Clip only when the user has a TL2 window — attached-to-TL1 seating
      // needs the booth feet on the map seam, so do not discard that overlap.
      this.projectorWarp.drawFaceAdditive(
        this.renderer,
        stageTexture,
        stageDest,
        boothSourceUv,
        userStageWindow ? { mapClipCorners: mapFootprint } : undefined
      );
      drawn += 1;
    }

    this.applyContentLayerVisibility("all", actorBaseVisibility);
    return drawn;
  }

  /**
   * Venue projector output:
   *
   * - projector / mapping: fixed face-on picture of what is on the box.
   *   Moving the lamp in 3D only moves the FOV frustum — not the picture.
   *   TL/TR/BR/BL keystone then pins that picture to the real projected corners.
   * - anamorphic: optional sweet-spot mode where the eye pose *does* drive the view.
   */
  renderVenueFaces() {
    const projector = getProjectorById(
      this.venueState,
      this.venueState.activeProjectorId
    );
    if (!projector) return false;

    computeEyePosition(projector.viewer, this.venueState.box, this._eyePosition);
    this._lookTarget.set(0, 0.25, 0);
    this.updateVenueLighting();
    this.projectorWarp.clearOutput(this.renderer);

    const mode = projector.projectionMode || "projector";
    // Only anamorphic follows the lamp eye. Projector/mapping keep a stable
    // face fill so keystone can match the physical throw without the picture
    // sliding whenever you drag the camera in 3D.
    const useAnamorphic = mode === "anamorphic";
    const elevationBoost = useAnamorphic ? 0.28 : 0.12;
    const elevationRestore = [];
    for (const entry of this.actors.values()) {
      if (!entry.wrapper?.visible) continue;
      // Booth characters stay glued to the stage floor — the map-token lift
      // is what made them float mid-cube in 3D / side views.
      if (entry.onCharacterStage) continue;
      elevationRestore.push([entry.wrapper, entry.wrapper.position.y]);
      entry.wrapper.position.y += elevationBoost;
      if (entry.contactShadow) {
        updateContactShadow(entry.contactShadow, {
          strength: this.fxState.enabled ? this.fxState.contactShadowStrength : 0,
          elevation: (entry.elevation || 0) + elevationBoost,
        });
      }
    }

    const boxWasVisible = this.boxSurface.visible;
    if (!boxWasVisible) this.boxSurface.visible = true;

    let facesDrawn = 0;
    const aspect =
      this.sceneTarget.width / Math.max(1, this.sceneTarget.height);
    const focusFaceId = this.focusCalibrationFace
      ? this.venueState.calibrationFaceId
      : null;
    // Map+keystone must draw the play surface (top), never a side face — a
    // side-face fill shows the map as a thin edge strip at the top of a black
    // frame, which is exactly the broken projector feed we keep hitting.
    let facesToDraw;
    if (useAnamorphic) {
      facesToDraw =
        focusFaceId && projector.faceIds.includes(focusFaceId)
          ? [focusFaceId]
          : projector.faceIds;
    } else if (
      focusFaceId &&
      projector.faceIds.includes(focusFaceId) &&
      focusFaceId === "top"
    ) {
      facesToDraw = ["top"];
    } else if (projector.faceIds.includes("top")) {
      facesToDraw = ["top"];
    } else {
      facesToDraw = [projector.faceIds[0] || "top"];
    }
    const fullFrameCorners = createDefaultFaceCorners("top");
    const boxExtents = getBoxExtents(
      this.venueState?.box || { widthCm: 120, depthCm: 120, heightCm: 60 }
    );

    try {
      for (const faceId of facesToDraw) {
        const face = this.boxFaces[faceId];
        const corners = projector.faceCorners[faceId];
        if (!face || !corners) continue;

        let renderCamera = this.offAxisCamera;
        let configured = false;
        if (useAnamorphic) {
          configured = configureOffAxisCamera(
            this.offAxisCamera,
            face,
            this._eyePosition
          );
          renderCamera = this.offAxisCamera;
        } else if (faceId === "top" && this.stageViewMode !== "top") {
          // Orbitable perspective — right-drag tilts so monsters read in 3D.
          // Corners still keystone this picture onto the physical surface.
          this.camera.aspect =
            this.sceneTarget.width / Math.max(1, this.sceneTarget.height);
          this.camera.updateProjectionMatrix();
          renderCamera = this.camera;
          configured = true;
        } else if (faceId === "top") {
          // Overhead ortho cover-fit — map fills the throw (no letterbox bars).
          configured = configureTopDownMapCamera(
            this.faceOrthoCamera,
            boxExtents,
            { padding: 1.0, aspect }
          );
          renderCamera = this.faceOrthoCamera;
        } else {
          configured = configureFaceOrthoCamera(this.faceOrthoCamera, face, {
            padding: 1.001,
          });
          renderCamera = this.faceOrthoCamera;
          if (!configured) {
            configured = configureFaceMappedCamera(this.offAxisCamera, face, {
              aspect,
            });
            renderCamera = this.offAxisCamera;
          }
        }
        if (!configured) continue;

        // Prefer the live dragged corners whenever the quad is still drawable.
        // Falling back to full-frame mid-drag made handles look like they "vanished".
        const warpCorners = areFaceCornersUsable(corners)
          ? corners
          : fullFrameCorners;
        facesDrawn = this.drawVenueContentWarp({
          renderCamera,
          globalCorners: warpCorners,
          fullFrameCorners,
          boxExtents,
          aspect,
          facesDrawn,
        });
      }

      if (facesDrawn === 0) {
        const fallbackFace = this.boxFaces.top || this.boxFaces[facesToDraw[0]];
        const fallbackCorners =
          projector.faceCorners.top ||
          projector.faceCorners[facesToDraw[0]] ||
          fullFrameCorners;
        if (fallbackFace && fallbackCorners) {
          if (useAnamorphic) {
            const safeEye = this._eyePosition.clone();
            if (safeEye.y < 1.5) safeEye.y = 3.5;
            if (
              configureOffAxisCamera(this.offAxisCamera, fallbackFace, safeEye)
            ) {
              const texture = this.renderSceneToTexture(this.offAxisCamera);
              this.projectorWarp.drawFace(
                this.renderer,
                texture,
        areFaceCornersHealthy(fallbackCorners)
                ? fallbackCorners
                : fullFrameCorners
              );
              facesDrawn = 1;
            }
          } else if (this.stageViewMode !== "top") {
            this.camera.aspect =
              this.sceneTarget.width / Math.max(1, this.sceneTarget.height);
            this.camera.updateProjectionMatrix();
            const texture = this.renderSceneToTexture(this.camera);
            this.projectorWarp.drawFace(
              this.renderer,
              texture,
              areFaceCornersUsable(fallbackCorners)
                ? fallbackCorners
                : fullFrameCorners
            );
            facesDrawn = 1;
          } else if (
            configureTopDownMapCamera(this.faceOrthoCamera, boxExtents, {
              padding: 1.0,
              aspect,
            })
          ) {
            const texture = this.renderSceneToTexture(this.faceOrthoCamera);
            this.projectorWarp.drawFace(
              this.renderer,
              texture,
              areFaceCornersUsable(fallbackCorners)
                ? fallbackCorners
                : fullFrameCorners
            );
            facesDrawn = 1;
          }
        }
      }
    } finally {
      for (const [wrapper, previousY] of elevationRestore) {
        wrapper.position.y = previousY;
      }
      this.applyContentLayerVisibility("all");
      for (const entry of this.actors.values()) {
        if (entry.contactShadow && !entry.onCharacterStage) {
          updateContactShadow(entry.contactShadow, {
            strength: this.fxState.enabled
              ? this.fxState.contactShadowStrength
              : 0,
            elevation: entry.elevation || 0,
          });
        }
      }
      this.refreshBoxSurfaceVisibility();
      if (this.characterStageRoot) {
        this.characterStageRoot.visible =
          this.characterStageState?.enabled !== false;
      }
    }

    if (this.venueState.showFaceOutlines) {
      const outlineFaceIds =
        this.focusCalibrationFace && this.venueState.calibrationFaceId
          ? [this.venueState.calibrationFaceId]
          : projector.faceIds;
      for (const faceId of outlineFaceIds) {
        if (!projector.faceIds.includes(faceId)) continue;
        const corners = projector.faceCorners[faceId];
        if (corners) this.projectorWarp.drawFaceOutline(this.renderer, corners);
      }
    }

    return facesDrawn > 0;
  }

  animate = () => {
    this._raf = requestAnimationFrame(this.animate);
    if (this._contextLost) return;

    const delta = this.clock.getDelta();
    const elapsed = this.clock.elapsedTime;
    this.orbitControls?.update();
    tickBattleMap(this.boxSurface, elapsed, {
      venueLive: this.venueState?.enabled,
      baseIntensity: this.battleMapState?.intensity,
    });
    tickCharacterStageVisual(this.characterStageRoot, elapsed);

    for (const entry of this.actors.values()) {
      if (entry.mixer) entry.mixer.update(delta);
      entry.characterFx?.update?.(elapsed);
      if (entry.hover && entry.wrapper.visible) {
        const amplitude =
          entry.hoverAmplitude *
          (entry.onCharacterStage
            ? Math.max(0.35, entry.wrapper.scale.x * 0.2)
            : 1);
        const bob =
          Math.sin(elapsed * 1.1 + entry.hoverPhase) * amplitude;
        entry.wrapper.position.y = entry.elevation + bob;
      } else if (entry.wrapper.visible) {
        entry.wrapper.position.y = entry.elevation;
      }
    }

    if (!this._frameSize) this._frameSize = new THREE.Vector2();
    this.renderer.getSize(this._frameSize);
    const width = this._frameSize.x || this.canvas.clientWidth || 1;
    const height = this._frameSize.y || this.canvas.clientHeight || 1;
    if (width < 2 || height < 2) return;

    updateAtmosphere(
      this.atmosphere,
      this.getEffectiveStageFxState(),
      elapsed,
      height * this.renderer.getPixelRatio()
    );

    try {
      if (this.mode === "ghost") {
        this.renderPepperGhost(width, height);
        return;
      }

      if (this.isVenueModeActive() && this.renderVenueFaces()) {
        return;
      }

      if (this.useProjectorWarp) {
        // Exact original warp path — render into the target, then blit the quad.
        this.setVenueHelpersVisible(false);
        this.renderer.setRenderTarget(this.sceneTarget);
        this.renderer.setClearColor(
          this.testBackdrop ? 0x141820 : 0x000000,
          1
        );
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(null);
        this.projectorWarp.clearOutput(this.renderer);
        this.projectorWarp.drawFace(
          this.renderer,
          this.sceneTarget.texture,
          this.corners
        );
        return;
      }

      this.renderDirect(delta);
    } catch (error) {
      console.warn("Render frame failed", error);
    }
  };

  renderPepperGhost(width, height) {
    const viewWidth = width / 2;
    const viewHeight = height / 2;
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.setScissorTest(true);

    const views = [
      { x: viewWidth / 2, y: height - viewHeight, rotY: 0 },
      { x: width - viewWidth, y: viewHeight / 2, rotY: Math.PI / 2 },
      { x: viewWidth / 2, y: 0, rotY: Math.PI },
      { x: 0, y: viewHeight / 2, rotY: -Math.PI / 2 },
    ];

    const baseRotations = [];
    for (const entry of this.actors.values()) {
      baseRotations.push([entry, entry.wrapper.rotation.y]);
    }

    for (const view of views) {
      for (const [entry, base] of baseRotations) {
        entry.wrapper.rotation.y = base + view.rotY;
      }
      this.renderer.setViewport(view.x, view.y, viewWidth, viewHeight);
      this.renderer.setScissor(view.x, view.y, viewWidth, viewHeight);
      this.renderer.render(this.scene, this.camera);
    }

    for (const [entry, base] of baseRotations) {
      entry.wrapper.rotation.y = base;
    }
    this.renderer.setScissorTest(false);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._onResize);
    this.resizeObserver?.disconnect();
    for (const entry of this.actors.values()) {
      entry.characterFx?.dispose?.();
      if (entry.model) this.disposeObject(entry.model);
    }
    this.sceneTarget.dispose();
    this.projectorWarp.dispose();
    this.postProcessing.dispose();
    disposeAtmosphere(this.atmosphere);
    disposeVenueFrustumHelpers(this.venueHelperRoot);
    disposeProjectorPrevizOverlay(this.projectorPrevizRoot);
    if (this.characterStageRoot) {
      this.scene.remove(this.characterStageRoot);
      disposeCharacterStageVisual(this.characterStageRoot);
      this.characterStageRoot = null;
    }
    this.orbitControls?.dispose();
    this.shadowCatcher.geometry.dispose();
    this.shadowCatcher.material.dispose();
    this.roomFloor?.geometry?.dispose?.();
    this.roomFloor?.material?.dispose?.();
    this.roomGrid?.geometry?.dispose?.();
    this.roomGrid?.material?.dispose?.();
    this.renderer.dispose();
  }
}
