// glass.js — the three.js enhancement layer.
//
// Architecture: the card's text + links are real DOM (card.js owns them).
// three.js does ONLY the glass: true translucency, refraction, edge-light,
// depth. Text is NEVER rendered as a WebGL texture. This module composites a
// transparent WebGL canvas *behind* the DOM card and mirrors the card's live
// pose (published on #card's dataset by card.js).
//
// The CSS glass in card.css is the guaranteed fallback: it renders on its own
// whenever WebGL/this module can't (no WebGL, reduced motion, load failure).
// When this module DOES take over it adds `webgl-glass` to <html>, and card.css
// dials its own frosted fill back so the WebGL refraction reads as the material
// while the DOM keeps only the framing edge + shadow for legibility.

import * as THREE from 'three';

const ENABLE_WEBGL_GLASS = true;

// The WebGL scene is modelled in CSS pixels so the glass slab registers 1:1 with
// the DOM card. PERSPECTIVE must equal card.css `perspective: 1600px` on
// .cardwrap: with the camera that far back and the fov solved so one world unit
// spans one screen pixel at the card plane, the WebGL projection matches the
// DOM's, and the same rest tilt lines the two up.
const PERSPECTIVE = 1600;
const CARD_RADIUS = 34; // matches .glass border-radius
// Opacity is REVERSED: the WebGL glass is off at rest (clean, legible card) and
// fades IN as the card deconstructs — the refractive glass is a reward for
// interacting. The accent edge stays at rest via the DOM border.
const REST_OPACITY = 0;       // glass off when the card sits at rest
// ...fades in to a per-theme peak at full deconstruct (see THEME_GLASS.boost):
// light goes fully opaque so CSS opacity doesn't grey the cream; dark stays
// translucent.

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

export async function initGlass() {
  const reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  const card = document.getElementById('card');
  const wrap = document.getElementById('cardwrap');
  if (!card || !wrap) return;

  // Fallback path: leave the CSS glass in charge and never load the pipeline.
  if (!ENABLE_WEBGL_GLASS || reduce || !hasWebGL()) return;

  // ---- canvas: sits BEHIND the DOM card (card.css lifts .card to z-index 1) ---
  const canvas = document.createElement('canvas');
  canvas.className = 'glass-gl';
  Object.assign(canvas.style, {
    position: 'absolute', zIndex: '0', pointerEvents: 'none',
    left: '0', top: '0', opacity: '0', // fades in only after the intro settles
  });
  // Prepend (not append) so the canvas is FIRST in the wrap and always paints
  // behind the .card regardless of z-index — the card's text must never sit
  // under the semi-transparent glass (that dims it). Robust against the
  // .webgl-glass class not being set.
  wrap.insertBefore(canvas, wrap.firstChild);

  // ---- renderer -------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // Khronos PBR Neutral: preserves hue + saturation accurately (ACES desaturated
  // the light theme's warm cream toward grey) while still tone-mapping highlights
  // so the glass keeps its dimensional thickness.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, PERSPECTIVE * 4);
  camera.position.z = PERSPECTIVE; // same eye distance as the CSS perspective

  // Transmission refracts the environment (built per-theme below); no external
  // HDR (the no-CDN rule).
  const pmrem = new THREE.PMREMGenerator(renderer);

  // ---- the glass slab (geometry rebuilt to the card's px box on resize) ----
  const material = buildGlassMaterial();
  const mesh = new THREE.Mesh(buildGlassGeo(1, 1), material);
  mesh.renderOrder = 1;
  scene.add(mesh);

  // A soft key light gives the frosted surface a moving highlight as it turns.
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(0.4, 0.7, 1).multiplyScalar(PERSPECTIVE);
  scene.add(key);

  // ---- theme-aware glass: dark obsidian in dark mode, light smoked glass in
  // light mode (so it never fades in as a muddy dark slab over the light card).
  // Tint + environment + absorption all switch with the theme. --------------
  const THEME_GLASS = {
    dark:  { tint: '#25120E', env: ['#08060A', '#1C110D', '#0E0908'], attenMul: 0.32, boost: 0.6, clearcoat: 0.9, key: '#ffffff' },
    light: { tint: '#F4E4C0', env: ['#FFF4DE', '#FBE2BA', '#FFEDD0'], attenMul: 0.9,  boost: 0, clearcoat: 0.3, key: '#FFEAD2' },
  };
  let attenMul = THEME_GLASS.dark.attenMul;         // read by resize()
  let explodeBoost = THEME_GLASS.dark.boost;        // read by the render loop
  let envTex = null;
  function isDarkTheme() {
    const a = document.documentElement.getAttribute('data-theme');
    return a ? a === 'dark' : window.matchMedia('(prefers-color-scheme:dark)').matches;
  }
  function applyTheme() {
    const dark = isDarkTheme();
    const cfg = THEME_GLASS[dark ? 'dark' : 'light'];
    material.attenuationColor.set(cfg.tint);
    attenMul = cfg.attenMul;
    explodeBoost = cfg.boost;
    material.clearcoat = cfg.clearcoat; // softer in light mode so the sheen isn't grey
    key.color.set(cfg.key);             // warm key light in light mode → cream sheen
    if (card.offsetHeight) material.attenuationDistance = card.offsetHeight * attenMul;
    const tex = pmrem.fromScene(buildEnvScene(cfg.env), 0.04).texture;
    if (envTex) envTex.dispose();
    envTex = tex;
    scene.environment = tex;
  }

  // ---- sizing: model the card's on-screen px box 1:1 in the scene ----------
  function resize() {
    // Use offset* (untransformed LAYOUT box), NOT getBoundingClientRect — the
    // latter returns the tilted 3D bounding box, which shifts the canvas off the
    // card. offsetLeft/Top are relative to the offsetParent (= cardwrap), so they
    // line up with the canvas, which is a child of the wrap.
    const cw = card.offsetWidth, ch = card.offsetHeight;
    if (!cw || !ch) return;
    // Oversize the canvas past the card so the edge-glow can bloom instead of
    // clipping; keep it centred on the card's layout box within the wrap. Because
    // both the DOM card and the slab rotate about that shared centre, the same
    // pose keeps them registered.
    const pad = Math.max(cw, ch) * 0.35;
    const w = cw + pad * 2;
    const h = ch + pad * 2;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.left = `${card.offsetLeft - pad}px`;
    canvas.style.top = `${card.offsetTop - pad}px`;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // fov so the frame spans exactly `h` px at the card plane (z = 0).
    camera.fov = 2 * Math.atan((h / 2) / PERSPECTIVE) * (180 / Math.PI);
    camera.updateProjectionMatrix();
    // Rebuild the slab at the card's pixel size (aspect is fixed, corners crisp).
    // Geometric depth (the visible edge thickness) is decoupled from the material
    // thickness so the slab thinness doesn't change the refraction/colour.
    const geoDepth = 15; // px — thin glass card
    mesh.geometry.dispose();
    mesh.geometry = buildGlassGeo(cw, ch, geoDepth);
    // Refraction params live in world (px) space; a gentle attenuation distance
    // keeps the tint translucent.
    material.thickness = Math.max(CARD_RADIUS * 2, ch * 0.1);
    // Absorption distance is theme-dependent (short = dark obsidian, long = light
    // smoked glass); attenMul is set by applyTheme().
    material.attenuationDistance = ch * attenMul;
  }
  applyTheme(); // set tint/env/attenMul before the first sizing + render
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  ro.observe(card);

  // Re-theme the glass when the toggle flips data-theme or the OS preference
  // changes (matches how tokens.css themes the DOM).
  new MutationObserver(applyTheme).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme'],
  });
  window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change', applyTheme);

  // ---- render loop: mirror the DOM card's live pose ------------------------
  // card.js only publishes rotx/roty to the dataset AFTER the intro tumble ends
  // (its apply() no-ops during the intro). So we treat "rotx is set" as the
  // ready signal: during the CSS intro the WebGL glass stays hidden and the CSS
  // glass tumbles with the DOM card as one piece; once the card settles we fade
  // the WebGL glass in and only then dial the CSS fill back — a crossfade, not a
  // static slab behind a tumbling card.
  const DEG = Math.PI / 180;
  function frame() {
    const ready = card.dataset.rotx !== undefined;
    const rx = parseFloat(card.dataset.rotx || '0') * DEG;
    const ry = parseFloat(card.dataset.roty || '0') * DEG;
    const explode = parseFloat(card.dataset.explode || '0');
    // CSS uses Y-down, three.js uses Y-up, so a CSS rotateX maps to the NEGATED
    // three rotation.x; rotateY keeps its sign. Without this the glass tilts the
    // opposite way in X and diverges from the DOM card (the "two cards" look).
    mesh.rotation.x = -rx;
    mesh.rotation.y = ry;
    // Target opacity: 0 until ready, then rest → fading IN with deconstruction.
    const target = ready ? Math.min(1, REST_OPACITY + explode * explodeBoost) : 0;
    const cur = parseFloat(canvas.style.opacity) || 0;
    const next = cur + (target - cur) * 0.12; // ~0.5s ease
    canvas.style.opacity = String(next);
    // Dial the CSS frost back to the scrim as soon as the pipeline is ready — not
    // tied to the WebGL opacity, which is ~0 at rest under the reversed scheme.
    if (ready && !document.documentElement.classList.contains('webgl-glass')) {
      document.documentElement.classList.add('webgl-glass');
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// A beveled slab sized to the card's px box. Depth is kept >= 2·radius so the
// rounded corners fit, and gives the glass a little real thickness to refract.
function buildGlassGeo(cardW, cardH, depth) {
  // A rounded-rectangle profile extruded to `depth` with a small edge bevel.
  // (RoundedBoxGeometry couples corner radius to depth, so a thin slab can't keep
  // the 34px corners — ExtrudeGeometry decouples them.)
  const r = Math.min(CARD_RADIUS, Math.min(cardW, cardH) / 2 - 1);
  const w = cardW, h = cardH, x0 = -w / 2, y0 = -h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x0 + w - r, y0);
  shape.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  shape.lineTo(x0 + w, y0 + h - r);
  shape.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  shape.lineTo(x0 + r, y0 + h);
  shape.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  shape.lineTo(x0, y0 + r);
  shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  const bevel = Math.min(depth * 0.25, 4);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(depth - bevel * 2, 1),
    bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: 16,
  });
  geo.translate(0, 0, -depth / 2); // centre the slab on z
  return geo;
}

// The refractive material: frosted glass tinted with the brand accent, with an
// accent fresnel glow riding the curved edges.
function buildGlassMaterial() {
  const accent = new THREE.Color('#FF6257');
  const tint = new THREE.Color('#25120E'); // deep warm-black smoked glass
  const mat = new THREE.MeshPhysicalMaterial({
    transmission: 1,        // fully see-through — real glass, not a tint
    roughness: 0.05,        // clear, not frosted
    ior: 1.46,              // ~ real glass
    metalness: 0,
    iridescence: 0.1,       // just a whisper of shimmer on the bevels
    iridescenceIOR: 1.3,
    clearcoat: 0.9,         // wet, glossy top coat
    clearcoatRoughness: 0.1,
    attenuationColor: tint, // dark absorptive tint (with a short distance in resize)
    envMapIntensity: 1.1,
    transparent: true,
    emissive: new THREE.Color(0x000000),
    // thickness + attenuationDistance are set per-size in resize() (px space).
  });

  // Accent edge-light: add an emissive fresnel rim so the accent glows along the
  // soft curved edges — brightest where the surface turns away.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uEdgeColor = { value: accent.clone() };
    shader.uniforms.uEdgePower = { value: 3.2 };
    shader.uniforms.uEdgeStrength = { value: 1.5 };
    shader.fragmentShader =
      'uniform vec3 uEdgeColor;\nuniform float uEdgePower;\nuniform float uEdgeStrength;\n' +
      shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float _fres = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), uEdgePower);
         totalEmissiveRadiance += uEdgeColor * _fres * uEdgeStrength;`,
      );
  };

  return mat;
}

// A tiny procedural environment for the glass to refract: vertical gradient from
// the warm ground up through the accent glow into the midnight top, plus one
// bright soft panel for a glassy specular. Kept dark-theme-first; it only tints
// the refraction, so it reads on both themes. Built once, baked by PMREM.
function buildEnvScene([top, mid, bot]) {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    // Vertical gradient the glass refracts/reflects. Colours are passed in per
    // theme (dark warm-black obsidian, or light warm smoked glass). The key light
    // still supplies the bright specular streak for the "wet" sheen.
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uMid: { value: new THREE.Color(mid) },
      uBot: { value: new THREE.Color(bot) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot;
      void main() {
        float h = normalize(vPos).y * 0.5 + 0.5;      // 0 bottom → 1 top
        vec3 c = mix(uBot, uMid, smoothstep(0.0, 0.5, h));
        c = mix(c, uTop, smoothstep(0.45, 1.0, h));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  s.add(new THREE.Mesh(geo, mat));
  return s;
}
