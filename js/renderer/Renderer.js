import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { WORLD, tileSeed, ROADS, onRoad, RIVER, LANDMARKS, sample } from '../core/WorldConfig.js';
import { buildLampSites, lampLevel } from '../core/StreetLamps.js';
import { MONSTER_TYPES, ROSTER } from '../core/MonsterTypes.js';
import { VEHICLE_FACE } from '../gameplay/Vehicle.js';
import { BUILDING_DEFS, nearBuilding, BILLBOARD, TV_HOUSES, DOOR_W, DOOR_H, DOORS, setDoor, camsFor } from '../core/Buildings.js';
import { recommendGraphics } from '../core/Device.js';
import { groundHeight } from '../core/Collision.js';
import { itemMeshFor } from './ItemModels.js';

export class Renderer {
  constructor() {
    this.backend = 'webgl2';
    this._THREE = THREE;
    this.monsterMeshes = [];
    this.monsterTemplate = null;
    this.playerTemplate = null;
    this.nameSprites = new Map(); // key -> sprite
    this.remoteMeshes = {};
    this.monsterAnimations = [];
    this.playerAnimations = [];
    this.mixers = [];
    this.vehicleModels = {};
    this.vehicleMeshes = {};
    this.billboardMesh = null;
    this.screenMats = [];
    this._screenTex = null;
    this._screenVideo = null;
    this.tvSpots = [];
    this.tvLights = [];
    this._lastBillboardUrl = null;
    this.throwables = [];
    this.rainMesh = null;
    this._rainOn = false;
  }

  async init(canvas) {
    this._THREE = THREE;
    const gfx = recommendGraphics();
    this.gfx = gfx;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !!gfx.antialias,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
    });
    this._prCap = Math.min(window.devicePixelRatio || 1, gfx.pixelRatioCap);
    this._pr = this._prCap;
    this._prMin = Math.max(0.5, this._prCap * 0.6);
    this._perf = { t0: performance.now(), frames: 0, good: 0, warm: 4 };
    this.renderer.setPixelRatio(this._pr);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this._ctxLost = true; }, false);
    canvas.addEventListener('webglcontextrestored', () => { this._ctxLost = false; }, false);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.setClearColor(0x07080a);
    // ACES is expensive on mobile GPUs
    if (gfx.touch) {
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1;
    } else {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
    }
    this.renderer.shadowMap.enabled = gfx.shadows;
    if (gfx.shadows) this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0b0d10, gfx.fogDensity);
    this.scene.background = new THREE.Color(0x07080a);

    this.camera = new THREE.PerspectiveCamera(
      72,
      canvas.clientWidth / canvas.clientHeight,
      0.2,
      gfx.drawDistance || 320
    );

    // Flashlight: strong spot + near fill (dark forest needs high intensity)
    this.flashlight = new THREE.SpotLight(0xfff4e0, 0, 45, Math.PI / 5, 0.25, 1.0);
    this.flashlight.castShadow = false;
    this.flashlightTarget = new THREE.Object3D();
    this.scene.add(this.flashlightTarget);
    this.flashlight.target = this.flashlightTarget;
    this.scene.add(this.flashlight);
    this.flashlightFill = new THREE.PointLight(0xffe8c8, 0, 8, 2);
    this.scene.add(this.flashlightFill);
    this.lighterLight = new THREE.PointLight(0xff9a3c, 0, 10, 2);
    this.scene.add(this.lighterLight);

    // Pool of remote flashlights (fixed count — avoids shader recompile on join/leave)
    const nRemote = gfx.lowEnd ? 2 : 5;
    this.remoteLights = Array.from({ length: nRemote }, () => {
      const l = new THREE.SpotLight(0xfff4e0, 0, 40, Math.PI / 5, 0.3, 1.0);
      l.castShadow = false;
      this.scene.add(l);
      this.scene.add(l.target);
      let beam = null;
      if (!gfx.lowEnd) {
        beam = new THREE.Mesh(
          new THREE.ConeGeometry(2.6, 14, 16, 1, true).translate(0, -7, 0).rotateX(Math.PI / 2),
          new THREE.MeshBasicMaterial({
            color: 0xfff4e0,
            transparent: true,
            opacity: 0.06,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          })
        );
        beam.visible = false;
        beam.frustumCulled = false;
        this.scene.add(beam);
      }
      return { l, beam, uid: null };
    });

    const groundGeo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, gfx.touch ? 24 : 48, gfx.touch ? 24 : 48);
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      pos.setZ(i, groundHeight(x, -y));
    }
    groundGeo.computeVertexNormals();
    this.ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ color: 0x1a1f16, roughness: 0.95 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.treeGroup = new THREE.Group();
    this.rockGroup = new THREE.Group();
    this.buildForest();
    this.scene.add(this.treeGroup);
    this.scene.add(this.rockGroup);
    this.doors = {};
    this.buildingGroup = new THREE.Group();
    this.buildBuildings();
    this.scene.add(this.buildingGroup);

    this.ambientLight = new THREE.AmbientLight(0x3a4038, 0.45);
    this.scene.add(this.ambientLight);
    this.sunLight = new THREE.DirectionalLight(0xfff0c8, 0.85);
    this.sunLight.position.set(40, 60, 20);
    this.sunLight.castShadow = gfx.shadows;
    this.scene.add(this.sunLight);
    this.fillLight = new THREE.HemisphereLight(0x2a3a2a, 0x0a0a0a, 0.12);
    this.scene.add(this.fillLight);

    // Load GLB models
    const loader = new GLTFLoader();
    try {
      // Silhouette entity (no skeleton) — do NOT attach GLB bone animations
      this.monsterTemplate = this._fallbackMonster();
      this.monsterAnimations = [];
    } catch (e) {
      console.warn('monster setup', e);
      this.monsterTemplate = this._fallbackMonster();
      this.monsterAnimations = [];
    }
    try {
      const plGltf = await loader.loadAsync('./assets/player.glb');
      this.playerTemplate = plGltf.scene;
      this.playerAnimations = plGltf.animations || [];
      try {
        const motorGltf = await loader.loadAsync('./assets/motor.glb');
        this.vehicleModels.motor = motorGltf.scene;
        const mobilGltf = await loader.loadAsync('./assets/mobil.glb');
        this.vehicleModels.mobil = mobilGltf.scene;
      } catch (e) {
        console.warn('Vehicle models', e);
      }
      // billboard built in buildBillboard()
      this.playerTemplate.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = gfx.shadows;
          c.receiveShadow = gfx.shadows;
        }
      });
    } catch (e) {
      console.warn('player.glb failed', e);
      this.playerTemplate = this._fallbackPlayer();
    }

    // Roads + street lamps first (light assets)
    this.buildRoads();
    this.buildRiver();
    this.buildLandmarks();
    this.buildBillboard();
    this.buildLamps(buildLampSites(), gfx);
    this._initTVLights(gfx);

    // Heavy monsters load in background; await renderer.monstersReady before start
    this.monstersReady = (async () => {
      try {
        const mod = await import('three/addons/libs/meshopt_decoder.module.js');
        if (mod.MeshoptDecoder) loader.setMeshoptDecoder(mod.MeshoptDecoder);
      } catch (e) { /* meshopt optional */ }
      return this.loadMonsters(loader, gfx);
    })();
  }

  async loadMonsters(loader, gfx) {
    const loaded = await Promise.all(
      ROSTER.map((t) => this._loadMonster(t, loader, gfx).catch((e) => {
        console.warn('monster load', t, e);
        return { mesh: this._fallbackMonster(), clips: [] };
      }))
    );
    loaded.forEach(({ mesh, clips }, i) => {
      mesh.visible = false;
      this.scene.add(mesh);
      mesh.userData.anim = clips.length ? this._setupAnimated(mesh, clips, null) : null;
      mesh.userData.sway = MONSTER_TYPES[ROSTER[i]]?.procedural ? this._setupSway(mesh) : null;
      this.monsterMeshes.push(mesh);
      this._attachNameTag(mesh, '', 'monster-' + i);
    });
  }

  async _loadMonster(type, loader, gfx) {
    const cfg = MONSTER_TYPES[type] || MONSTER_TYPES.shadow;
    if (!cfg.glb) {
      const mesh = this._fallbackMonster();
      mesh.userData.face = cfg.face ?? 0;
      return { mesh, clips: [] };
    }
    let g;
    try {
      g = await loader.loadAsync('./assets/' + cfg.glb);
    } catch (e) {
      console.warn('Monster GLB missing', cfg.glb, e);
      const mesh = this._fallbackMonster();
      mesh.userData.face = cfg.face ?? 0;
      return { mesh, clips: [] };
    }
    const model = g.scene;
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model, true);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 0.01) model.scale.multiplyScalar(cfg.h / size.y);
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model, true);
    const c = box.getCenter(new THREE.Vector3());
    model.position.set(-c.x, -box.min.y, -c.z);
    model.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;
        o.castShadow = !!gfx.shadows;
      }
    });
    // Strip root-motion on Hips X/Z
    for (const clip of g.animations || []) {
      for (const track of clip.tracks) {
        if (/Hips.*\.position$/.test(track.name)) {
          for (let k = 0; k < track.values.length; k += 3) {
            track.values[k] = track.values[0];
            track.values[k + 2] = track.values[2];
          }
        }
      }
    }
    const root = new THREE.Group();
    root.add(model);
    root.userData.face = cfg.face ?? 0;
    return { mesh: root, clips: g.animations || [] };
  }

  _setupSway(root) {
    const bones = [];
    root.traverse((o) => {
      if (o.isBone && /^(Body|Neck|Head|Arm|Elbow)/i.test(o.name)) {
        bones.push({ b: o, q0: o.quaternion.clone(), i: bones.length });
      }
    });
    return bones;
  }

  _sway(bones, t, k) {
    const _e = this._swayE || (this._swayE = new THREE.Euler());
    const _q = this._swayQ || (this._swayQ = new THREE.Quaternion());
    for (const e of bones) {
      _e.set(0, 0, Math.sin(t * (2 + k * 3) + e.i * 0.7) * (0.04 + k * 0.05));
      e.b.quaternion.copy(e.q0).multiply(_q.setFromEuler(_e));
    }
  }

  buildRoads() {
    const quads = [];
    for (const r of ROADS) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i];
        const [bx, bz] = r.pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        const yaw = Math.atan2(bx - ax, bz - az);
        for (let d = 2; d < L + 2; d += 4) {
          quads.push({
            x: ax + ((bx - ax) * d) / L,
            z: az + ((bz - az) * d) / L,
            yaw,
            w: r.w,
          });
        }
      }
    }
    if (!quads.length) return;
    const geo = new THREE.PlaneGeometry(1, 4.3).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x23262b,
      roughness: 0.92,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const im = new THREE.InstancedMesh(geo, mat, quads.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    quads.forEach((s, i) => {
      q.setFromAxisAngle(up, s.yaw);
      pos.set(s.x, groundHeight(s.x, s.z) + 0.06, s.z);
      scl.set(s.w, 1, 1);
      im.setMatrixAt(i, m.compose(pos, q, scl));
    });
    im.receiveShadow = true;
    this.scene.add(im);
    this.roadMesh = im;
  }

  buildLamps(sites, gfx) {
    this.lampSites = sites || [];
    if (!this.lampSites.length) return;
    const n = this.lampSites.length;
    // Poles
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.12, 6, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.85 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, n);
    // Heads
    const headGeo = new THREE.BoxGeometry(0.5, 0.18, 0.35);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.7 });
    const heads = new THREE.InstancedMesh(headGeo, headMat, n);
    // Bulbs (emissive via instance color)
    const bulbGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.lampBulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, n);
    this.lampBulbs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3(1, 1, 1);
    this.lampSites.forEach((s, i) => {
      const gy = groundHeight(s.x, s.z);
      pos.set(s.x, gy + 3, s.z);
      poles.setMatrixAt(i, m.compose(pos, q, scl));
      pos.set(s.x, gy + 6.1, s.z);
      heads.setMatrixAt(i, m.compose(pos, q, scl));
      pos.set(s.x, gy + 5.95, s.z);
      this.lampBulbs.setMatrixAt(i, m.compose(pos, q, scl));
      this.lampBulbs.setColorAt(i, new THREE.Color(0.05, 0.05, 0.05));
    });
    this.scene.add(poles);
    this.lampPoles = poles;
    this.scene.add(heads);
    this.scene.add(this.lampBulbs);

    const poolN = gfx.touch ? 3 : 6;
    this.lampPool = Array.from({ length: poolN }, () => {
      const l = new THREE.PointLight(0xffd9a0, 0, 26, 1.6);
      this.scene.add(l);
      return l;
    });
    this._nearLamps = [];
    this._la = 0;
  }

  updateLamps(t, dayP, px, pz, dt) {
    if (!this.lampSites?.length || !this.lampBulbs) return;
    this._la = (this._la || 0) + dt;
    // Rebuild bulb colors + nearest pool at most 4×/s
    if (this._la > 0.25) {
      this._la = 0;
      const c = this._lampColor || (this._lampColor = new THREE.Color());
      let dirty = false;
      this.lampSites.forEach((s, i) => {
        const next = lampLevel(s.id, t, dayP);
        if (Math.abs((s._c ?? -1) - next) > 0.02) {
          s._c = next;
          const v = 0.05 + next * 2.2;
          c.setRGB(v, v * 0.92, v * 0.75);
          this.lampBulbs.setColorAt(i, c);
          dirty = true;
        }
        s.level = next;
      });
      if (dirty && this.lampBulbs.instanceColor) this.lampBulbs.instanceColor.needsUpdate = true;
      const d = (s) => Math.hypot(s.x - px, s.z - pz);
      this._nearLamps = this.lampSites
        .filter((s) => s.level > 0.05 && d(s) < 60)
        .sort((a, b) => d(a) - d(b))
        .slice(0, this.lampPool?.length || 0);
    }
    (this.lampPool || []).forEach((l, k) => {
      const s = this._nearLamps?.[k];
      if (s) l.position.set(s.x, groundHeight(s.x, s.z) + 6, s.z);
      const target = s ? s.level * 18 : 0;
      l.intensity += (target - l.intensity) * Math.min(1, dt * 10);
    });
  }

  /**
   * Tall pitch-black silhouette: pointed "hat" head + twin glowing eyes.
   * Inspired by classic hallway entity horror imagery (original mesh).
   */
  _fallbackMonster() {
    const g = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({
      color: 0x14161c,
      emissive: 0x05060a,
      roughness: 1,
      metalness: 0,
    });
    const matEye = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe8f0ff,
      emissiveIntensity: 4,
      roughness: 0.2,
    });

    // Torso — tall, thin, slightly flared at shoulders
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 1.55, 8), matBody);
    torso.position.y = 0.95;
    g.add(torso);

    // Shoulders / upper cloak mass
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.48, 8, 6), matBody);
    shoulders.scale.set(1.15, 0.55, 0.7);
    shoulders.position.y = 1.65;
    g.add(shoulders);

    // Neck stump
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.25, 6), matBody);
    neck.position.y = 1.95;
    g.add(neck);

    // Pointed triangular head (wide base, sharp tip) — the "star/horn" silhouette
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.15, 3), matBody);
    head.position.y = 2.55;
    head.rotation.y = Math.PI / 6;
    g.add(head);

    // Extra tip for sharper peak
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.45, 3), matBody);
    tip.position.y = 3.2;
    tip.rotation.y = Math.PI / 6;
    g.add(tip);

    // Arms hanging
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.35, 5), matBody);
      arm.position.set(side * 0.42, 1.05, 0.05);
      arm.rotation.z = side * 0.15;
      g.add(arm);
    }

    // Glowing eyes — small discs under the brim of the pointed head
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), matEye);
      eye.position.set(side * 0.16, 2.28, 0.38);
      g.add(eye);
      // no PointLight on eyes — avoids shader recompile when monsters toggle
    }

    // Legs
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.85, 5), matBody);
      leg.position.set(side * 0.16, 0.35, 0);
      g.add(leg);
    }

    g.scale.setScalar(1.15);
    g.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = true;
        c.receiveShadow = false;
      }
    });
    return g;
  }


  _fallbackPlayer() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 1.0, 4, 6),
      new THREE.MeshStandardMaterial({ color: 0x446688 })
    ));
    return g;
  }

  _makeNameSprite(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 28px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(20, 12, 216, 40);
    ctx.fillStyle = '#e8e0d5';
    ctx.fillText(text.slice(0, 16), 128, 40);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(2.2, 0.55, 1);
    spr.position.y = 3.2;
    spr.userData.canvas = canvas;
    spr.userData.ctx = ctx;
    spr.userData.tex = tex;
    return spr;
  }

  _attachNameTag(root, name, key) {
    let spr = this.nameSprites.get(key);
    if (spr) {
      this._updateNameSprite(spr, name);
      return spr;
    }
    spr = this._makeNameSprite(name);
    root.add(spr);
    this.nameSprites.set(key, spr);
    return spr;
  }

  _updateNameSprite(spr, name) {
    if (spr.userData.name === name) return;
    spr.userData.name = name;
    const ctx = spr.userData.ctx;
    const canvas = spr.userData.canvas;
    if (!ctx) return;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 28px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(20, 12, 216, 40);
    ctx.fillStyle = '#e8e0d5';
    ctx.fillText(String(name).slice(0, 16), 128, 40);
    spr.userData.tex.needsUpdate = true;
  }



  spawnThrowable(from, to) {
    const geo = new THREE.SphereGeometry(0.12, 8, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.7 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(from.x, from.y, from.z);
    this.scene.add(mesh);
    this.throwables.push({
      mesh,
      from: { ...from },
      to: { ...to },
      t: 0,
      dur: 0.45,
    });
  }

  _updateThrowables(dt) {
    for (let i = this.throwables.length - 1; i >= 0; i--) {
      const th = this.throwables[i];
      th.t += dt;
      const u = Math.min(1, th.t / th.dur);
      const x = th.from.x + (th.to.x - th.from.x) * u;
      const z = th.from.z + (th.to.z - th.from.z) * u;
      const y = th.from.y + (th.to.y - th.from.y) * u + Math.sin(u * Math.PI) * 2.2;
      th.mesh.position.set(x, y, z);
      if (u >= 1) {
        this.scene.remove(th.mesh);
        th.mesh.geometry.dispose();
        th.mesh.material.dispose();
        this.throwables.splice(i, 1);
      }
    }
  }

  setRain(on) {
    on = !!on;
    if (on === this._rainOn && this.rainMesh) {
      this.rainMesh.visible = on;
      return;
    }
    this._rainOn = on;
    if (on && !this.rainMesh) {
      // Fewer drops on weak devices; streaks via sizeAttenuation
      const n = (this.gfx && this.gfx.maxRain) || (this.gfx.touch ? 100 : 280);
      const positions = new Float32Array(n * 3);
      const speeds = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 36;
        positions[i * 3 + 1] = Math.random() * 22;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 36;
        speeds[i] = 14 + Math.random() * 10;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xb8d4ef,
        size: this.gfx.touch ? 0.12 : 0.09,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        sizeAttenuation: true,
      });
      this.rainMesh = new THREE.Points(geo, mat);
      this.rainMesh.frustumCulled = false;
      this._rainSpeeds = speeds;
      this._rainPosArr = positions;
      this._rainCount = n;
      this._rainFrame = 0;
      this.scene.add(this.rainMesh);
    }
    if (this.rainMesh) this.rainMesh.visible = on;
  }

  _updateRain(dt, camPos) {
    if (!this.rainMesh || !this._rainOn || !this._rainPosArr) return;
    this.rainMesh.position.set(camPos.x, camPos.y - 2, camPos.z);
    this._rainFrame = (this._rainFrame + 1) % 2;
    const arr = this._rainPosArr, speeds = this._rainSpeeds, n = this._rainCount;
    const cx = camPos.x, cz = camPos.z, baseY = camPos.y - 2;
    const near = (this._rainNear ||= []); near.length = 0;
    for (const b of BUILDING_DEFS)
      if (Math.abs(b.x - cx) < 45 && Math.abs(b.z - cz) < 45) near.push(b);
    for (let i = this._rainFrame; i < n; i += 2) {
      const yi = i * 3 + 1;
      arr[yi] -= speeds[i] * dt;
      let reset = arr[yi] < -2;
      if (!reset && near.length) {
        const wx = cx + arr[i * 3], wz = cz + arr[i * 3 + 2], wy = baseY + arr[yi];
        for (const b of near) {
          if (wy < b.h + 0.3 && Math.abs(wx - b.x) < b.w / 2 && Math.abs(wz - b.z) < b.d / 2) { reset = true; break; }
        }
      }
      if (reset) {
        arr[yi] = 18 + Math.random() * 6;
        arr[i * 3] = (Math.random() - 0.5) * 36;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 36;
      }
    }
    this.rainMesh.geometry.attributes.position.needsUpdate = true;
  }


  syncVehicles(vehicles) {
    const seen = new Set();
    for (const v of vehicles || []) {
      seen.add(v.id);
      let mesh = this.vehicleMeshes[v.id];
      if (!mesh) {
        const tpl = this.vehicleModels[v.type];
        if (!tpl) continue;
        mesh = tpl.clone(true);
        mesh.traverse((c) => {
          if (c.isMesh && c.material) c.material = c.material.clone();
        });
        this.scene.add(mesh);
        mesh.rotation.order = 'YXZ';
      this.vehicleMeshes[v.id] = mesh;
      }
      const m = mesh, kk = 1 - Math.exp(-12 * (this._dt || 0.016));
      if (m.rotation.order !== 'YXZ') m.rotation.order = 'YXZ';
      const _tmp = (this._vTmp ||= new THREE.Vector3());
      if (!m.userData.init || !v.remote) {
        m.position.set(v.position.x, v.position.y || 0, v.position.z);
      } else {
        m.position.lerp(_tmp.set(v.position.x, v.position.y || 0, v.position.z), kk);
      }
      m.userData.init = 1;
      {
        const face = (typeof VEHICLE_FACE !== 'undefined' ? VEHICLE_FACE : Math.PI);
        const ty = (v.rotation.yaw || 0) + face;
        if (v.remote) {
          let dy = ((ty - m.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          m.rotation.y += dy * kk;
        } else {
          m.rotation.y = ty;
        }
      }
      m.rotation.z += (-(v._steer || 0) * Math.min(1, Math.abs(v.speed || 0) / 9) * 0.25 - m.rotation.z) * kk;
      m.rotation.x += (((v.speed || 0) - (v._lastSpd || 0)) * -0.004 - m.rotation.x) * kk;
      v._lastSpd = v.speed || 0;
    }
    for (const id of Object.keys(this.vehicleMeshes)) {
      if (!seen.has(id)) {
        this.scene.remove(this.vehicleMeshes[id]);
        delete this.vehicleMeshes[id];
      }
    }
  }

  applyBillboardMedia(data, audio) {
    if (!data || !data.url) return;
    if (data.url === this._lastBillboardUrl) return;
    this._lastBillboardUrl = data.url;
    this._screenVideo?.pause();
    this._screenVideo = null;
    this._vidCopy = null;
    try { this._screenTex?.dispose?.(); } catch (e) { /* */ }
    if (data.type === 'image' || !data.type) {
      new THREE.TextureLoader().load(data.url, (tex) => {
        if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
        this._setScreens(tex);
      });
    } else if (data.type === 'video') {
      this._screenVideo?.pause();
      const video = document.createElement('video');
      video.src = data.url;
      video.crossOrigin = 'anonymous';
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.play().catch(() => {});
      this._screenVideo = video;
      let tex;
      if (this.gfx?.touch) {
        const cv = document.createElement('canvas');
        cv.width = 384; cv.height = 216;
        this._vidCopy = { video, cv, g: cv.getContext('2d'), acc: 0 };
        tex = new THREE.CanvasTexture(cv);
      } else {
        this._vidCopy = null;
        tex = new THREE.VideoTexture(video);
      }
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
      this._setScreens(tex);
    } else if (data.type === 'audio' && audio && this.billboardMesh) {
      const p = this.billboardMesh.getWorldPosition(new THREE.Vector3());
      audio.playPositionalFile?.(data.url, { x: p.x, y: p.y, z: p.z });
    }
  }

  _tickVideo(dt) {
    const v = this._vidCopy;
    if (!v || v.video.readyState < 2) return;
    v.acc += dt;
    if (v.acc < 1 / 12) return;
    v.acc = 0;
    v.g.drawImage(v.video, 0, 0, v.cv.width, v.cv.height);
    if (this._screenTex) this._screenTex.needsUpdate = true;
  }

  _setupAnimated(mesh, clips, defaultClip) {
    if (!clips || !clips.length) return null;
    // Collect bone / node names from hierarchy + skeletons
    const names = new Set();
    mesh.traverse((c) => {
      if (c.name) names.add(c.name);
      if (c.isSkinnedMesh && c.skeleton) {
        for (const b of c.skeleton.bones) if (b.name) names.add(b.name);
      }
    });
    // No bones at all (silhouette) → skip animation entirely
    if (names.size === 0) return null;

    const mixer = new THREE.AnimationMixer(mesh);
    const actions = {};
    for (const clip of clips) {
      if (!clip || !clip.name) continue;
      let hit = 0;
      let total = 0;
      for (const track of clip.tracks || []) {
        const nodeName = (track.name || '').split('.')[0];
        if (!nodeName) continue;
        total++;
        if (names.has(nodeName)) hit++;
      }
      // Require majority of tracks to match — otherwise skip (prevents PropertyBinding spam)
      if (total > 0 && hit / total < 0.5) continue;
      if (total > 0 && hit === 0) continue;
      try {
        actions[clip.name] = mixer.clipAction(clip);
      } catch (e) {
        /* skip bad clip */
      }
    }
    if (!Object.keys(actions).length) return null;
    this.mixers.push(mixer);
    const entry = { mixer, actions, current: null };
    if (defaultClip && actions[defaultClip]) {
      actions[defaultClip].play();
      entry.current = defaultClip;
    } else {
      // fallback first clip
      const first = Object.keys(actions)[0];
      if (first) {
        actions[first].play();
        entry.current = first;
      }
    }
    return entry;
  }

  _playAction(entry, name, loopOnce = false) {
    if (!entry || !entry.actions) return;
    // fuzzy match clip names (Idle/idle/IDLE)
    let key = name;
    if (!entry.actions[key]) {
      const lower = name.toLowerCase();
      key = Object.keys(entry.actions).find((k) => k.toLowerCase() === lower || k.toLowerCase().includes(lower));
    }
    if (!key || !entry.actions[key] || entry.current === key) return;
    const next = entry.actions[key];
    const prev = entry.current ? entry.actions[entry.current] : null;
    next.reset();
    if (loopOnce) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    next.fadeIn(0.25).play();
    if (prev && prev !== next) prev.fadeOut(0.25);
    entry.current = key;
  }


  buildBuildings() {
    const doorW = 1.7;
    const wallT = 0.35;
    // Collect geometries by material key, then merge → few draw calls
    const buckets = new Map(); // key -> { mat, geos: [] }
    const take = (key, mat, geo, mx, my, mz, rx = 0, ry = 0, rz = 0) => {
      geo.translate(mx, my, mz);
      if (rx || ry || rz) geo.rotateX(rx).rotateY(ry).rotateZ(rz);
      if (!buckets.has(key)) buckets.set(key, { mat, geos: [] });
      buckets.get(key).geos.push(geo);
    };
    // unique materials per color/type
    const wallMats = new Map();
    const wallMat = (color) => {
      const k = 'w' + color;
      if (!wallMats.has(k))
        wallMats.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.05 }));
      return wallMats.get(k);
    };
    const roofHouse = new THREE.MeshStandardMaterial({ color: 0x1a1008, roughness: 0.88 });
    const roofBld = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.88 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1814, roughness: 0.95 });

    for (const def of BUILDING_DEFS) {
      const { w, d, h, door } = def;
      const hx = w / 2, hz = d / 2;
      const ox = def.x, oz = def.z;
      const wm = wallMat(def.color);
      const wk = 'wall_' + def.color;

      take('floor', floorMat, new THREE.BoxGeometry(w - 0.1, 0.12, d - 0.1), ox, 0.06, oz);

      const wall = (ww, hh, dd, px, py, pz) =>
        take(wk, wm, new THREE.BoxGeometry(ww, hh, dd), ox + px, py, oz + pz);

      if (door === 'n') {
        const side = (w - doorW) / 2;
        wall(side, h, wallT, -hx + side / 2, h / 2, -hz);
        wall(side, h, wallT, hx - side / 2, h / 2, -hz);
      } else wall(w + wallT, h, wallT, 0, h / 2, -hz);
      if (door === 's') {
        const side = (w - doorW) / 2;
        wall(side, h, wallT, -hx + side / 2, h / 2, hz);
        wall(side, h, wallT, hx - side / 2, h / 2, hz);
      } else wall(w + wallT, h, wallT, 0, h / 2, hz);
      if (door === 'w') {
        const side = (d - doorW) / 2;
        wall(wallT, h, side, -hx, h / 2, -hz + side / 2);
        wall(wallT, h, side, -hx, h / 2, hz - side / 2);
      } else wall(wallT, h, d + wallT, -hx, h / 2, 0);
      if (door === 'e') {
        const side = (d - doorW) / 2;
        wall(wallT, h, side, hx, h / 2, -hz + side / 2);
        wall(wallT, h, side, hx, h / 2, hz - side / 2);
      } else wall(wallT, h, d + wallT, hx, h / 2, 0);

      if (def.type === 'house') {
        const geo = new THREE.ConeGeometry(Math.max(w, d) * 0.72, h * 0.55, 4);
        geo.rotateY(Math.PI / 4);
        take('roof_h', roofHouse, geo, ox, h + h * 0.2, oz);
      } else {
        take('roof_b', roofBld, new THREE.BoxGeometry(w + 0.6, 0.25, d + 0.6), ox, h + 0.1, oz);
      }

      // TV still needs a local group for screen mats
      const g = new THREE.Group();
      g.position.set(def.x, 0, def.z);
      this._addTV(g, def);
      if (g.children.length) this.buildingGroup.add(g);
    }


    // Door pivots (visual) — one group per building
    const doorMat = (this._doorMat ??= new THREE.MeshStandardMaterial({ color: 0x2b1b10, roughness: 0.9 }));
    for (const def of BUILDING_DEFS) {
      const { w, d, door } = def;
      const hx = w / 2, hz = d / 2;
      const H = {
        s: [-DOOR_W / 2, hz, 0],
        n: [DOOR_W / 2, -hz, Math.PI],
        e: [hx, DOOR_W / 2, Math.PI / 2],
        w: [-hx, -DOOR_W / 2, -Math.PI / 2],
      }[door] || [-DOOR_W / 2, hz, 0];
      const pivot = new THREE.Group();
      pivot.position.set(def.x + H[0], 0, def.z + H[1]);
      pivot.rotation.y = H[2];
      const leaf = new THREE.Mesh(
        new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.08).translate(DOOR_W / 2, DOOR_H / 2, 0),
        doorMat
      );
      pivot.add(leaf);
      this.buildingGroup.add(pivot);
      this.doors[def.id || (`b_${def.x}_${def.z}`)] = { pivot, closed: H[2], open: false };
    }
    for (const { mat, geos } of buckets.values()) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = !!this.gfx?.shadows;
      mesh.receiveShadow = true;
      this.buildingGroup.add(mesh);
    }
  }

  buildForest() {
    const treeColliders = (this._treeData = []);
    const rockColliders = (this._rockData = []);
    // Collect positions using same logic as Collision (approx from colliders passed later)
    // Build from WORLD tiles here
    const half = WORLD.half;
    const ts = WORLD.tileSize;
    const dummy = new THREE.Object3D();
    const hash = (x, y, z) => {
      const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
      return s - Math.floor(s);
    };
    const jitter = (g, a) => {
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const h = hash(pos.getX(i), pos.getY(i), pos.getZ(i)) - 0.5;
        pos.setXYZ(
          i,
          pos.getX(i) + h * a,
          pos.getY(i),
          pos.getZ(i) + hash(pos.getZ(i), pos.getX(i), pos.getY(i)) * a - a / 2
        );
      }
      return g;
    };
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.34, 5.5, 6);
    const crownGeo = mergeGeometries(
      [[2.0, 2.6, 3.2], [1.55, 2.4, 4.6], [1.05, 2.2, 5.9]].map(([r, h, y]) =>
        jitter(new THREE.ConeGeometry(r, h, 7).translate(0, y - 2.75, 0), 0.25)
      )
    );
    const deadGeo = mergeGeometries(
      [[0.5, 3.4, -0.5], [-0.6, 4.2, 0.7], [0.2, 4.8, 0.2]].map(([rz, y, rx]) =>
        new THREE.CylinderGeometry(0.03, 0.09, 1.8, 4)
          .translate(0, 0.9, 0)
          .rotateZ(rz)
          .rotateX(rx)
          .translate(0, y - 2.75, 0)
      )
    );
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.95, flatShading: true });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a3a36, roughness: 0.88 });

    const trunks = [];
    const crowns = [];
    const deads = [];
    const rocks = [];

    for (let tz = 0; tz < WORLD.tilesPerSide; tz++) {
      for (let tx = 0; tx < WORLD.tilesPerSide; tx++) {
        const ox = -half + tx * ts + ts * 0.5;
        const oz = -half + tz * ts + ts * 0.5;
        const treeCount = 2 + Math.floor(tileSeed(tx, tz, 0) * 3);
        for (let i = 0; i < treeCount; i++) {
          const sx = tileSeed(tx, tz, i * 3 + 1);
          const sz = tileSeed(tx, tz, i * 3 + 2);
          const scale = 0.7 + tileSeed(tx, tz, i * 3 + 3) * 0.9;
          const x = ox + (sx - 0.5) * (ts - 2);
          const z = oz + (sz - 0.5) * (ts - 2);
          if (Math.hypot(x, z) < 8) continue;
          if (nearBuilding(x, z, 9) || onRoad(x, z, 5)) continue;
          const r1 = tileSeed(tx, tz, 400 + i), r2 = tileSeed(tx, tz, 420 + i), r3 = tileSeed(tx, tz, 440 + i);
          const t = {
            x, z, scale,
            yaw: r1 * 6.283, sy: 0.9 + r2 * 0.45, sxz: 0.85 + r3 * 0.3,
            tx: (r2 - 0.5) * 0.12, tz: (r3 - 0.5) * 0.12, tone: r1, dead: r2 < 0.22,
          };
          trunks.push(t);
          (t.dead ? deads : crowns).push(t);
        }
        const rockCount = 1 + Math.floor(tileSeed(tx, tz, 99) * 2);
        for (let i = 0; i < rockCount; i++) {
          const sx = tileSeed(tx, tz, 200 + i * 2);
          const sz = tileSeed(tx, tz, 201 + i * 2);
          const x = ox + (sx - 0.5) * (ts - 3);
          const z = oz + (sz - 0.5) * (ts - 3);
          if (Math.hypot(x, z) < 6) continue;
          if (nearBuilding(x, z, 7) || onRoad(x, z, 4)) continue;
          const sc = 0.6 + tileSeed(tx, tz, 300 + i) * 1.4;
          rocks.push({ x, z, scale: sc, rot: sx * 2 });
        }
      }
    }

    const col = new THREE.Color();
    const place = (im, list, yOff, tint) => list.forEach((tr, i) => {
      dummy.position.set(tr.x, groundHeight(tr.x, tr.z) + yOff * tr.scale * (tr.sy || 1), tr.z);
      dummy.rotation.set(tr.tx || 0, tr.yaw || 0, tr.tz || 0);
      dummy.scale.set(tr.scale * (tr.sxz || 1), tr.scale * (tr.sy || 1), tr.scale * (tr.sxz || 1));
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      if (tint) im.setColorAt(i, col.setHSL(0.27 + (tr.tone || 0) * 0.07, 0.4, 0.045 + (tr.tone || 0) * 0.04));
    });
    const trunkIM = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, trunks.length));
    const crownIM = new THREE.InstancedMesh(crownGeo || trunkGeo, crownMat, Math.max(1, crowns.length));
    const deadIM = new THREE.InstancedMesh(deadGeo || trunkGeo, trunkMat, Math.max(1, deads.length));
    place(trunkIM, trunks, 2.75, false);
    place(crownIM, crowns, 2.75, true);
    place(deadIM, deads, 2.75, false);
    [trunkIM, crownIM, deadIM].forEach((im) => {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = this.gfx.shadows && !this.gfx.touch;
      this.treeGroup.add(im);
    });

    const rockIM = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    rockIM.castShadow = this.gfx.shadows;
    rocks.forEach((r, i) => {
      dummy.position.set(r.x, groundHeight(r.x, r.z) + 0.4 * r.scale, r.z);
      dummy.scale.setScalar(r.scale);
      dummy.rotation.set(r.rot, r.rot * 1.5, 0);
      dummy.updateMatrix();
      rockIM.setMatrixAt(i, dummy.matrix);
    });
    rockIM.instanceMatrix.needsUpdate = true;
    this.rockGroup.add(rockIM);
  }

  syncPickups(pickups) {
    this._pk ??= new Map();
    for (const [id, pk] of Object.entries(pickups || {})) {
      let m = this._pk.get(id);
      if (!m) {
        m = itemMeshFor(pk, id, groundHeight(pk.x, pk.z));
        this.scene.add(m);
        this._pk.set(id, m);
      }
      m.visible = !pk.taken || pk.kind === 'generator';
    }
  }


  buildRiver() {
    if (typeof RIVER === 'undefined' || !RIVER?.pts?.length) return;
    try {
      const pts = [...sample(RIVER.pts, 4)];
      const a = RIVER.pts[RIVER.pts.length - 2], b = RIVER.pts[RIVER.pts.length - 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      pts.push([b[0], b[1], -(b[1] - a[1]) / L, (b[0] - a[0]) / L]);
      const half = RIVER.w / 2 + 1.5, Y = -0.55, n = pts.length;
      const pos = new Float32Array(n * 6);
      pts.forEach(([x, z, nx, nz], i) => {
        pos.set([x + nx * half, Y, z + nz * half, x - nx * half, Y, z - nz * half], i * 6);
      });
      const idx = [];
      for (let i = 0; i < n - 1; i++) {
        const k = i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      this.riverMesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: 0x9fc4cf, emissive: 0x04121a, roughness: 0.15, metalness: 0.1,
          transparent: true, opacity: 0.88, side: THREE.DoubleSide,
        })
      );
      this.scene.add(this.riverMesh);
    } catch (e) {
      console.warn('buildRiver', e);
    }
  }

  buildLandmarks() {
    if (typeof LANDMARKS === 'undefined' || !LANDMARKS) return;
    const grp = (this.landmarkGroup = new THREE.Group());
    try {
      const { x, z } = LANDMARKS.waterTower;
      const y0 = groundHeight(x, z), LEG = 9, S = 2;
      const steel = new THREE.MeshStandardMaterial({ color: 0x4a4f53, roughness: 0.75, metalness: 0.5 });
      const legGeo = new THREE.CylinderGeometry(0.13, 0.17, LEG, 6);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const m = new THREE.Mesh(legGeo, steel);
        m.position.set(x + sx * S, y0 + LEG / 2, z + sz * S);
        grp.add(m);
      }
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 3.4, 20), steel);
      tank.position.set(x, y0 + LEG + 1.7, z);
      grp.add(tank);
      const sc = LANDMARKS.summoningCircle;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(5.2, 5.5, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0x8a1212, transparent: true, opacity: 0.6,
          side: THREE.DoubleSide, depthWrite: false,
        })
      );
      ring.position.set(sc.x, groundHeight(sc.x, sc.z) + 0.07, sc.z);
      this._circleMat = ring.material;
      grp.add(ring);
      this.scene.add(grp);
    } catch (e) {
      console.warn('buildLandmarks', e);
    }
  }

  tickWorldFx(dt) {
    this._fxT = (this._fxT || 0) + dt;
    if (this._circleMat) this._circleMat.opacity = 0.5 + 0.15 * Math.sin(this._fxT * 1.7);
  }


  _noSignalTexture() {
    if (this._noSig) return this._noSig;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 288;
    const g = c.getContext('2d');
    ['#c8c8c8', '#c8c800', '#00c8c8', '#00c800', '#c800c8', '#c80000', '#0000c8'].forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect((i * 512) / 7, 0, 512 / 7 + 1, 288);
    });
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(0, 0, 512, 288);
    g.fillStyle = '#9fb0c0';
    g.font = 'bold 34px monospace';
    g.textAlign = 'center';
    g.fillText('NO SIGNAL', 256, 154);
    const tex = new THREE.CanvasTexture(c);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    return (this._noSig = tex);
  }

  _makeScreenMat() {
    const m = new THREE.MeshBasicMaterial({
      map: this._screenTex || this._noSignalTexture(),
      color: this._screenTex ? 0xffffff : 0x6a7480,
    });
    this.screenMats.push(m);
    return m;
  }

  _setScreens(tex) {
    this._screenTex = tex;
    for (const m of this.screenMats) {
      m.map = tex;
      m.color.setHex(0xffffff);
      m.needsUpdate = true;
    }
  }

  buildBillboard() {
    if (typeof BILLBOARD === 'undefined') return;
    const B = BILLBOARD;
    const cy = B.base + B.h / 2;
    const g = new THREE.Group();
    g.position.set(B.x, groundHeight(B.x, B.z), B.z);
    g.rotation.y = B.yaw;
    const steel = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7, metalness: 0.4 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(B.w + 1.4, B.h + 1.4, 0.7), steel);
    frame.position.set(0, cy, -0.4);
    g.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(B.w, B.h), this._makeScreenMat());
    screen.position.set(0, cy, 0.01);
    g.add(screen);
    for (const sx of [-0.3, 0.3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, cy, 8), steel);
      post.position.set(sx * B.w, cy / 2, -0.4);
      g.add(post);
    }
    this.scene.add(g);
    this.billboardMesh = screen;
  }

  _addTV(g, def) {
    if (typeof TV_HOUSES === 'undefined' || !TV_HOUSES.includes(def.id)) return;
    const { w, d, door } = def;
    const TW = 1.7, TH = 0.96, Y = 1.45, IN = 0.35;
    const map = {
      s: [0, -d / 2 + IN, 0],
      n: [0, d / 2 - IN, Math.PI],
      e: [-w / 2 + IN, 0, Math.PI / 2],
      w: [w / 2 - IN, 0, -Math.PI / 2],
    };
    const [px, pz, yaw] = map[door] || map.s;
    const tv = new THREE.Group();
    tv.position.set(px, Y, pz);
    tv.rotation.y = yaw;
    const dark = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(TW + 0.12, TH + 0.12, 0.12), dark);
    body.position.z = -0.07;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(TW, TH), this._makeScreenMat());
    scr.position.z = 0.001;
    tv.add(body, scr);
    g.add(tv);
    this.tvSpots.push({
      house: def.id,
      x: def.x + px + Math.sin(yaw) * 0.9,
      y: 1.4,
      z: def.z + pz + Math.cos(yaw) * 0.9,
      cam: {
        name: 'TV',
        x: def.x + px + Math.sin(yaw) * 1.1,
        y: Y,
        z: def.z + pz + Math.cos(yaw) * 1.1,
        yaw,
        pitch: 0,
      },
    });
  }

  _initTVLights(gfx) {
    const n = gfx?.touch ? 0 : 2;   // HP/tablet: no TV PointLights
    this.tvLights = Array.from({ length: n }, () => {
      const l = new THREE.PointLight(0x8fb4ff, 0, 7, 2);
      this.scene.add(l);
      return l;
    });
    this._tvNear = [];
    this._tvA = 0;
    this._tvT = 0;
  }

  updateTVLights(px, pz, dt) {
    if (!this.tvLights?.length) return;
    this._tvT += dt;
    this._tvA += dt;
    if (this._tvA > 0.25) {
      this._tvA = 0;
      const d = (s) => Math.hypot(s.x - px, s.z - pz);
      this._tvNear = this.tvSpots
        .filter((s) => d(s) < 14)
        .sort((a, b) => d(a) - d(b))
        .slice(0, this.tvLights.length);
    }
    const base = this._screenTex ? 1.8 : 0.6;
    this.tvLights.forEach((l, k) => {
      const s = this._tvNear[k];
      if (s) l.position.set(s.x, s.y, s.z);
      const flick = 0.85 + 0.15 * Math.sin(this._tvT * 13 + k * 1.7) * Math.sin(this._tvT * 5.3);
      const target = s ? base * flick : 0;
      l.intensity += (target - l.intensity) * Math.min(1, dt * 8);
    });
  }

  setDoorOpen(id, o) {
    const d = this.doors[id];
    if (d && !d.broken) d.open = o;
  }

  doorFx(id, style, ph) {
    const d = this.doors?.[id];
    if (!d || d.broken || style === 'phase') return;
    if (!d.fx || d.fx.style !== style) d.fx = { style, ph, t: 0, idle: 0 };
    d.fx.ph = ph;
    d.fx.idle = 0;
  }

  breakDoor(id, dx = 0, dz = 1, instant = false) {
    const d = this.doors?.[id];
    if (!d || d.broken) return;
    d.broken = true;
    d.open = true;
    d.fx = null;
    if (instant) { d.pivot.visible = false; return; }
    const s = Math.random() < 0.5 ? -1 : 1;
    d.fly = {
      t: 0, y0: d.pivot.position.y,
      vx: dx * 8 - dz * s * 3, vy: 5.5, vz: dz * 8 + dx * s * 3,
      rx: (Math.random() - 0.5) * 10, ry: (Math.random() - 0.5) * 8, rz: (Math.random() - 0.5) * 10,
    };
  }

  updateDoors(dt) {
    for (const d of Object.values(this.doors || {})) {
      const p = d.pivot;
      if (!p) continue;
      if (d.broken) {
        const f = d.fly;
        if (!f || !p.visible) continue;
        f.t += dt;
        f.vy -= 14 * dt;
        p.position.x += f.vx * dt;
        p.position.y += f.vy * dt;
        p.position.z += f.vz * dt;
        p.rotation.x += f.rx * dt;
        p.rotation.y += f.ry * dt;
        p.rotation.z += f.rz * dt;
        if (p.position.y < f.y0 && f.vy < 0) {
          p.position.y = f.y0;
          f.vy *= -0.3; f.vx *= 0.5; f.vz *= 0.5;
        }
        if (f.t > 4) p.visible = false;
        continue;
      }
      if (d.fx) {
        d.fx.t += dt;
        d.fx.idle += dt;
        if (d.fx.idle > 0.4) d.fx = null;
        else {
          const { style, ph, t } = d.fx;
          const shake = Math.sin(t * 55) * (style === 'smash' ? 0.05 : 0.025);
          let target = d.closed + shake;
          if (style === 'stab' && ph >= 1) target = d.closed - 0.9 + shake * 2;
          p.rotation.y += (target - p.rotation.y) * Math.min(1, dt * 18);
          continue;
        }
      }
      const target = d.closed - (d.open ? Math.PI / 2 : 0);
      p.rotation.y += (target - p.rotation.y) * Math.min(1, dt * 8);
    }
  }
  enterCCTV(cams) { this.cctv = { cams, i: 0 }; }
  exitCCTV() { this.cctv = null; }
  cycleCCTV(d) {
    if (!this.cctv) return;
    this.cctv.i = (this.cctv.i + d + this.cctv.cams.length) % this.cctv.cams.length;
  }

  /** Resolusi dinamis: turun jika FPS < 40, naik pelan jika stabil > 57. */
  _adaptRes() {
    const p = this._perf, now = performance.now();
    if (!p) return;
    p.frames++;
    const span = now - p.t0;
    if (span < 1000) return;
    const fps = (p.frames * 1000) / span;
    p.frames = 0; p.t0 = now;
    if (document.hidden) return;
    if (p.warm > 0) { p.warm--; return; }
    let pr = this._pr;
    if (fps < 40) {
      p.good = 0;
      pr = Math.max(this._prMin, pr - 0.1);
    } else if (fps > 57) {
      if (++p.good >= 5) { p.good = 0; pr = Math.min(this._prCap, pr + 0.1); }
    } else p.good = 0;
    if (Math.abs(pr - this._pr) < 1e-3) return;
    this._pr = pr;
    this.renderer.setPixelRatio(pr);
    const c = this.renderer.domElement;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  _updateRemoteFlash(uid, d) {
    if (!this.remoteLights) return;
    let s = this.remoteLights.find((x) => x.uid === uid);
    if (!s) s = this.remoteLights.find((x) => !x.uid);
    if (!s) return;
    s.uid = uid;
    const on = !!d.fl && d.alive !== false;
    s.l.intensity = on ? 9 : 0;
    if (s.beam) s.beam.visible = on;
    if (!on) return;
    const yaw = d.yaw || 0;
    const pitch = d.pitch || 0;
    const cp = Math.cos(pitch);
    const head = new THREE.Vector3(d.x, d.y != null ? d.y : 1.7, d.z);
    s.l.position.copy(head);
    s.l.target.position.set(
      head.x - Math.sin(yaw) * cp * 18,
      head.y + Math.sin(pitch) * 18,
      head.z - Math.cos(yaw) * cp * 18
    );
    s.l.target.updateMatrixWorld();
    if (s.beam) {
      s.beam.position.copy(head);
      s.beam.rotation.set(pitch, yaw, 0, 'YXZ');
    }
  }

  _releaseRemoteFlash(uid) {
    if (!this.remoteLights) return;
    const s = this.remoteLights.find((x) => x.uid === uid);
    if (s) {
      s.uid = null;
      s.l.intensity = 0;
      if (s.beam) s.beam.visible = false;
    }
  }

  /** Update or create remote player mesh + name tag */
  _applyAvatarColor(mesh, hex) {
    if (!hex || mesh.userData.avatarColor === hex) return;
    mesh.userData.avatarColor = hex;
    const tint = new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.35);
    mesh.traverse((c) => {
      if (c.isMesh && c.material && c.material.color) {
        if (!c.material._avatarTinted) {
          c.material = c.material.clone();
          c.material._avatarTinted = true;
        }
        c.material.color.copy(tint);
      }
    });
  }

  syncRemotePlayer(uid, data, myUid) {
    if (uid === myUid) return;
    let mesh = this.remoteMeshes[uid];
    if (!mesh && this.playerTemplate) {
      mesh = skeletonClone(this.playerTemplate);
      mesh.traverse((c) => {
        if (c.isMesh && c.material) c.material = c.material.clone();
      });
      this.scene.add(mesh);
      mesh.rotation.order = 'YXZ';
      mesh.userData.anim = this._setupAnimated(mesh, this.playerAnimations, 'Idle');
      this.remoteMeshes[uid] = mesh;
      this._attachNameTag(mesh, data.name || 'Player', 'p-' + uid);
    }
    if (!mesh) return;
    const footY = (data.footY != null)
      ? data.footY
      : ((data.y || 1.7) - 1.7);
    const u = mesh.userData;
    const k = 1 - Math.exp(-14 * (this._dt || 0.016));
    const tgt = (u.tgt ||= new THREE.Vector3()).set(data.x, footY, data.z);
    if (!u.init || mesh.position.distanceTo(tgt) > 8) { mesh.position.copy(tgt); u.init = 1; }
    else mesh.position.lerp(tgt, k);
    const ty = (data.yaw || 0) + Math.PI;
    let dy = ((ty - mesh.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    mesh.rotation.y += dy * k;
    mesh.visible = data.alive !== false;
    // crawl: flatten
    if (data.moveState === 'crawl' || data.isDowned) mesh.rotation.x += (Math.PI / 2.2 - mesh.rotation.x) * k;
    else mesh.rotation.x += (0 - mesh.rotation.x) * k;
    if (mesh.userData.anim) {
      if (data.moveState === 'riding' || data.ridingVehicleId) {
        this._playAction(mesh.userData.anim, 'Idle');
      } else {
        const clip =
          data.moveState === 'run' ? 'Run' : data.moveState === 'walk' ? 'Walk' : 'Idle';
        this._playAction(mesh.userData.anim, clip);
      }
      const sp = u.lastPos ? u.lastPos.distanceTo(mesh.position) / Math.max(this._dt || 0.016, 0.001) : 0;
      (u.lastPos ||= new THREE.Vector3()).copy(mesh.position);
      const a = u.anim?.actions?.[u.anim.current];
      if (a) a.timeScale = u.anim.current === 'Run' ? sp / 5.5 : u.anim.current === 'Walk' ? sp / 2.8 : 1;
      u.sit = !!(data.moveState === 'riding' || data.ridingVehicleId);
    }
    const spr = this.nameSprites.get('p-' + uid);
    if (spr) this._updateNameSprite(spr, data.name || 'Player');
    this._updateRemoteFlash(uid, data);
  }


  /** Visual pillars/beacons for mission anchors (panels, generator, exit). */
  spawnMissionMarkers(anchors, flat = false) {
    this.clearMissionMarkers();
    this._missionMarkers = [];
    if (!anchors) return;
    for (const [id, a] of Object.entries(anchors)) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.18, 2.2, 8),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 })
      );
      pole.position.y = 1.1;
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 10, 10),
        new THREE.MeshBasicMaterial({ color: id.startsWith('p') || id === 'exit' ? 0x66ffaa : 0xffcc44 })
      );
      bulb.position.y = 2.35;
      g.add(pole, bulb);
      g.position.set(a.x, flat ? 0 : groundHeight(a.x, a.z), a.z);
      g.userData.missionId = id;
      this.scene.add(g);
      this._missionMarkers.push(g);
    }
  }

  setMissionMarkersVisible(v) {
    for (const g of this._missionMarkers || []) g.visible = !!v;
  }

  clearMissionMarkers() {
    for (const g of this._missionMarkers || []) {
      this.scene.remove(g);
      g.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    }
    this._missionMarkers = [];
  }

  updateMissionMarkers(done = {}) {
    for (const g of this._missionMarkers || []) {
      const id = g.userData.missionId;
      const bulb = g.children[1];
      if (!bulb?.material) continue;
      if (done[id]) bulb.material.color.setHex(0x444444);
      else if (id === 'exit' || id === 'extract') bulb.material.color.setHex(0x66aaff);
      else bulb.material.color.setHex(0x66ffaa);
    }
  }

  pruneRemotePlayers(activeUids) {
    for (const uid of Object.keys(this.remoteMeshes)) {
      if (!activeUids.has(uid)) {
        const mesh = this.remoteMeshes[uid];
        if (mesh.userData.anim) {
          const idx = this.mixers.indexOf(mesh.userData.anim.mixer);
          if (idx !== -1) this.mixers.splice(idx, 1);
        }
        this.scene.remove(mesh);
        this.nameSprites.delete('p-' + uid);
        delete this.remoteMeshes[uid];
        this._releaseRemoteFlash(uid);
      }
    }
  }

  applyDayLighting(light) {
    if (!light) return;
    // Smooth rain dim (no discrete key cache — cheap enough every frame)
    const target = this._rainOn ? 0.72 : 1;
    this._rainDim = (this._rainDim ?? 1) + (target - (this._rainDim ?? 1)) * 0.02;
    const rainDim = this._rainDim;

    if (this.ambientLight) {
      this.ambientLight.color.setHex(light.ambient);
      this.ambientLight.intensity = light.ambientInt * rainDim;
    }
    if (this.sunLight) {
      this.sunLight.color.setHex(light.sun);
      this.sunLight.intensity = light.sunInt * rainDim;
      const h = 18 + light.sunInt * 52;
      this.sunLight.position.set(45, h, 25);
      // Gradual cooler fill at night (no hard threshold)
      const cool = 1 - Math.min(1, light.sunInt / 0.25);
      this.sunLight.color.offsetHSL(0.05 * cool, -0.1 * cool, 0);
    }
    if (this.scene.fog) {
      this.scene.fog.color.setHex(light.fog);
      const dens = light.fogDensity * (this._rainOn ? 1.35 : 1);
      this.scene.fog.density = Math.min(0.045, dens);
    }
    this.renderer.setClearColor(light.clear);
    if (this.scene.background && this.scene.background.isColor) {
      this.scene.background.setHex(light.clear);
    }
  }


  /** Visual-only hallucination silhouette (not a real monster). */
  spawnGhost(pos) {
    const g = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 1.2, 4, 8),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.85 })
    );
    g.position.set(pos.x, 1.0, pos.z);
    g.userData.hallucination = true;
    this.scene.add(g);
    return g;
  }

  render(state, eye, yaw, pitch, dt = 0) {
    if (this._ctxLost) return;
    this._dt = dt || 0.016;
    for (const mixer of this.mixers) mixer.update(dt || 0);
    for (const m of Object.values(this.remoteMeshes || {})) {
      if (!m.userData.sit) continue;
      const b = (n) => m.getObjectByName(n);
      try {
        if (b('thigh.L')) b('thigh.L').rotation.x = -1.35;
        if (b('thigh.R')) b('thigh.R').rotation.x = -1.35;
        if (b('shin.L')) b('shin.L').rotation.x = 1.3;
        if (b('shin.R')) b('shin.R').rotation.x = 1.3;
        if (b('spine')) b('spine').rotation.x = 0.2;
      } catch (e) { /* */ }
    }
    this.tickWorldFx(dt || 0);
    this.updateDoors(dt || 0);
    // Hide local ridden vehicle (first-person); others still see it
    if (this.vehicleMeshes && state && state.player) {
      const rid = state.player.ridingVehicleId;
      for (const id in this.vehicleMeshes) {
        this.vehicleMeshes[id].visible = true;
      }
    }
    this._updateThrowables(dt || 0);

    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = pitch;
    if (this.cctv) {
      const c = this.cctv.cams[this.cctv.i];
      this.camera.position.set(c.x, c.y, c.z);
      this.camera.rotation.set(c.pitch, c.yaw, 0);
    }
    if (this.lighterLight) {
      this.lighterLight.intensity = (this.cctv ? 0 : (state.player?.lighter ? 2.4 * (0.85 + Math.random() * 0.3) : 0));
      this.lighterLight.position.set(eye.x - Math.sin(yaw) * 0.6, eye.y - 0.3, eye.z - Math.cos(yaw) * 0.6);
    }

    // Flashlight follows look direction
    if (this.flashlight) {
      const on = !!(state.player && state.player.flashlight);
      const flick = state.player?._flashFlicker ?? 1;
      const base = this._rainOn ? 14 : 11;
      this.flashlight.intensity = on ? base * flick : 0;
      this.flashlight.distance = on ? 50 : 0;
      this.flashlight.position.copy(this.camera.position);
      const dir = (this._fwd ??= new THREE.Vector3()).set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.flashlightTarget.position.copy(this.camera.position).addScaledVector(dir, 18);
      this.flashlight.target.updateMatrixWorld();
      if (this.flashlightFill) {
        this.flashlightFill.intensity = on ? 2.5 * flick : 0;
        this.flashlightFill.position.copy(this.camera.position);
      }
    }

    state.monsters.forEach((mon, i) => {
      const mesh = this.monsterMeshes[i];
      if (!mesh) return;
      mesh.visible = mon.active !== false && !mon.hideFromSelf;
      if (!mesh.visible) return;
      mesh.position.set(mon.position.x, mon.position.y || 0, mon.position.z);
      mesh.rotation.y = mon.rotation.yaw + (mesh.userData.face ?? Math.PI);
      const a = mesh.userData.anim;
      if (a && a.actions && Object.keys(a.actions).length === 1 && a.current) {
        const act = a.actions[a.current];
        if (act) act.timeScale = mon.aiState === 'CHASE' ? 1.7 : mon.aiState === 'PATROL' ? 0.8 : 1.1;
      } else if (a) {
        if ((mon.attackCooldown || 0) > 0.9) this._playAction(a, 'Attack', true);
        else if (mon.aiState === 'CHASE' || mon.aiState === 'LOST_TARGET') this._playAction(a, 'Chase');
        else if (mon.aiState === 'INVESTIGATE' || mon.aiState === 'SEARCH' || mon.aiState === 'AMBUSH') this._playAction(a, 'Chase');
        else this._playAction(a, 'Patrol');
      }
      if (mesh.userData.sway) this._sway(mesh.userData.sway, performance.now() / 1000, mon.aiState === 'CHASE' ? 1 : 0.3);
      const label = mon.aiState === 'CHASE' ? '!!!' : mon.aiState === 'PATROL' ? '…' : '?';
      const spr = this.nameSprites.get('monster-' + i);
      if (spr) this._updateNameSprite(spr, label);
    });

    this._updateRain(dt || 0, this.camera.position);
    this._tickVideo(dt || 0);
    this.renderer.render(this.scene, this.camera);
    this._adaptRes();
  }
}
