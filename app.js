// fractal-terrain: procedural heightfield generator, v1
// Two classic generators: fractal value noise (fBm / ridged, the Terragen lineage)
// and diamond-square midpoint displacement (the recursive-subdivision approach).
// Self-contained: vendored three.js module, no OrbitControls addon (custom orbit below).
import * as THREE from './vendor/three/three.module.min.js';

const SEGS = 256;               // 257x257 vertices: matches diamond-square's 2^n+1
const SIZE = 100;               // world units per side
const WATER = 0x1a4a66;

// ---------- deterministic noise ----------

function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) { return t * t * (3 - 2 * t); }

// value noise: smooth-interpolated random lattice, in [-1, 1]
function valueNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = smooth(fx), sy = smooth(fy);
  const a = hash2(ix, iy, seed),     b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return 2 * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) - 1;
}

// fractal Brownian motion: octaves of value noise, halving amplitude
// mode 'fbm' sums raw noise; mode 'ridged' folds it into sharp crests (Musgrave-style)
function fbm(u, v, octaves, seed, mode) {
  let amp = 1, freq = 1.6, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = valueNoise(u * freq, v * freq, seed + o * 1013);
    if (mode === 'ridged') { n = 1 - Math.abs(n); n *= n; }
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return sum / norm;   // roughly [0,1] for ridged, [-1,1] for fbm
}

// diamond-square on a (2^n+1) grid: the classic recursive midpoint displacement
function diamondSquare(n, seed) {
  const size = Math.pow(2, n) + 1;
  const g = new Float32Array(size * size);
  let rng = seed;
  const rand = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) | 0;
    return ((rng >>> 0) / 4294967296) * 2 - 1;
  };
  const at = (x, y) => g[y * size + x];
  const set = (x, y, v) => { g[y * size + x] = v; };

  set(0, 0, rand()); set(size - 1, 0, rand());
  set(0, size - 1, rand()); set(size - 1, size - 1, rand());

  let step = size - 1, scale = 0.55;
  while (step > 1) {
    const half = step >> 1;
    for (let y = half; y < size - 1; y += step)          // diamond step
      for (let x = half; x < size - 1; x += step)
        set(x, y, (at(x - half, y - half) + at(x + half, y - half) +
                   at(x - half, y + half) + at(x + half, y + half)) / 4 + rand() * scale);
    for (let y = 0; y < size; y += half)                 // square step
      for (let x = (y / half) % 2 ? step : half; x < size; x += step) {
        let sum = 0, cnt = 0;
        if (x - half >= 0)     { sum += at(x - half, y); cnt++; }
        if (x + half < size)   { sum += at(x + half, y); cnt++; }
        if (y - half >= 0)     { sum += at(x, y - half); cnt++; }
        if (y + half < size)   { sum += at(x, y + half); cnt++; }
        set(x, y, sum / cnt + rand() * scale);
      }
    step = half;
    scale *= 0.55;
  }
  // normalize to [0,1]
  let lo = Infinity, hi = -Infinity;
  for (const v of g) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const r = hi - lo || 1;
  for (let i = 0; i < g.length; i++) g[i] = (g[i] - lo) / r;
  return { grid: g, size };
}

// ---------- heightfield construction ----------

function buildHeights(p) {
  const n = SEGS + 1;
  const h = new Float32Array(n * n);
  if (p.algo === 'ds') {
    h.set(diamondSquare(8, p.seed).grid);          // 2^8+1 = 257, exactly our grid
    return h;
  }
  // island falloff: fade height toward edges so low sea values give an island silhouette
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / SEGS, v = y / SEGS;
      let f = fbm(u * 3, v * 3, p.octaves, p.seed, p.algo);
      if (p.algo === 'fbm') f = f * 0.5 + 0.5;     // shift to [0,1]
      const dx = u - 0.5, dy = v - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;  // 0 center → ~1.4 corner
      const mask = Math.max(0, 1 - Math.pow(d, 3));
      f *= 1 - p.land + p.land * mask;             // blend: 0=endless terrain, 1=island
      h[y * n + x] = f;
    }
  }
  return h;
}

// height-band colormap: deep water handled by the sea plane, these are land bands
const BANDS = [
  [0.00, 0x8a7a5a],  // submerged sand
  [0.30, 0xc2b280],  // beach
  [0.38, 0x4e7d3a],  // grass
  [0.62, 0x6e6a5e],  // rock
  [0.82, 0xb9b4a8],  // scree
  [0.94, 0xf4f6f8],  // snow
];

function bandColor(t, out) {
  let i = 0;
  while (i < BANDS.length - 2 && t > BANDS[i + 1][0]) i++;
  const [t0, c0] = BANDS[i], [t1, c1] = BANDS[i + 1];
  const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const r0 = (c0 >> 16) & 255, g0 = (c0 >> 8) & 255, b0 = c0 & 255;
  const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
  out[0] = (r0 + (r1 - r0) * f) / 255;
  out[1] = (g0 + (g1 - g0) * f) / 255;
  out[2] = (b0 + (b1 - b0) * f) / 255;
}

// ---------- scene ----------

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));   // mobile-first: cap DPR

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c121a);
scene.fog = new THREE.Fog(0x0c121a, 140, 320);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);

scene.add(new THREE.HemisphereLight(0xbfd4e8, 0x2a2418, 1.1));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
sun.position.set(60, 90, 30);
scene.add(sun);

const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const terrain = new THREE.Mesh(
  new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS), terrainMat);
terrain.rotation.x = -Math.PI / 2;
scene.add(terrain);

const seaMat = new THREE.MeshLambertMaterial({
  color: WATER, transparent: true, opacity: 0.85 });
const sea = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 1.6, SIZE * 1.6), seaMat);
sea.rotation.x = -Math.PI / 2;
scene.add(sea);

// ---------- rebuild ----------

const params = { algo: 'fbm', seed: 1, height: 18, octaves: 5, sea: 30,
                 land: 1.0, wire: true, colors: true };

const TITLES = { fbm: 'fractal noise', ridged: 'ridged multifractal',
                 ds: 'diamond-square' };

function rebuild() {
  const heights = buildHeights(params);
  const pos = terrain.geometry.attributes.position;
  const n = SEGS + 1;
  const rgb = [0, 0, 0];
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const h = heights[i];
    pos.setZ(i, h * params.height);
    if (params.colors) {
      bandColor(h, rgb);
      // tiny per-vertex jitter so bands don't look like flat paint
      const j = 0.92 + 0.16 * hash2(i % n, (i / n) | 0, params.seed + 7777);
      colors[i * 3]     = Math.min(1, rgb[0] * j);
      colors[i * 3 + 1] = Math.min(1, rgb[1] * j);
      colors[i * 3 + 2] = Math.min(1, rgb[2] * j);
    } else {
      colors[i * 3] = 0.62; colors[i * 3 + 1] = 0.72; colors[i * 3 + 2] = 0.58;
    }
  }
  terrain.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  pos.needsUpdate = true;
  terrain.geometry.computeVertexNormals();
  terrainMat.wireframe = params.wire;
  sea.position.y = (params.sea / 100) * params.height - 0.05;
}

// ---------- UI ----------

const $ = id => document.getElementById(id);
const on = (id, ev, fn) => $(id).addEventListener(ev, fn);

function bindRange(id, key, scale = 1) {
  on(id, 'input', e => {
    params[key] = +e.target.value * scale;
    $(id + '-val').textContent = e.target.value;
    rebuild();
  });
}
bindRange('height', 'height');
bindRange('detail', 'octaves');
bindRange('sea', 'sea');
bindRange('land', 'land', 0.01);   // slider 0-100 → 0-1

on('algo', 'change', e => {
  params.algo = e.target.value;
  $('algo-title').textContent = TITLES[params.algo];
  rebuild();
});
on('seed', 'change', e => { params.seed = +e.target.value | 0; rebuild(); });
on('reseed', 'click', () => {
  params.seed = (Math.random() * 1e6) | 0;
  $('seed').value = params.seed;
  rebuild();
});
on('wire', 'change', e => { params.wire = e.target.checked; rebuild(); });
on('colors', 'change', e => { params.colors = e.target.checked; rebuild(); });

// ---------- URL params: shareable links, e.g. ?algo=ridged&land=0&seed=42 ----------

(function applyUrlParams() {
  const q = new URLSearchParams(location.search);
  if (q.get('ui') === '0') {
    $('panel').style.display = 'none';
    $('title').style.display = 'none';
    $('src').style.display = 'none';
  }
  const set = (id, key, scale = 1) => {
    const v = q.get(id);
    if (v === null) return;
    params[key] = +v * scale;
    const el = $(id);
    if (el.type === 'range') { el.value = v; $(id + '-val').textContent = v; }
    else if (el.type === 'checkbox') el.checked = params[key] > 0;
    else el.value = v;
  };
  if (q.get('algo') && TITLES[q.get('algo')]) {
    params.algo = q.get('algo');
    $('algo').value = params.algo;
    $('algo-title').textContent = TITLES[params.algo];
  }
  set('seed', 'seed');
  set('height', 'height');
  set('detail', 'octaves');
  set('sea', 'sea');
  set('land', 'land', 0.01);
  set('wire', 'wire');
  set('colors', 'colors');
})();

// ---------- export ----------

on('export', 'click', () => {
  const heights = buildHeights(params);
  const n = SEGS + 1;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < heights.length; i++) {
    const v = Math.round(Math.max(0, Math.min(1, heights[i])) * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = `heightmap_${params.algo}_seed${params.seed}.png`;
  a.click();
});

// ---------- orbit controls (drag / wheel / pinch: no addon needed) ----------

const orbit = { theta: -0.7, phi: 0.95, r: 120 };
const target = new THREE.Vector3(0, 6, 0);
const pointers = new Map();
let pinchDist = 0;

canvas.addEventListener('pointerdown', e => {
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 1) {
    orbit.theta -= (e.clientX - prev[0]) * 0.006;
    orbit.phi = THREE.MathUtils.clamp(orbit.phi - (e.clientY - prev[1]) * 0.006, 0.15, 1.5);
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinchDist) orbit.r = THREE.MathUtils.clamp(orbit.r * pinchDist / d, 30, 300);
    pinchDist = d;
  }
});
const release = e => { pointers.delete(e.pointerId); pinchDist = 0; };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  orbit.r = THREE.MathUtils.clamp(orbit.r * (1 + Math.sign(e.deltaY) * 0.1), 30, 300);
}, { passive: false });

// ---------- resize + render loop ----------

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function frame() {
  const sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
  camera.position.set(
    target.x + orbit.r * sp * Math.sin(orbit.theta),
    target.y + orbit.r * cp,
    target.z + orbit.r * sp * Math.cos(orbit.theta));
  camera.lookAt(target);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

rebuild();
frame();
