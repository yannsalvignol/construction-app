// CASPROD landing — hero scene (three.js r170, vendored) + page interactions.
//
// The hero is a building being *scanned into existence*: a monochrome
// wireframe tower whose edges materialise on their own after load, a scan
// plane that sweeps the structure and lights the edges it crosses, a
// tower crane drawn in the same thin lines, a low-contrast survey grid, and a
// sparse point field. Everything is procedural and drawn with two custom
// shaders (one for the edges, one for the faces), so the whole scene is a
// handful of draw calls. No WebGL → CSS grid fallback; reduced motion →
// static, fully built scene.

import * as THREE from '/vendor/three.module.min.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = matchMedia('(pointer: coarse)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// ---------------------------------------------------------------------------
// Hero scene
// ---------------------------------------------------------------------------
function initScene() {
  const hero = document.getElementById('hero');
  const stage = hero.querySelector('.hero__stage');
  const canvas = document.getElementById('scene');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  } catch {
    hero.classList.add('no-webgl');
    return;
  }
  const isMobile = coarsePointer || innerWidth < 900;
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setClearColor('#07080a', 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#07080a', 20, 46);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);

  // ----- survey grid on the ground: hairlines + a slow radial sweep
  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec3 vPos; void main(){ vPos = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos,1.0); }`,
      fragmentShader: `
        uniform float uTime; varying vec3 vPos;
        float line(vec2 p, float size){ vec2 g = abs(fract(p / size - 0.5) - 0.5) / fwidth(p / size); return 1.0 - min(min(g.x, g.y), 1.0); }
        void main(){
          vec2 p = vPos.xz;
          float minor = line(p, 1.0) * 0.16;
          float major = line(p, 5.0) * 0.42;
          float d = length(p);
          float fade = smoothstep(30.0, 4.0, d);
          float sweep = smoothstep(0.5, 0.0, abs(d - mod(uTime * 1.6, 34.0))) * 0.22 * smoothstep(34.0, 0.0, d);
          float a = max(minor, major) * fade + sweep;
          gl_FragColor = vec4(vec3(0.86, 0.88, 0.95), a);
        }`,
    })
  );
  grid.rotation.x = -Math.PI / 2;
  scene.add(grid);

  // ----- the building
  const FLOORS = 7, N = 4, STEP = 1.06, SIZE = 0.98;
  const keep = (f, x, z) => {
    if (f < 3) return true;
    if (f === 3) return !(x === 3 && z === 3);
    if (f === 4) return x < 3 && !(x === 2 && z === 3);
    if (f === 5) return x < 2 && z < 3;
    return x < 1 && z < 2;
  };
  const rand = (seed) => { const s = Math.sin(seed * 9301 + 49297) * 233280; return s - Math.floor(s); };
  const blocks = [];
  for (let f = 0; f < FLOORS; f++) for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) if (keep(f, x, z)) {
    const i = blocks.length;
    blocks.push({
      cx: (x - (N - 1) / 2) * STEP, cy: f * STEP + SIZE / 2 + 0.1, cz: (z - (N - 1) / 2) * STEP,
      delay: (f / FLOORS) * 0.82 + rand(i) * 0.1,
    });
  }
  const TOTAL = blocks.length;

  // Merge one box per block into a single geometry, tagging every vertex with
  // its block centre and build delay so a vertex shader can animate each block.
  function merged(source) {
    const pos = source.getAttribute('position');
    const per = pos.count;
    const out = new Float32Array(per * 3 * TOTAL), centers = new Float32Array(per * 3 * TOTAL), delays = new Float32Array(per * TOTAL);
    let idx = null;
    if (source.index) idx = new Uint32Array(source.index.count * TOTAL);
    blocks.forEach((b, k) => {
      for (let v = 0; v < per; v++) {
        const o = (k * per + v) * 3;
        out[o] = pos.getX(v) + b.cx; out[o + 1] = pos.getY(v) + b.cy; out[o + 2] = pos.getZ(v) + b.cz;
        centers[o] = b.cx; centers[o + 1] = b.cy; centers[o + 2] = b.cz;
        delays[k * per + v] = b.delay;
      }
      if (idx) for (let j = 0; j < source.index.count; j++) idx[k * source.index.count + j] = source.index.getX(j) + k * per;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
    geo.setAttribute('aCenter', new THREE.BufferAttribute(centers, 3));
    geo.setAttribute('aDelay', new THREE.BufferAttribute(delays, 1));
    if (idx) geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  }
  const box = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
  const edgesGeo = merged(new THREE.EdgesGeometry(box));
  const facesGeo = merged(box);

  const uniforms = { uProgress: { value: 0 }, uScan: { value: 0 }, uTime: { value: 0 } };
  const buildVertex = `
    attribute vec3 aCenter; attribute float aDelay;
    uniform float uProgress;
    varying float vT; varying float vY;
    float easeOut(float t){ return 1.0 - pow(1.0 - t, 3.0); }
    void main(){
      float t = clamp((uProgress - aDelay) / 0.14, 0.0, 1.0);
      float e = easeOut(t);
      vec3 p = aCenter + (position - aCenter) * mix(0.001, 1.0, e);
      p.y += (1.0 - e) * 6.0;
      vT = t; vY = p.y;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`;
  const edges = new THREE.LineSegments(edgesGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms,
    vertexShader: buildVertex,
    fragmentShader: `
      uniform float uScan; varying float vT; varying float vY;
      void main(){
        if (vT <= 0.0) discard;
        float base = 0.22;
        float band = smoothstep(0.9, 0.0, abs(vY - uScan)) * 0.9;    // edges lit by the scan plane
        float a = (base + band) * vT;
        vec3 c = mix(vec3(0.80, 0.83, 0.92), vec3(1.0), band);
        gl_FragColor = vec4(c, a);
      }`,
  }));
  scene.add(edges);
  const faces = new THREE.Mesh(facesGeo, new THREE.ShaderMaterial({
    transparent: true, uniforms, side: THREE.FrontSide,
    vertexShader: buildVertex,
    fragmentShader: `
      uniform float uScan; varying float vT; varying float vY;
      void main(){
        if (vT <= 0.0) discard;
        float band = smoothstep(1.4, 0.0, abs(vY - uScan)) * 0.10;
        gl_FragColor = vec4(vec3(0.05, 0.06, 0.08) + band, 0.92 * vT);
      }`,
  }));
  scene.add(faces);
  edges.renderOrder = 2; faces.renderOrder = 1;

  // scan plane: a thin translucent sheet sweeping the tower
  const scanPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(N * STEP + 2.6, N * STEP + 2.6),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; void main(){ float e = 1.0 - max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0; float edge = smoothstep(0.0, 0.06, e) * (1.0 - smoothstep(0.06, 0.12, e)); gl_FragColor = vec4(vec3(0.85, 0.88, 1.0), 0.05 + edge * 0.5); }`,
    })
  );
  scanPlane.rotation.x = -Math.PI / 2;
  scene.add(scanPlane);

  // ----- crane, in the same hairline language
  const lineMat = new THREE.LineBasicMaterial({ color: '#c9ceda', transparent: true, opacity: 0.55 });
  const dimMat = new THREE.LineBasicMaterial({ color: '#c9ceda', transparent: true, opacity: 0.28 });
  const wire = (parent, w, h, d, x, y, z, mat = lineMat) => { const m = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), mat); m.position.set(x, y, z); parent.add(m); return m; };
  const crane = new THREE.Group();
  crane.position.set(4.9, 0, -3.9); crane.rotation.y = Math.PI;
  wire(crane, 1.4, 0.3, 1.4, 0, 0.15, 0);
  const MAST = 10.5;
  wire(crane, 0.36, MAST, 0.36, 0, MAST / 2 + 0.3, 0);
  for (let y = 1; y < MAST; y += 1.05) wire(crane, 0.36, 0.001, 0.36, 0, y + 0.3, 0, dimMat);
  const top = new THREE.Group(); top.position.y = MAST + 0.3; crane.add(top);
  const JIB = 9;
  wire(top, 0.7, 0.6, 0.7, 0, 0.3, 0);
  wire(top, JIB, 0.22, 0.3, JIB / 2 - 0.3, 0.65, 0);
  wire(top, 2.8, 0.22, 0.3, -1.7, 0.65, 0);
  wire(top, 0.8, 0.7, 0.8, -2.6, 0.35, 0);
  wire(top, 0.6, 0.55, 0.7, 0.55, 0.28, 0.55);
  wire(top, 0.12, 1.7, 0.12, 0, 1.45, 0);
  const tie = (a, b) => top.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), dimMat));
  tie(new THREE.Vector3(0, 2.3, 0), new THREE.Vector3(JIB - 0.5, 0.76, 0));
  tie(new THREE.Vector3(0, 2.3, 0), new THREE.Vector3(-2.9, 0.76, 0));
  const trolley = new THREE.Group(); top.add(trolley);
  wire(trolley, 0.4, 0.14, 0.4, 0, 0.5, 0);
  const hookLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.45, 0), new THREE.Vector3(0, -2, 0)]), dimMat);
  trolley.add(hookLine);
  const hook = new THREE.Group(); trolley.add(hook);
  wire(hook, SIZE, SIZE, SIZE, 0, -0.5, 0);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  beacon.position.y = 2.35; top.add(beacon);
  scene.add(crane);

  // ----- point field
  const COUNT = isMobile ? 260 : 700;
  const pts = new Float32Array(COUNT * 3), seeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) { pts[i * 3] = (Math.random() - 0.5) * 30; pts[i * 3 + 1] = Math.random() * 12; pts[i * 3 + 2] = (Math.random() - 0.5) * 30; seeds[i] = Math.random() * 100; }
  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const points = new THREE.Points(pointGeo, new THREE.PointsMaterial({ color: '#dfe3ee', size: 0.035, transparent: true, opacity: 0.6, depthWrite: false, sizeAttenuation: true }));
  scene.add(points);

  // ----- HUD anchors
  const half = N * STEP / 2;
  const huds = [
    { el: stage.querySelector('.hud--a'), at: new THREE.Vector3(half + 0.3, 0.3, half + 0.3), from: 0.3 },
    { el: stage.querySelector('.hud--b'), at: new THREE.Vector3(half + 0.3, 3 * STEP + 0.5, -half), from: 0.62 },
    { el: stage.querySelector('.hud--c'), at: new THREE.Vector3(-half + 0.5, FLOORS * STEP + 0.3, half - 0.5), from: 0.96 },
  ];

  // ----- state
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const targetV = new THREE.Vector3();
  let introStart = performance.now(), built = false, visible = true, needsFrame = true;
  const BUILD_MS = 7000, BUILD_DELAY_MS = 600;

  function updateCamera(p, time) {
    const wide = camera.aspect > 1.05;
    const az = 0.7 + p * 0.5 + pointer.x * 0.06 + (reduceMotion ? 0 : time * 0.012);
    const elev = lerp(0.4, 0.34, p) + pointer.y * 0.04;
    const r = 21;
    const ty = lerp(1.8, 4.8, easeOutCubic(p));
    targetV.set(wide ? -3.4 : 0, ty, 0);
    camera.position.set(targetV.x + r * Math.cos(elev) * Math.sin(az), ty + r * Math.sin(elev), targetV.z + r * Math.cos(elev) * Math.cos(az));
    camera.lookAt(targetV);
  }

  function projectHUD(p) {
    const w = stage.clientWidth, h = stage.clientHeight;
    for (const hud of huds) {
      const on = p >= hud.from;
      hud.el.classList.toggle('is-on', on);
      if (!on) continue;
      const v = hud.at.clone().project(camera);
      hud.el.style.left = ((v.x + 1) / 2) * w + 36 + 'px';
      hud.el.style.top = ((1 - v.y) / 2) * h + 'px';
    }
  }

  function draw(p, time) {
    uniforms.uProgress.value = p;
    uniforms.uTime.value = time;
    const towerTop = FLOORS * STEP + 0.6;
    const scanY = reduceMotion ? towerTop * 0.55 : (Math.sin(time * 0.5) * 0.5 + 0.5) * towerTop;
    uniforms.uScan.value = scanY;
    scanPlane.position.y = scanY;
    grid.material.uniforms.uTime.value = time;
    updateCamera(p, time);
    projectHUD(p);
    renderer.render(scene, camera);
  }

  function frame(now) {
    if (reduceMotion) return;
    if (!visible || document.hidden) { needsFrame = true; return; }
    requestAnimationFrame(frame);
    const time = now / 1000;
    const p = clamp((now - introStart - BUILD_DELAY_MS) / BUILD_MS, 0, 1);

    pointer.x = lerp(pointer.x, pointer.tx, 0.05);
    pointer.y = lerp(pointer.y, pointer.ty, 0.05);

    top.rotation.y = Math.sin(time * 0.15) * 0.8 - 0.4;
    trolley.position.x = 3.4 + Math.sin(time * 0.3) * 2.4;
    hook.position.y = -1.6 - Math.sin(time * 0.45) * 0.7;
    hookLine.geometry.attributes.position.setY(1, hook.position.y - 0.5 + SIZE / 2);
    hookLine.geometry.attributes.position.needsUpdate = true;
    beacon.visible = Math.sin(time * 2.6) > 0.4;

    const pos = points.geometry.attributes.position;
    for (let i = 0; i < COUNT; i++) {
      let y = pos.getY(i) + 0.0025 + Math.sin(seeds[i] + time) * 0.001;
      if (y > 12) y = 0;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;

    if (!built && p >= 0.999) { built = true; hero.classList.add('is-built'); }
    draw(p, time);
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.8 ? 46 : camera.aspect < 1.05 ? 36 : 30;
    camera.updateProjectionMatrix();
    if (reduceMotion) draw(1, 0);
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  if (!coarsePointer && !reduceMotion) {
    addEventListener('pointermove', (e) => { pointer.tx = (e.clientX / innerWidth - 0.5) * 2; pointer.ty = (e.clientY / innerHeight - 0.5) * 2; }, { passive: true });
  }

  // Pause rendering off-screen; the build clock keeps running so a visitor who
  // scrolls back finds the structure further along, never rewound.
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

  if (!CSS.supports('animation-timeline: view()')) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  }
}

initPage();
initScene();
