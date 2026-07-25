import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createProceduralCharacter,
  hasProceduralCharacter,
} from "./proceduralCharacters.js";
import { clampProjectorCorners } from "./sceneState.js";

const loader = new GLTFLoader();

function cornerToNdc(corner) {
  return {
    x: corner.x * 2 - 1,
    y: -(corner.y * 2 - 1),
  };
}

export class StageRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.mode = options.mode || "single";
    this.testBackdrop = options.testBackdrop !== false;
    this.showBoxGuide = options.showBoxGuide !== false;
    this.calibrationGrid = Boolean(options.calibrationGrid);
    this.useProjectorWarp = options.useProjectorWarp !== false;
    this.actors = new Map();
    this.clock = new THREE.Clock();
    this._raf = 0;
    this._syncToken = 0;
    this._contextLost = false;
    this.raycaster = new THREE.Raycaster();
    this._pointerNdc = new THREE.Vector2();
    this._floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._floorHit = new THREE.Vector3();
    this.boxHalfExtent = 1.2;

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(
      this.testBackdrop ? 0x141820 : 0x000000
    );

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
    this.camera.position.set(0, 2.4, 4.2);
    this.camera.lookAt(0, 0.4, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 1.35);
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(2.5, 5, 3.5);
    const fill = new THREE.DirectionalLight(0xaaccff, 1.2);
    fill.position.set(-3, 2, -2);
    const front = new THREE.DirectionalLight(0xffffff, 1.4);
    front.position.set(0, 1.5, 4);
    this.scene.add(hemi, key, fill, front);

    this.boxSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshStandardMaterial({
        color: 0x2a3340,
        roughness: 1,
        metalness: 0,
        transparent: true,
        opacity: 0.55,
      })
    );
    this.boxSurface.rotation.x = -Math.PI / 2;
    this.scene.add(this.boxSurface);

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

    this.actorRoot = new THREE.Group();
    this.scene.add(this.actorRoot);

    this.sceneTarget = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.sceneTarget.texture.colorSpace = THREE.SRGBColorSpace;
    this.sceneTarget.texture.flipY = false;

    this.warpScene = new THREE.Scene();
    this.warpCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.warpGeometry = new THREE.BufferGeometry();
    this.warpGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(12), 3)
    );
    this.warpGeometry.setAttribute(
      "uv",
      new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2)
    );
    this.warpGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.warpMaterial = new THREE.MeshBasicMaterial({
      map: this.sceneTarget.texture,
      depthTest: false,
      depthWrite: false,
    });
    this.warpMesh = new THREE.Mesh(this.warpGeometry, this.warpMaterial);
    this.warpScene.add(this.warpMesh);
    this.updateWarpGeometry();

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
    this.animate();
  }

  updateWarpGeometry() {
    const topLeft = cornerToNdc(this.corners.topLeft);
    const topRight = cornerToNdc(this.corners.topRight);
    const bottomRight = cornerToNdc(this.corners.bottomRight);
    const bottomLeft = cornerToNdc(this.corners.bottomLeft);
    const positions = this.warpGeometry.attributes.position.array;
    positions[0] = topLeft.x;
    positions[1] = topLeft.y;
    positions[2] = 0;
    positions[3] = topRight.x;
    positions[4] = topRight.y;
    positions[5] = 0;
    positions[6] = bottomRight.x;
    positions[7] = bottomRight.y;
    positions[8] = 0;
    positions[9] = bottomLeft.x;
    positions[10] = bottomLeft.y;
    positions[11] = 0;
    this.warpGeometry.attributes.position.needsUpdate = true;
    this.warpGeometry.computeBoundingSphere();
  }

  setTestBackdrop(enabled) {
    this.testBackdrop = Boolean(enabled);
    const color = this.testBackdrop ? 0x141820 : 0x000000;
    this.scene.background = new THREE.Color(color);
    this.renderer.setClearColor(color, 1);
    this.boxSurface.material.opacity = this.testBackdrop ? 0.55 : 0.18;
  }

  setShowBoxGuide(enabled) {
    this.showBoxGuide = Boolean(enabled);
    this.boxSurface.visible = this.showBoxGuide || this.testBackdrop;
    this.boxEdge.visible = this.showBoxGuide;
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
    this.updateWarpGeometry();
  }

  setUseProjectorWarp(enabled) {
    this.useProjectorWarp = Boolean(enabled);
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
    const extent = this.boxHalfExtent;
    return {
      x: Math.min(extent, Math.max(-extent, this._floorHit.x)),
      z: Math.min(extent, Math.max(-extent, this._floorHit.z)),
      outside:
        Math.abs(this._floorHit.x) > extent + 0.001 ||
        Math.abs(this._floorHit.z) > extent + 0.001,
    };
  }

  /** True when the pointer is over a loaded actor mesh. */
  hitActor(clientX, clientY, actorId = null) {
    if (this.useProjectorWarp) return false;
    const ndc = this.getPointerNdc(clientX, clientY);
    if (!ndc) return false;
    this._pointerNdc.set(ndc.x, ndc.y);
    this.raycaster.setFromCamera(this._pointerNdc, this.camera);
    const roots = [];
    for (const entry of this.actors.values()) {
      if (!entry.wrapper.visible || !entry.model) continue;
      if (actorId && entry.id !== actorId) continue;
      roots.push(entry.wrapper);
    }
    if (!roots.length) return false;
    const hits = this.raycaster.intersectObjects(roots, true);
    return hits.length > 0;
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
    const pixelRatio = this.renderer.getPixelRatio();
    this.sceneTarget.setSize(
      Math.max(1, Math.floor(width * pixelRatio)),
      Math.max(1, Math.floor(height * pixelRatio))
    );
  }

  disposeObject(root) {
    root.traverse((object) => {
      if (object.isMesh) {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => material.dispose?.());
        } else {
          object.material?.dispose?.();
        }
      }
    });
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
    box.getCenter(center);
    root.position.x += -center.x;
    root.position.z += -center.z;
    root.position.y += -box.min.y;
  }

  prepareMaterials(root) {
    root.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (!material) continue;
        material.side = THREE.DoubleSide;
        if (material.map) {
          material.map.colorSpace = THREE.SRGBColorSpace;
          material.map.anisotropy = 8;
        }
        if (material.color) {
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
  }

  async loadModelRoot(actor) {
    if (actor.file) {
      try {
        const gltf = await loader.loadAsync(actor.file);
        const root = gltf.scene;
        this.prepareMaterials(root);
        this.normalizeModel(root, 1);
        let mixer = null;
        if (gltf.animations?.length) {
          mixer = new THREE.AnimationMixer(root);
          const clip =
            gltf.animations.find((item) =>
              /idle|stand|breath/i.test(item.name)
            ) || gltf.animations[0];
          mixer.clipAction(clip).play();
        }
        return { root, mixer, source: "file" };
      } catch (error) {
        console.warn(`GLB missing for ${actor.id}, using procedural.`, error);
      }
    }

    if (!hasProceduralCharacter(actor.id)) {
      throw new Error(`No model for ${actor.id}`);
    }
    const root = createProceduralCharacter(actor.id);
    this.prepareMaterials(root);
    this.normalizeModel(root, 1);
    return { root, mixer: null, source: "procedural" };
  }

  applyActorTransform(entry, actor) {
    entry.wrapper.visible = Boolean(actor.enabled);
    entry.wrapper.position.set(actor.x ?? 0, 0, actor.z ?? 0);
    const scale = Number(actor.scale);
    entry.wrapper.scale.setScalar(
      Number.isFinite(scale) && scale > 0 ? scale : 1
    );
    entry.spin = actor.spin !== false;
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
      this.actorRoot.add(wrapper);
      entry = {
        id: actor.id,
        wrapper,
        model: null,
        mixer: null,
        spin: true,
        source: null,
        loading: null,
      };
      this.actors.set(actor.id, entry);
    }

    if (!entry.model && !entry.loading) {
      const tokenAtStart = syncToken;
      entry.loading = this.loadModelRoot(actor)
        .then((loaded) => {
          if (tokenAtStart !== this._syncToken) {
            this.disposeObject(loaded.root);
            entry.loading = null;
            return entry;
          }
          if (entry.model) {
            entry.wrapper.remove(entry.model);
            this.disposeObject(entry.model);
          }
          entry.model = loaded.root;
          entry.mixer = loaded.mixer;
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
        if (entry.model) this.disposeObject(entry.model);
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

  applySceneState(state) {
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
  }

  animate = () => {
    this._raf = requestAnimationFrame(this.animate);
    if (this._contextLost) return;

    const delta = this.clock.getDelta();
    for (const entry of this.actors.values()) {
      if (entry.mixer) entry.mixer.update(delta);
      if (entry.spin && entry.wrapper.visible && entry.model) {
        entry.model.rotation.y += delta * 0.45;
      }
    }

    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const width = size.x || this.canvas.clientWidth || 1;
    const height = size.y || this.canvas.clientHeight || 1;
    if (width < 2 || height < 2) return;

    try {
      if (this.mode === "ghost") {
        this.renderPepperGhost(width, height);
        return;
      }

      if (this.useProjectorWarp) {
        this.renderer.setRenderTarget(this.sceneTarget);
        this.renderer.setClearColor(
          this.testBackdrop ? 0x141820 : 0x000000,
          1
        );
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(null);
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.clear();
        this.renderer.render(this.warpScene, this.warpCamera);
      } else {
        this.renderer.setViewport(0, 0, width, height);
        this.renderer.setScissorTest(false);
        this.renderer.setClearColor(
          this.testBackdrop ? 0x141820 : 0x000000,
          1
        );
        this.renderer.render(this.scene, this.camera);
      }
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
      if (entry.model) this.disposeObject(entry.model);
    }
    this.sceneTarget.dispose();
    this.warpMaterial.dispose();
    this.warpGeometry.dispose();
    this.renderer.dispose();
  }
}
