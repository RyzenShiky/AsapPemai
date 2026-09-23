import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { WORLD, tileSeed } from '../core/WorldConfig.js';
import { BUILDING_DEFS, nearBuilding } from '../core/Buildings.js';
import { recommendGraphics } from '../core/Device.js';

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
      antialias: !gfx.touch,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, gfx.pixelRatioCap));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.setClearColor(0x07080a);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = gfx.shadows;
    if (gfx.shadows) this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0b0d10, gfx.fogDensity);
    this.scene.background = new THREE.Color(0x07080a);

    this.camera = new THREE.PerspectiveCamera(
      72,
      canvas.clientWidth / canvas.clientHeight,
      0.15,
      320
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

    const groundGeo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, 48, 48);
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      pos.setZ(i, Math.sin(x * 0.15) * Math.cos(y * 0.12) * 0.35);
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
      // Silhouette entity (pointed head + glowing eyes) — primary horror look
      this.monsterTemplate = this._fallbackMonster();
      this.monsterAnimations = [];
      // Optional: still load glb anims if present (ignored if no skeleton match)
      try {
        const monGltf = await loader.loadAsync('./assets/monster.glb');
        this.monsterAnimations = monGltf.animations || [];
      } catch (_) {}
    } catch (e) {
      console.warn('monster setup', e);
      this.monsterTemplate = this._fallbackMonster();
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
      // Billboard plane (world)
      const bbGeo = new THREE.PlaneGeometry(12, 7);
      const bbMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9, side: THREE.DoubleSide });
      this.billboardMesh = new THREE.Mesh(bbGeo, bbMat);
      this.billboardMesh.position.set(30, 5, -80);
      this.billboardMesh.rotation.y = Math.PI * 0.15;
      this.scene.add(this.billboardMesh);
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

    for (let i = 0; i < 2; i++) {
      const m = this.monsterTemplate.clone(true);
      m.traverse((c) => {
        if (c.isMesh && c.material) c.material = c.material.clone();
      });
      this.scene.add(m);
      m.userData.anim = this._setupAnimated(m, this.monsterAnimations, 'Patrol');
      this.monsterMeshes.push(m);
      this._attachNameTag(m, '', 'monster-' + i);
    }
  }

  /**
   * Tall pitch-black silhouette: pointed "hat" head + twin glowing eyes.
   * Inspired by classic hallway entity horror imagery (original mesh).
   */
  _fallbackMonster() {
    const g = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({
      color: 0x010101,
      roughness: 1,
      metalness: 0,
      emissive: 0x000000,
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
      const glow = new THREE.PointLight(0xddeeff, 0.45, 3.5, 2);
      glow.position.copy(eye.position);
      g.add(glow);
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
      const n = this.gfx.touch ? 120 : 280;
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
    // Follow camera (cheap)
    this.rainMesh.position.set(camPos.x, camPos.y - 2, camPos.z);
    // Update only half the drops per frame (interleaved) — ~2× cheaper
    this._rainFrame = (this._rainFrame + 1) % 2;
    const arr = this._rainPosArr;
    const speeds = this._rainSpeeds;
    const n = this._rainCount;
    const fall = dt;
    for (let i = this._rainFrame; i < n; i += 2) {
      const yi = i * 3 + 1;
      arr[yi] -= speeds[i] * fall;
      if (arr[yi] < -2) {
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
        this.vehicleMeshes[v.id] = mesh;
      }
      mesh.position.set(v.position.x, v.position.y || 0, v.position.z);
      mesh.rotation.y = v.rotation.yaw;
    }
    for (const id of Object.keys(this.vehicleMeshes)) {
      if (!seen.has(id)) {
        this.scene.remove(this.vehicleMeshes[id]);
        delete this.vehicleMeshes[id];
      }
    }
  }

  applyBillboardMedia(data, audio) {
    if (!this.billboardMesh || !data || !data.url) return;
    if (data.url === this._lastBillboardUrl) return;
    this._lastBillboardUrl = data.url;
    const pos = this.billboardMesh.position;
    if (data.type === 'image') {
      new THREE.TextureLoader().load(data.url, (tex) => {
        this.billboardMesh.material.map = tex;
        this.billboardMesh.material.color.setHex(0xffffff);
        this.billboardMesh.material.needsUpdate = true;
      });
    } else if (data.type === 'video') {
      const video = document.createElement('video');
      video.src = data.url;
      video.crossOrigin = 'anonymous';
      video.loop = true;
      video.muted = true; // autoplay policy; user can unmute via UI later
      video.playsInline = true;
      video.play().catch(() => {});
      const tex = new THREE.VideoTexture(video);
      this.billboardMesh.material.map = tex;
      this.billboardMesh.material.color.setHex(0xffffff);
      this.billboardMesh.material.needsUpdate = true;
    } else if (data.type === 'audio' && audio) {
      audio.playPositionalFile(data.url, { x: pos.x, y: pos.y, z: pos.z });
    }
  }

  _setupAnimated(mesh, clips, defaultClip) {
    if (!clips || !clips.length) return null;
    const mixer = new THREE.AnimationMixer(mesh);
    const actions = {};
    for (const clip of clips) {
      if (clip && clip.name) actions[clip.name] = mixer.clipAction(clip);
    }
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
    for (const def of BUILDING_DEFS) {
      const g = new THREE.Group();
      g.position.set(def.x, 0, def.z);
      const mat = new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: 0.92,
        metalness: 0.05,
      });
      const roofMat = new THREE.MeshStandardMaterial({
        color: def.type === 'building' ? 0x1a1c20 : 0x1a1008,
        roughness: 0.88,
      });
      const floorMat = new THREE.MeshStandardMaterial({
        color: 0x1a1814,
        roughness: 0.95,
      });
      const { w, d, h, door } = def;
      const hx = w / 2;
      const hz = d / 2;

      // Floor
      const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.12, d - 0.1), floorMat);
      floor.position.y = 0.06;
      floor.receiveShadow = true;
      g.add(floor);

      // Helper: wall panel
      const addWall = (ww, hh, dd, px, py, pz) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, dd), mat);
        m.position.set(px, py, pz);
        m.castShadow = this.gfx.shadows;
        m.receiveShadow = true;
        g.add(m);
      };

      // North (-Z)
      if (door === 'n') {
        const side = (w - doorW) / 2;
        addWall(side, h, wallT, -hx + side / 2, h / 2, -hz);
        addWall(side, h, wallT, hx - side / 2, h / 2, -hz);
      } else {
        addWall(w + wallT, h, wallT, 0, h / 2, -hz);
      }
      // South (+Z)
      if (door === 's') {
        const side = (w - doorW) / 2;
        addWall(side, h, wallT, -hx + side / 2, h / 2, hz);
        addWall(side, h, wallT, hx - side / 2, h / 2, hz);
      } else {
        addWall(w + wallT, h, wallT, 0, h / 2, hz);
      }
      // West (-X)
      if (door === 'w') {
        const side = (d - doorW) / 2;
        addWall(wallT, h, side, -hx, h / 2, -hz + side / 2);
        addWall(wallT, h, side, -hx, h / 2, hz - side / 2);
      } else {
        addWall(wallT, h, d + wallT, -hx, h / 2, 0);
      }
      // East (+X)
      if (door === 'e') {
        const side = (d - doorW) / 2;
        addWall(wallT, h, side, hx, h / 2, -hz + side / 2);
        addWall(wallT, h, side, hx, h / 2, hz - side / 2);
      } else {
        addWall(wallT, h, d + wallT, hx, h / 2, 0);
      }

      // Roof
      if (def.type === 'house') {
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(Math.max(w, d) * 0.72, h * 0.55, 4),
          roofMat
        );
        roof.position.y = h + h * 0.2;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = this.gfx.shadows;
        g.add(roof);
      } else {
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.25, d + 0.6), roofMat);
        roof.position.y = h + 0.1;
        roof.castShadow = this.gfx.shadows;
        g.add(roof);
      }

      // Dim interior bulb
      const bulb = new THREE.PointLight(0xffcc88, 0.35, Math.max(w, d) * 1.2, 2);
      bulb.position.set(0, h * 0.7, 0);
      g.add(bulb);

      this.buildingGroup.add(g);
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
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 5.5, 5);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.95 });
    const crownGeo = new THREE.ConeGeometry(1.6, 4.2, 6);
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x0f1a0c, roughness: 0.9 });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a3a36, roughness: 0.88 });

    const trunks = [];
    const crowns = [];
    const rocks = [];

    for (let tz = 0; tz < WORLD.tilesPerSide; tz++) {
      for (let tx = 0; tx < WORLD.tilesPerSide; tx++) {
        const ox = -half + tx * ts + ts * 0.5;
        const oz = -half + tz * ts + ts * 0.5;
        const treeCount = 6 + Math.floor(tileSeed(tx, tz, 0) * 5);
        for (let i = 0; i < treeCount; i++) {
          const sx = tileSeed(tx, tz, i * 3 + 1);
          const sz = tileSeed(tx, tz, i * 3 + 2);
          const scale = 0.7 + tileSeed(tx, tz, i * 3 + 3) * 0.9;
          const x = ox + (sx - 0.5) * (ts - 2);
          const z = oz + (sz - 0.5) * (ts - 2);
          if (Math.hypot(x, z) < 8) continue;
          if (nearBuilding(x, z, 9)) continue;
          trunks.push({ x, z, scale });
          crowns.push({ x, z, scale });
        }
        const rockCount = 1 + Math.floor(tileSeed(tx, tz, 99) * 2);
        for (let i = 0; i < rockCount; i++) {
          const sx = tileSeed(tx, tz, 200 + i * 2);
          const sz = tileSeed(tx, tz, 201 + i * 2);
          const x = ox + (sx - 0.5) * (ts - 3);
          const z = oz + (sz - 0.5) * (ts - 3);
          if (Math.hypot(x, z) < 6) continue;
          if (nearBuilding(x, z, 7)) continue;
          const sc = 0.6 + tileSeed(tx, tz, 300 + i) * 1.4;
          rocks.push({ x, z, scale: sc, rot: sx * 2 });
        }
      }
    }

    const trunkIM = new THREE.InstancedMesh(trunkGeo, trunkMat, trunks.length);
    const crownIM = new THREE.InstancedMesh(crownGeo, crownMat, crowns.length);
    trunkIM.castShadow = this.gfx.shadows;
    crownIM.castShadow = this.gfx.shadows;
    trunks.forEach((t, i) => {
      dummy.position.set(t.x, 2.75 * t.scale, t.z);
      dummy.scale.setScalar(t.scale);
      dummy.updateMatrix();
      trunkIM.setMatrixAt(i, dummy.matrix);
    });
    crowns.forEach((t, i) => {
      dummy.position.set(t.x, 5.2 * t.scale, t.z);
      dummy.scale.setScalar(t.scale);
      dummy.updateMatrix();
      crownIM.setMatrixAt(i, dummy.matrix);
    });
    trunkIM.instanceMatrix.needsUpdate = true;
    crownIM.instanceMatrix.needsUpdate = true;
    this.treeGroup.add(trunkIM);
    this.treeGroup.add(crownIM);

    const rockIM = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    rockIM.castShadow = this.gfx.shadows;
    rocks.forEach((r, i) => {
      dummy.position.set(r.x, 0.4 * r.scale, r.z);
      dummy.scale.setScalar(r.scale);
      dummy.rotation.set(r.rot, r.rot * 1.5, 0);
      dummy.updateMatrix();
      rockIM.setMatrixAt(i, dummy.matrix);
    });
    rockIM.instanceMatrix.needsUpdate = true;
    this.rockGroup.add(rockIM);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /** Update or create remote player mesh + name tag */
  syncRemotePlayer(uid, data, myUid) {
    if (uid === myUid) return;
    let mesh = this.remoteMeshes[uid];
    if (!mesh && this.playerTemplate) {
      mesh = skeletonClone(this.playerTemplate);
      mesh.traverse((c) => {
        if (c.isMesh && c.material) c.material = c.material.clone();
      });
      this.scene.add(mesh);
      mesh.userData.anim = this._setupAnimated(mesh, this.playerAnimations, 'Idle');
      this.remoteMeshes[uid] = mesh;
      this._attachNameTag(mesh, data.name || 'Player', 'p-' + uid);
    }
    if (!mesh) return;
    const footY = (data.footY != null)
      ? data.footY
      : ((data.y || 1.7) - 1.7);
    mesh.position.set(data.x, footY, data.z);
    mesh.rotation.y = data.yaw || 0;
    mesh.visible = data.alive !== false;
    if (mesh.userData.anim) {
      const clip =
        data.moveState === 'run' ? 'Run' : data.moveState === 'walk' ? 'Walk' : 'Idle';
      this._playAction(mesh.userData.anim, clip);
    }
    const spr = this.nameSprites.get('p-' + uid);
    if (spr) this._updateNameSprite(spr, data.name || 'Player');
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
      }
    }
  }

  applyDayLighting(light) {
    if (!light) return;
    // Skip if same key already applied (progress quantized)
    const key = light._key || 0;
    if (key && key === this._lastLightKey && this._lastRainLit === this._rainOn) return;
    this._lastLightKey = key;
    this._lastRainLit = this._rainOn;

    const rainDim = this._rainOn ? 0.72 : 1;
    if (this.ambientLight) {
      this.ambientLight.color.setHex(light.ambient);
      this.ambientLight.intensity = light.ambientInt * rainDim;
    }
    if (this.sunLight) {
      this.sunLight.color.setHex(light.sun);
      this.sunLight.intensity = light.sunInt * rainDim;
      const h = 18 + light.sunInt * 52;
      this.sunLight.position.set(45, h, 25);
      // Cooler directional fill at night
      if (light.sunInt < 0.25) {
        this.sunLight.color.offsetHSL(0.05, -0.1, 0);
      }
    }
    if (this.scene.fog) {
      this.scene.fog.color.setHex(light.fog);
      // Rain: denser fog but clamped so flashlight still readable
      const dens = light.fogDensity * (this._rainOn ? 1.35 : 1);
      this.scene.fog.density = Math.min(0.045, dens);
    }
    this.renderer.setClearColor(light.clear);
    if (this.scene.background && this.scene.background.isColor) {
      this.scene.background.setHex(light.clear);
    }
  }


  render(state, eye, yaw, pitch, dt = 0) {
    for (const mixer of this.mixers) mixer.update(dt || 0);
    this._updateThrowables(dt || 0);

    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = pitch;

    // Flashlight follows look direction
    if (this.flashlight) {
      const on = !!(state.player && state.player.flashlight);
      // High intensity to cut through fog + dark materials
      this.flashlight.intensity = on ? (this._rainOn ? 14 : 11) : 0;
      this.flashlight.distance = 50;
      this.flashlight.position.copy(this.camera.position);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.flashlightTarget.position.copy(this.camera.position).addScaledVector(dir, 18);
      this.flashlight.target.updateMatrixWorld();
      if (this.flashlightFill) {
        this.flashlightFill.intensity = on ? 2.5 : 0;
        this.flashlightFill.position.copy(this.camera.position);
      }
    }

    state.monsters.forEach((mon, i) => {
      const mesh = this.monsterMeshes[i];
      if (!mesh) return;
      mesh.position.set(mon.position.x, mon.position.y || 0, mon.position.z);
      mesh.rotation.y = mon.rotation.yaw;
      if (mesh.userData.anim) {
        if ((mon.attackCooldown || 0) > 0.9) this._playAction(mesh.userData.anim, 'Attack', true);
        else if (mon.aiState === 'CHASE') this._playAction(mesh.userData.anim, 'Chase');
        else if (mon.aiState === 'INVESTIGATE' || mon.aiState === 'SEARCH') this._playAction(mesh.userData.anim, 'Chase');
        else this._playAction(mesh.userData.anim, 'Patrol');
      }
      const label = mon.aiState === 'CHASE' ? '!!!' : mon.aiState === 'PATROL' ? '…' : '?';
      const spr = this.nameSprites.get('monster-' + i);
      if (spr) this._updateNameSprite(spr, label);
    });

    this._updateRain(dt || 0, this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
