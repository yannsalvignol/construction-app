// CASPROD landing — hero scene (three.js r170, vendored) + page interactions.
//
// The hero is a stylised construction site: a tower of blocks that assembles
// as the visitor scrolls, a slowly turning crane, the Level Mark logo hovering
// over the finished building, dust in the light. Everything is procedural —
// no models to download. Degrades to a CSS gradient when WebGL is missing and
// to a static, fully built scene under prefers-reduced-motion.

import * as THREE from '/vendor/three.module.min.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = matchMedia('(pointer: coarse)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

// ---------------------------------------------------------------------------
// Hero scene
// ---------------------------------------------------------------------------
function initScene() {
  const hero = document.getElementById('hero');
  const stage = hero.querySelector('.hero__stage');
  const canvas = document.getElementById('scene');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    hero.classList.add('no-webgl');
    return;
  }
  const isMobile = coarsePointer || innerWidth < 900;
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const BG = new THREE.Color('#0f0c17');
  const scene = new THREE.Scene();
  scene.background = BG;
  scene.fog = new THREE.Fog(BG, 22, 48);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);

  // ----- lights
  scene.add(new THREE.HemisphereLight('#9d8cc7', '#0f0c17', 0.9));
  const sun = new THREE.DirectionalLight('#fff4e6', 2.6);
  sun.position.set(7, 14, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -11;
  sun.shadow.camera.right = sun.shadow.camera.top = 11;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const fill = new THREE.PointLight('#854cdb', 40, 24, 1.6);
  fill.position.set(-4, 3.5, 5);
  scene.add(fill);
  const rim = new THREE.PointLight('#3ddc97', 12, 18, 2);
  rim.position.set(5, 2, -6);
  scene.add(rim);

  // ----- ground: shadow-catching plane + procedural blueprint grid on top
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshStandardMaterial({ color: '#15111d', roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color('#b18cf0') }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vPos; void main(){ vPos = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos,1.0); }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uTime; varying vec3 vPos;
        float line(vec2 p, float size){ vec2 g = abs(fract(p / size - 0.5) - 0.5) / fwidth(p / size); return 1.0 - min(min(g.x, g.y), 1.0); }
        void main(){
          vec2 p = vPos.xz;
          float minor = line(p, 1.0) * 0.35;
          float major = line(p, 5.0) * 0.9;
          float d = length(p);
          float fade = smoothstep(26.0, 6.0, d);
          // a slow radar sweep so the site never feels frozen
          float ring = smoothstep(0.35, 0.0, abs(d - mod(uTime * 2.2, 30.0))) * 0.35 * smoothstep(30.0, 0.0, d);
          float a = (max(minor, major) * fade + ring) * 0.9;
          gl_FragColor = vec4(uColor, a);
        }`,
    })
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0.012;
  scene.add(grid);

  // ----- the building: a tower of blocks, mid-construction
  const FLOORS = 6, N = 4, STEP = 1.06, SIZE = 0.94;
  const plan = [];
  const keep = (f, x, z) => {
    if (f < 3) return true;                       // full lower floors
    if (f === 3) return !(x === 3 && z === 3);    // one block short
    if (f === 4) return x < 3 && !(x === 2 && z === 3);
    return x < 2 && z < 3;                        // top floor barely started
  };
  for (let f = 0; f < FLOORS; f++) for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) if (keep(f, x, z)) plan.push({ f, x, z });
  const rand = (seed) => { const s = Math.sin(seed * 9301 + 49297) * 233280; return s - Math.floor(s); };
  const blocks = plan.map((b, i) => ({
    ...b,
    delay: (b.f / FLOORS) * 0.8 + rand(i) * 0.12,
    glass: rand(i + 777) < 0.22 && b.f > 0,
    spin: (rand(i + 99) - 0.5) * 1.2,
    px: (b.x - (N - 1) / 2) * STEP,
    pz: (b.z - (N - 1) / 2) * STEP,
    py: b.f * STEP + SIZE / 2 + 0.16,
  }));
  const solidBlocks = blocks.filter((b) => !b.glass), glassBlocks = blocks.filter((b) => b.glass);
  const boxGeo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);

  const solid = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.08 }), solidBlocks.length);
  solid.castShadow = solid.receiveShadow = true;
  const palette = ['#efe6ff', '#e6dcff', '#d9c8ff', '#b18cf0', '#854cdb', '#5d2bb0', '#f7f2ff'];
  solidBlocks.forEach((b, i) => solid.setColorAt(i, new THREE.Color(palette[Math.floor(rand(i + 31) * palette.length)])));
  solid.instanceColor.needsUpdate = true;
  scene.add(solid);

  const glassMat = isMobile
    ? new THREE.MeshStandardMaterial({ color: '#c9b3ff', transparent: true, opacity: 0.55, roughness: 0.2, metalness: 0.1 })
    : new THREE.MeshPhysicalMaterial({ color: '#d7c6ff', transmission: 0.75, thickness: 0.8, roughness: 0.12, metalness: 0, ior: 1.4, transparent: true, opacity: 0.9 });
  const glass = new THREE.InstancedMesh(boxGeo, glassMat, Math.max(1, glassBlocks.length));
  glass.count = glassBlocks.length;
  glass.castShadow = true;
  scene.add(glass);

  // base slab under the tower
  const slab = new THREE.Mesh(new THREE.BoxGeometry(N * STEP + 1.2, 0.18, N * STEP + 1.2), new THREE.MeshStandardMaterial({ color: '#241b35', roughness: 0.9 }));
  slab.position.y = 0.09; slab.receiveShadow = true; slab.castShadow = true;
  scene.add(slab);

  // ----- crane
  const crane = new THREE.Group();
  crane.position.set(4.6, 0, -3.8);
  crane.rotation.y = Math.PI;
  const craneMat = new THREE.MeshStandardMaterial({ color: '#e9e0ff', roughness: 0.5, metalness: 0.15 });
  const accentMat = new THREE.MeshStandardMaterial({ color: '#854cdb', roughness: 0.4, metalness: 0.2 });
  const addBox = (parent, w, h, d, x, y, z, mat = craneMat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  addBox(crane, 1.4, 0.3, 1.4, 0, 0.15, 0, accentMat);
  const MAST = 9.5;
  addBox(crane, 0.34, MAST, 0.34, 0, MAST / 2 + 0.3, 0);
  for (let y = 1; y < MAST; y += 1.1) addBox(crane, 0.5, 0.05, 0.5, 0, y + 0.3, 0, accentMat);
  const top = new THREE.Group(); top.position.y = MAST + 0.3; crane.add(top);
  addBox(top, 0.7, 0.6, 0.7, 0, 0.3, 0, accentMat);                 // slewing unit
  const JIB = 8.5;
  addBox(top, JIB, 0.2, 0.28, JIB / 2 - 0.3, 0.65, 0);               // jib
  addBox(top, 2.6, 0.2, 0.28, -1.6, 0.65, 0);                        // counter jib
  addBox(top, 0.8, 0.7, 0.8, -2.5, 0.35, 0, accentMat);              // counterweight
  addBox(top, 0.6, 0.55, 0.7, 0.55, 0.28, 0.55, accentMat);          // cab
  addBox(top, 0.12, 1.6, 0.12, 0, 1.4, 0);                           // tower peak
  const cableMat = new THREE.LineBasicMaterial({ color: '#cfc2ea', transparent: true, opacity: 0.8 });
  const tie = (a, b) => top.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), cableMat));
  tie(new THREE.Vector3(0, 2.2, 0), new THREE.Vector3(JIB - 0.5, 0.75, 0));
  tie(new THREE.Vector3(0, 2.2, 0), new THREE.Vector3(-2.7, 0.75, 0));
  const trolley = new THREE.Group(); top.add(trolley);
  addBox(trolley, 0.4, 0.14, 0.4, 0, 0.5, 0, accentMat);
  const hookLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.45, 0), new THREE.Vector3(0, -3, 0)]), cableMat);
  trolley.add(hookLine);
  const hook = new THREE.Group(); trolley.add(hook);
  addBox(hook, 0.3, 0.3, 0.3, 0, 0, 0, accentMat);
  const carried = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: '#b18cf0', roughness: 0.42 }));
  carried.position.y = -0.62; carried.castShadow = true; hook.add(carried);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), new THREE.MeshStandardMaterial({ color: '#ff3b5c', emissive: '#ff3b5c', emissiveIntensity: 2 }));
  beacon.position.y = 2.3; top.add(beacon);
  const beaconLight = new THREE.PointLight('#ff3b5c', 6, 6, 2); beaconLight.position.copy(beacon.position); top.add(beaconLight);
  scene.add(crane);

  // ----- Level Mark: the logo as a floating object over the finished tower
  const mark = new THREE.Group();
  const pill = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 2.3, 8, 28), new THREE.MeshStandardMaterial({ color: '#171221', roughness: 0.28, metalness: 0.55 }));
  pill.rotation.z = Math.PI / 2; pill.castShadow = true; mark.add(pill);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 24), new THREE.MeshStandardMaterial({ color: '#f7f2ff', emissive: '#b18cf0', emissiveIntensity: 1.6, roughness: 0.2 }));
  bubble.position.z = 0.22; mark.add(bubble);
  const markLight = new THREE.PointLight('#b18cf0', 16, 8, 2); mark.add(markLight);
  mark.position.set(0, FLOORS * STEP + 2.0, 0);
  mark.scale.setScalar(0.0001);
  scene.add(mark);

  // ----- dust
  const DUST = isMobile ? 220 : 520;
  const dustPos = new Float32Array(DUST * 3), dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) { dustPos[i * 3] = (Math.random() - 0.5) * 22; dustPos[i * 3 + 1] = Math.random() * 10; dustPos[i * 3 + 2] = (Math.random() - 0.5) * 22; dustSeed[i] = Math.random() * 100; }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const spriteCanvas = document.createElement('canvas'); spriteCanvas.width = spriteCanvas.height = 64;
  const g = spriteCanvas.getContext('2d'); const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(230,214,255,.6)'); grad.addColorStop(1, 'rgba(230,214,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.16, map: new THREE.CanvasTexture(spriteCanvas), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  scene.add(dust);

  // ----- HUD anchors (3D points projected to the labels in the DOM)
  const huds = [
    { el: stage.querySelector('.hud--a'), at: new THREE.Vector3(N * STEP / 2 + 0.6, 0.2, N * STEP / 2 + 0.6), from: 0.28 },
    { el: stage.querySelector('.hud--b'), at: new THREE.Vector3(N * STEP / 2 + 0.6, 3 * STEP + 0.6, -N * STEP / 2), from: 0.62 },
    { el: stage.querySelector('.hud--c'), at: new THREE.Vector3(-0.5, FLOORS * STEP + 0.4, N * STEP / 2 + 0.4), from: 0.94 },
  ];

  // ----- state
  const dummy = new THREE.Object3D();
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let scrollP = 0, introStart = performance.now(), built = false, visible = true, needsFrame = true;
  const targetV = new THREE.Vector3();

  function layoutBlocks(p) {
    const place = (mesh, list) => {
      list.forEach((b, i) => {
        const t = clamp((p - b.delay) / 0.16, 0, 1);
        const e = easeOutBack(t);
        const drop = (1 - easeOutCubic(t)) * 7;
        dummy.position.set(b.px, b.py + drop, b.pz);
        dummy.rotation.set(0, b.spin * (1 - t), 0);
        dummy.scale.setScalar(Math.max(0.0001, e));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(solid, solidBlocks); place(glass, glassBlocks);
  }

  function updateCamera(p, time) {
    const wide = camera.aspect > 1.05;
    // Orbit: azimuth swings ~30° over the scroll, elevation eases down, and
    // the target climbs with the tower so the finished building stays framed.
    const az = 0.72 + p * 0.55 + pointer.x * 0.07;
    const elev = lerp(0.42, 0.36, p) + pointer.y * 0.04;
    const r = lerp(20, 19, easeOutCubic(p));
    const ty = lerp(1.6, 4.6, easeOutCubic(p));
    targetV.set(wide ? -3.3 : 0, ty, 0);
    camera.position.set(targetV.x + r * Math.cos(elev) * Math.sin(az), ty + r * Math.sin(elev), targetV.z + r * Math.cos(elev) * Math.cos(az));
    camera.lookAt(targetV);
    if (!reduceMotion) camera.position.y += Math.sin(time * 0.4) * 0.05;
  }

  function projectHUD(p) {
    const w = stage.clientWidth, h = stage.clientHeight;
    for (const hud of huds) {
      const on = p >= hud.from;
      hud.el.classList.toggle('is-on', on);
      if (!on) continue;
      const v = hud.at.clone().project(camera);
      hud.el.style.left = ((v.x + 1) / 2) * w + 34 + 'px';
      hud.el.style.top = ((1 - v.y) / 2) * h + 'px';
    }
  }

  function frame(now) {
    if (reduceMotion) return; // static scene is drawn from resize()
    if (!visible || document.hidden) { needsFrame = true; return; }
    requestAnimationFrame(frame);
    const time = now / 1000;
    const intro = reduceMotion ? 1 : easeOutCubic(clamp((now - introStart) / 2600, 0, 1));
    const p = reduceMotion ? 1 : Math.max(intro * 0.42, scrollP);

    pointer.x = lerp(pointer.x, pointer.tx, 0.06);
    pointer.y = lerp(pointer.y, pointer.ty, 0.06);

    layoutBlocks(p);
    updateCamera(p, time);

    if (!reduceMotion) {
      grid.material.uniforms.uTime.value = time;
      top.rotation.y = Math.sin(time * 0.18) * 0.8 - 0.4;
      trolley.position.x = 3.2 + Math.sin(time * 0.35) * 2.3;
      hook.position.y = -1.4 - Math.sin(time * 0.5) * 0.6;
      hookLine.geometry.attributes.position.setY(1, hook.position.y);
      hookLine.geometry.attributes.position.needsUpdate = true;
      const blink = (Math.sin(time * 3) > 0.6) ? 2.4 : 0.15;
      beacon.material.emissiveIntensity = blink; beaconLight.intensity = blink * 2.5;

      const pos = dust.geometry.attributes.position;
      for (let i = 0; i < DUST; i++) {
        let y = pos.getY(i) + 0.004 + Math.sin(dustSeed[i] + time) * 0.0015;
        if (y > 10) y = 0;
        pos.setY(i, y);
        pos.setX(i, pos.getX(i) + Math.sin(time * 0.3 + dustSeed[i]) * 0.0015);
      }
      pos.needsUpdate = true;
      dust.rotation.y = time * 0.01;
    }

    const markT = easeOutBack(clamp((p - 0.86) / 0.14, 0, 1));
    mark.scale.setScalar(Math.max(0.0001, markT));
    mark.position.y = FLOORS * STEP + 2.0 + (reduceMotion ? 0 : Math.sin(time * 1.1) * 0.18);
    mark.rotation.y = reduceMotion ? 0.3 : time * 0.35;
    mark.rotation.x = reduceMotion ? 0 : Math.sin(time * 0.6) * 0.12;
    bubble.material.emissiveIntensity = 1.2 + Math.sin(time * 2) * 0.5;

    if (!built && p >= 0.999) { built = true; hero.classList.add('is-built'); }
    projectHUD(p);
    renderer.render(scene, camera);
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.8 ? 46 : camera.aspect < 1.05 ? 36 : 30;
    camera.updateProjectionMatrix();
    if (reduceMotion) { layoutBlocks(1); updateCamera(1, 0); mark.scale.setScalar(1); projectHUD(1); renderer.render(scene, camera); }
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  const onScroll = () => { scrollP = clamp(scrollY / (hero.offsetHeight - stage.offsetHeight), 0, 1); };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (!coarsePointer && !reduceMotion) {
    addEventListener('pointermove', (e) => { pointer.tx = (e.clientX / innerWidth - 0.5) * 2; pointer.ty = (e.clientY / innerHeight - 0.5) * 2; }, { passive: true });
  }

  // Only render while the hero is on screen and the tab is visible.
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && needsFrame) { needsFrame = false; requestAnimationFrame(frame); }
  }, { threshold: 0 });
  io.observe(stage);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible && needsFrame) { needsFrame = false; requestAnimationFrame(frame); } });
  if (!reduceMotion) { needsFrame = false; requestAnimationFrame(frame); }
}

// ---------------------------------------------------------------------------
// Page interactions
// ---------------------------------------------------------------------------
function initPage() {
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('is-scrolled', scrollY > 24);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Fallbacks for browsers without scroll-driven animations.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in', 'is-drawn'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -12% 0px' });
  if (!CSS.supports('animation-timeline: view()')) {
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    document.querySelectorAll('.steps').forEach((el) => io.observe(el));
  }
}

initPage();
initScene();
