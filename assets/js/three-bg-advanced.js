import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { getFlightState } from './scroll-flight.js?v=20260801v35';

/**
 * Site-wide Three.js background — Sky Theatre.
 * Scroll stages an orbital diorama + phase morph (not plain scroll-zoom).
 */

/* Match site CSS tokens: navy void + indigo + cyan/teal + soft violet */
const PALETTE = {
    deep: 0x06080f,
    mid: 0x0b1020,
    edge: 0x121a2e,
    primary: 0x7c9bff, // --ember
    cyan: 0x5eead4, // --amber (teal)
    violet: 0xa78bfa, // --violet
    mint: 0x67e8f9 // cool aqua accent
};

/** Smoothstep for path blending */
function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/**
 * Sky Theatre mode — NOT plain scroll-zoom.
 * Scroll stages a scene like a revolving set:
 *  - Orbital camera (yaw/pitch on a radius) around a soft focal volume
 *  - Scene counter-rotates (multiplane diorama)
 *  - Phase morph: dusk → midnight → afterglow (color / density)
 *  - Particles swirl & rise like a weather system, not a tunnel dive
 * FOV stays fixed; no “push into the screen” zoom language.
 */
export function sampleTheatre(s, v = 0, dir = 0) {
    const p = Math.min(1, Math.max(0, s));
    // Ease the act so mid-page is the dramatic middle of the orbit
    const e = p * p * (3 - 2 * p);
    // ~70° horizontal arc, gentle elevation lift
    const yaw = -0.42 + e * 1.15 + dir * v * 0.12;
    const pitch = 0.06 + e * 0.28 + Math.sin(e * Math.PI) * 0.04;
    // Radius breathes only slightly — never collapses into a zoom
    const radius = 168 + Math.sin(e * Math.PI) * 10 - v * 4;
    // Stage focus drifts slowly upward (crane of the *subject*, not the lens)
    const focus = {
        x: Math.sin(e * 1.2) * 8,
        y: 2 + e * 14,
        z: -36 - e * 18
    };
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    return {
        yaw,
        pitch,
        radius,
        focus,
        // Camera on a sphere around focus
        cam: {
            x: focus.x + sy * radius * cp,
            y: focus.y + sp * radius * 0.72 + 6,
            z: focus.z + cy * radius * cp
        },
        // Phase for grade: 0 dusk → 0.5 night → 1 afterglow
        phase: e,
        // Counter-rotation of the diorama
        stageYaw: -yaw * 0.55,
        stagePitch: -pitch * 0.25
    };
}

const state = {
    initialized: false,
    reducedMotion: false,
    touchUi: false,
    /** Phone / small tablet — severe quality cut */
    mobile: false,
    /** Skip post stack (bloom/film) */
    usePost: true,
    /** Internal render scale (0.55–1) */
    renderScale: 1,
    /** Draw every Nth frame on mobile (2 = ~30fps) */
    frameSkip: 1,
    frameCount: 0,
    pageVisible: true,
    time: 0,
    motionScale: 1,
    quality: 1,
    mouse: new THREE.Vector2(0, 0),
    smoothMouse: new THREE.Vector2(0, 0),
    /** 0..1 page scroll progress (smoothed) */
    scroll: 0,
    smoothScroll: 0,
    /** 0..1 flight speed (from virtual scroll velocity) */
    speed: 0,
    smoothSpeed: 0,
    /** smoothed signed direction */
    dir: 0,
    baseBloom: 0.82,
    baseExposure: 1.28,
    baseFov: 55,
    cameraBase: new THREE.Vector3(0, 0, 140),
    targetCam: new THREE.Vector3(0, 0, 140),
    lookAt: new THREE.Vector3(0, 0, -80),
    camera: null,
    scene: null,
    renderer: null,
    composer: null,
    clock: null,
    root: null,
    /** near / mid / far multiplane groups */
    planeNear: null,
    planeMid: null,
    planeFar: null,
    /** Anime sky layer: aurora sheets, bokeh orbs, speed lines */
    anime: null,
    backdrop: null,
    veilA: null,
    veilB: null,
    veilC: null,
    mist: null,
    stream: null,
    drift: null,
    bloomPass: null,
    filmPass: null,
    // Stable viewport (mobile URL bar show/hide must not re-size WebGL)
    renderWidth: 0,
    renderHeight: 0,
    lastLayoutWidth: 0,
    resizeRaf: 0,
    _tmpLook: new THREE.Vector3(),
    _tmpCam: new THREE.Vector3(),
    _tmpFocus: new THREE.Vector3(),
    _quat: new THREE.Quaternion(),
    _quatTarget: new THREE.Quaternion(),
    _m4: new THREE.Matrix4(),
    _up: new THREE.Vector3(0, 1, 0),
    /** External frame subscribers (CSS3D stage, etc.) */
    frameHooks: [],
    /** Latest theatre snapshot for other renderers */
    theatreSnap: null
};

/** Subscribe to the WebGL render loop. Returns unsubscribe. */
export function onThreeFrame(fn) {
    if (typeof fn !== 'function') return () => {};
    state.frameHooks.push(fn);
    return () => {
        state.frameHooks = state.frameHooks.filter((f) => f !== fn);
    };
}

export function getTheatreSnapshot() {
    return state.theatreSnap;
}

function detectTouchUi() {
    try {
        return (
            window.matchMedia('(pointer: coarse)').matches ||
            window.matchMedia('(hover: none)').matches ||
            (navigator.maxTouchPoints > 0 && 'ontouchstart' in window)
        );
    } catch {
        return navigator.maxTouchPoints > 0;
    }
}

/** Aggressive mobile / low-power profile for WebGL */
function detectMobileProfile(touchUi) {
    const narrow =
        Math.min(window.innerWidth || 9999, window.innerHeight || 9999) < 820 ||
        (window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
    let cores = 8;
    let mem = 8;
    let saveData = false;
    try {
        cores = navigator.hardwareConcurrency || 8;
    } catch {
        /* ignore */
    }
    try {
        mem = navigator.deviceMemory || 8;
    } catch {
        /* ignore */
    }
    try {
        saveData = Boolean(navigator.connection?.saveData);
    } catch {
        /* ignore */
    }
    const lowPower = cores <= 4 || mem <= 4 || saveData;
    return {
        mobile: touchUi || narrow || lowPower,
        lowPower: lowPower || (touchUi && narrow)
    };
}

function maxPixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    if (state.reducedMotion) return Math.min(dpr, 1);
    if (state.mobile) return Math.min(dpr, 1);
    return Math.min(dpr, 1.6);
}

/** Layout size for the canvas — ignore transient mobile chrome height flicker. */
function getStableViewport() {
    const w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);

    if (!state.touchUi) {
        return { w, h, changed: w !== state.renderWidth || h !== state.renderHeight };
    }

    // Width change (orientation / real layout) → accept new height fully
    const widthChanged = !state.lastLayoutWidth || Math.abs(w - state.lastLayoutWidth) > 24;
    if (widthChanged) {
        state.lastLayoutWidth = w;
        return { w, h, changed: true };
    }

    // Height-only change while scrolling (URL bar) → keep prior render size
    if (state.renderWidth && state.renderHeight) {
        return { w: state.renderWidth, h: state.renderHeight, changed: false };
    }

    return { w, h, changed: true };
}

function pageMode() {
    const path = (window.location.pathname.replace(/\/+$/, '') || '/').toLowerCase();
    if (path === '/' || path === '/index.html') return 'home';
    if (path.includes('/features')) return 'features';
    if (path.includes('/commands')) return 'commands';
    if (path.includes('/about')) return 'about';
    if (path.includes('/status')) return 'status';
    return 'page';
}

function applyPageCamera(mode) {
    // Slight framing shifts per page, still full-field
    const map = {
        home: { cam: [0, 4, 135], look: [0, -4, -90] },
        features: { cam: [8, 2, 145], look: [-6, -2, -80] },
        commands: { cam: [-6, 0, 148], look: [4, 0, -85] },
        about: { cam: [0, 8, 142], look: [0, -6, -75] },
        status: { cam: [0, -2, 128], look: [0, 2, -70] },
        page: { cam: [0, 2, 140], look: [0, 0, -80] }
    };
    const m = map[mode] || map.page;
    state.cameraBase.set(m.cam[0], m.cam[1], m.cam[2]);
    state.targetCam.copy(state.cameraBase);
    state.lookAt.set(m.look[0], m.look[1], m.look[2]);
}

const NOISE_GLSL = `
// Gradient-style noise (not raw value-noise) — avoids visible square lattice cells
vec3 hash33(vec3 p) {
    p = vec3(
        dot(p, vec3(127.1, 311.7, 74.7)),
        dot(p, vec3(269.5, 183.3, 246.1)),
        dot(p, vec3(113.5, 271.9, 124.6))
    );
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    // Quintic fade — kills blocky corners of classic value noise
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    float n000 = dot(hash33(i + vec3(0,0,0)), f - vec3(0,0,0));
    float n100 = dot(hash33(i + vec3(1,0,0)), f - vec3(1,0,0));
    float n010 = dot(hash33(i + vec3(0,1,0)), f - vec3(0,1,0));
    float n110 = dot(hash33(i + vec3(1,1,0)), f - vec3(1,1,0));
    float n001 = dot(hash33(i + vec3(0,0,1)), f - vec3(0,0,1));
    float n101 = dot(hash33(i + vec3(1,0,1)), f - vec3(1,0,1));
    float n011 = dot(hash33(i + vec3(0,1,1)), f - vec3(0,1,1));
    float n111 = dot(hash33(i + vec3(1,1,1)), f - vec3(1,1,1));

    return mix(
        mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
        mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
        u.z
    ) * 0.5 + 0.5;
}
float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    // Rotate each octave so lattice axes never stack into a visible grid
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = mat3(
            0.80, 0.60, 0.00,
           -0.48, 0.64, 0.60,
            0.36,-0.48, 0.80
        ) * p * 2.07 + vec3(17.1, 9.4, 3.7);
        a *= 0.5;
    }
    return v;
}
`;

/* Fullscreen abstract field (edge-to-edge washes, not a centerpiece) */
function createBackdrop() {
    const material = new THREE.ShaderMaterial({
        depthWrite: false,
        depthTest: false,
        uniforms: {
            time: { value: 0 },
            scroll: { value: 0 },
            mouse: { value: new THREE.Vector2(0, 0) },
            resolution: { value: new THREE.Vector2(1, 1) },
            colorDeep: { value: new THREE.Color(PALETTE.deep) },
            colorMid: { value: new THREE.Color(PALETTE.mid) },
            colorEdge: { value: new THREE.Color(PALETTE.edge) },
            colorPrimary: { value: new THREE.Color(PALETTE.primary) },
            colorCyan: { value: new THREE.Color(PALETTE.cyan) },
            colorMint: { value: new THREE.Color(PALETTE.mint) },
            colorViolet: { value: new THREE.Color(PALETTE.violet) }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `,
        fragmentShader: `
            precision highp float;
            varying vec2 vUv;
            uniform float time;
            uniform float scroll;
            uniform vec2 mouse;
            uniform vec2 resolution;
            uniform vec3 colorDeep;
            uniform vec3 colorMid;
            uniform vec3 colorEdge;
            uniform vec3 colorPrimary;
            uniform vec3 colorCyan;
            uniform vec3 colorMint;
            uniform vec3 colorViolet;
            ${NOISE_GLSL}

            void main() {
                vec2 uv = vUv;
                vec2 p = (gl_FragCoord.xy / max(resolution, vec2(1.0))) * 2.0 - 1.0;
                p.x *= resolution.x / max(resolution.y, 1.0);

                // Phase morph — indigo → cyan → soft violet (site theme only)
                float s = scroll;
                float phase = s;
                float t = time * 0.035 + phase * 0.4;
                vec2 drift = vec2(phase * 0.32, phase * 0.06);
                vec2 w = uv + drift + 0.12 * vec2(
                    fbm(vec3(uv * 1.4 + drift, t * 0.5)) - 0.5,
                    fbm(vec3(uv * 1.4 + 5.2 + drift * 0.6, -t * 0.4)) - 0.5
                );
                float n1 = fbm(vec3(w * 1.6 + vec2(t * 0.25, -t * 0.18), t * 0.22));
                float n2 = fbm(vec3(w * 2.8 - vec2(t * 0.15, t * 0.22), -t * 0.16));

                vec3 col = mix(colorDeep, colorMid, smoothstep(-0.05, 1.05, uv.y + n1 * 0.22));
                col = mix(col, colorEdge, n2 * 0.16);

                vec3 actA = mix(colorPrimary, colorCyan, smoothstep(0.0, 0.5, phase));
                vec3 actB = mix(colorCyan, colorViolet, smoothstep(0.4, 1.0, phase));
                vec3 act = mix(actA, actB, smoothstep(0.25, 0.8, phase));

                float c1 = exp(-length(p - vec2(-1.05 + phase * 0.35, 0.5)) * 1.05);
                float c2 = exp(-length(p - vec2(1.1 - phase * 0.25, -0.4)) * 1.1);
                float c3 = exp(-length(p - vec2(0.1, 0.95 - phase * 0.2)) * 1.15);
                float c4 = exp(-length(p - vec2(-0.15, -1.0 + phase * 0.15)) * 1.12);
                float dim = 0.92 - phase * 0.08;
                col += act * c1 * 0.28 * dim;
                col += colorCyan * c2 * 0.24 * dim;
                col += colorMint * c3 * 0.14 * dim;
                col += colorViolet * c4 * 0.1 * dim;

                float wash = smoothstep(0.2, 0.88, n1) * smoothstep(0.18, 0.9, n2);
                col += act * wash * 0.07 * dim;

                float vig = smoothstep(1.8, 0.25, length(p * vec2(0.72, 1.0)));
                col *= (0.72 + vig * 0.28) * dim;

                gl_FragColor = vec4(col, 1.0);
            }
        `
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    mesh.name = 'backdrop';
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.onBeforeRender = () => {
        mesh.matrixWorld.identity();
    };
    return mesh;
}

/* Large translucent veils spanning the volume */
function createVeil(width, height, z, color, opacity, speed) {
    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
            time: { value: 0 },
            color: { value: new THREE.Color(color) },
            opacity: { value: opacity },
            speed: { value: speed },
            mouse: { value: new THREE.Vector2(0, 0) }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            precision highp float;
            varying vec2 vUv;
            uniform float time;
            uniform vec3 color;
            uniform float opacity;
            uniform float speed;
            uniform vec2 mouse;
            ${NOISE_GLSL}

            void main() {
                vec2 uv = vUv + mouse * 0.03;
                float t = time * speed;
                float n = fbm(vec3(uv * 2.4, t));
                float n2 = fbm(vec3(uv * 4.2 - t * 0.35, t * 0.55));
                // Soft cloudy sheets — no linear wave / lattice structure
                float sheet = smoothstep(0.18, 0.78, n) * (0.4 + 0.6 * n2);
                float edge = smoothstep(0.0, 0.14, uv.x) * smoothstep(1.0, 0.86, uv.x)
                           * smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.88, uv.y);
                float breathe = 0.7 + 0.3 * n2;
                float a = sheet * edge * breathe * opacity;
                if (a < 0.01) discard;
                gl_FragColor = vec4(color, a);
            }
        `
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 1), material);
    mesh.position.z = z;
    mesh.userData.material = material;
    return mesh;
}

/* Wide mist particle volume filling the frustum */
function createMist(count) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
        // Spread across a large box, not a sphere around origin
        positions[i * 3] = (Math.random() - 0.5) * 320;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
        positions[i * 3 + 2] = -40 - Math.random() * 220;
        seeds[i * 4] = Math.random() * 100;
        seeds[i * 4 + 1] = 0.6 + Math.random() * 2.2;
        seeds[i * 4 + 2] = Math.random();
        seeds[i * 4 + 3] = 0.3 + Math.random() * 0.9;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
            time: { value: 0 },
            scroll: { value: 0 },
            speed: { value: 0 },
            mouse: { value: new THREE.Vector2(0, 0) },
            pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.75) }
        },
        vertexShader: `
            attribute vec4 aSeed;
            uniform float time;
            uniform float scroll;
            uniform float speed;
            uniform float pixelRatio;
            uniform vec2 mouse;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                vec3 p = position;
                float t = time * aSeed.w * 0.25;
                // Flight pulls field through the camera (depth scroll)
                p.z += scroll * 95.0 + speed * aSeed.z * 18.0;
                p.x += sin(t + aSeed.x + scroll * 3.0) * 12.0 + mouse.x * 18.0 * aSeed.z;
                p.y += cos(t * 0.8 + aSeed.x * 0.5) * 8.0 + mouse.y * 12.0 * aSeed.z - scroll * 22.0;
                p.z += sin(t * 0.5 + aSeed.z * 4.0) * 6.0;

                vAlpha = 0.22 + aSeed.z * 0.42 + speed * 0.15;
                vColor = mix(vec3(0.49, 0.61, 1.0), vec3(0.37, 0.92, 0.83), aSeed.z);
                vColor = mix(vColor, vec3(0.66, 0.55, 0.98), step(0.72, aSeed.z) * 0.55);

                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                // Velocity stretches points slightly along flight for motion feel
                float stretch = 1.0 + speed * 1.4;
                gl_PointSize = aSeed.y * pixelRatio * (175.0 / max(1.0, -mv.z)) * stretch;
            }
        `,
        fragmentShader: `
            precision highp float;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                vec2 uv = gl_PointCoord - 0.5;
                float d = length(uv);
                float a = exp(-d * 4.2) * vAlpha;
                if (a < 0.008) discard;
                gl_FragColor = vec4(vColor, a);
            }
        `
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
}

/* Horizontal streams that cross the whole frame */
function createStream(count) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
        // Free-floating field — no discrete lanes/rows
        positions[i * 3] = (Math.random() - 0.5) * 360;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 190;
        positions[i * 3 + 2] = -30 - Math.random() * 200;
        seeds[i * 4] = Math.random() * Math.PI * 2;
        seeds[i * 4 + 1] = 14 + Math.random() * 48; // speed
        seeds[i * 4 + 2] = Math.random();
        seeds[i * 4 + 3] = 0.5 + Math.random() * 1.5;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
            time: { value: 0 },
            scroll: { value: 0 },
            speed: { value: 0 },
            pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.75) }
        },
        vertexShader: `
            attribute vec4 aSeed;
            uniform float time;
            uniform float scroll;
            uniform float speed;
            uniform float pixelRatio;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                vec3 p = position;
                float span = 380.0;
                float rush = 1.0 + speed * 3.5 + scroll * 0.6;
                float x = mod(p.x + time * aSeed.y * rush + aSeed.x * 10.0 + span * 0.5, span) - span * 0.5;
                p.x = x;
                p.y += sin(time * 0.55 + aSeed.x * 2.4) * 5.0 - scroll * 18.0;
                p.z += cos(time * 0.35 + aSeed.z * 3.0) * 3.0 + scroll * 80.0 + speed * 24.0;

                vAlpha = 0.32 + aSeed.z * 0.48 + speed * 0.2;
                vColor = mix(vec3(0.37, 0.92, 0.83), vec3(0.49, 0.61, 1.0), aSeed.z);

                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = aSeed.w * pixelRatio * (68.0 / max(1.0, -mv.z)) * (1.0 + speed * 1.8);
            }
        `,
        fragmentShader: `
            precision highp float;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                vec2 uv = gl_PointCoord - 0.5;
                float d = length(uv);
                float a = exp(-d * 4.4) * vAlpha;
                if (a < 0.01) discard;
                gl_FragColor = vec4(vColor, a);
            }
        `
    });

    return new THREE.Points(geometry, material);
}

/**
 * Anime-inspired sky field: soft aurora curtains, bokeh orbs, rush lines.
 * No rings / spirals — layered atmosphere you glide through.
 */
function createAnimeSky(opts = {}) {
    const { touchUi = false, quality = 1 } = opts;
    const group = new THREE.Group();
    group.name = 'animeSky';

    // --- Soft aurora / light curtains (pastel sheets) ---
    const sheetColors = [
        [PALETTE.primary, 0.14],
        [PALETTE.cyan, 0.12],
        [PALETTE.mint, 0.1],
        [PALETTE.violet, 0.08]
    ];
    const sheets = [];
    const sheetCount = touchUi ? 3 : 4;
    for (let i = 0; i < sheetCount; i++) {
        const [hex, opacity] = sheetColors[i % sheetColors.length];
        const mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            uniforms: {
                time: { value: 0 },
                scroll: { value: 0 },
                speed: { value: 0 },
                color: { value: new THREE.Color(hex) },
                opacity: { value: opacity }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                varying vec2 vUv;
                uniform float time;
                uniform float scroll;
                uniform float speed;
                uniform vec3 color;
                uniform float opacity;
                void main() {
                    vec2 uv = vUv;
                    // Soft vertical aurora bands — organic, not grid
                    float wave = sin(uv.x * 4.5 + time * 0.35 + scroll * 2.0) * 0.5
                               + sin(uv.x * 9.0 - time * 0.22 + uv.y * 2.0) * 0.25;
                    float band = smoothstep(0.15, 0.55, 0.45 + wave * 0.35 + uv.y * 0.2);
                    float edge = smoothstep(0.0, 0.18, uv.x) * smoothstep(1.0, 0.82, uv.x)
                               * smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.78, uv.y);
                    float glow = band * edge * (0.75 + speed * 0.45);
                    float sparkle = pow(max(0.0, sin(uv.x * 40.0 + time + scroll * 8.0)
                        * sin(uv.y * 22.0 - time * 0.7)), 18.0) * 0.35;
                    vec3 col = color * (1.0 + sparkle);
                    float a = (glow * opacity + sparkle * opacity * 0.8) * (0.85 + uv.y * 0.35);
                    if (a < 0.008) discard;
                    gl_FragColor = vec4(col, a);
                }
            `
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(220, 140, 1, 1), mat);
        mesh.position.set((i - 1.5) * 28, 8 + i * 6, -50 - i * 35);
        mesh.rotation.y = (i - 1.5) * 0.12;
        mesh.rotation.x = -0.08;
        mesh.frustumCulled = false;
        mesh.userData = { kind: 'sheet', mat, index: i, baseY: mesh.position.y, baseZ: mesh.position.z };
        group.add(mesh);
        sheets.push(mesh);
    }

    // --- Large soft bokeh orbs (anime night / dusk lights) ---
    const orbCount = Math.floor((touchUi ? 48 : 90) * quality);
    const orbPos = new Float32Array(orbCount * 3);
    const orbSeed = new Float32Array(orbCount * 4);
    for (let i = 0; i < orbCount; i++) {
        orbPos[i * 3] = (Math.random() - 0.5) * 280;
        orbPos[i * 3 + 1] = (Math.random() - 0.35) * 160;
        orbPos[i * 3 + 2] = -20 - Math.random() * 220;
        orbSeed[i * 4] = Math.random() * 100;
        orbSeed[i * 4 + 1] = 1.2 + Math.random() * 3.5; // size
        orbSeed[i * 4 + 2] = Math.random(); // color mix
        orbSeed[i * 4 + 3] = 0.35 + Math.random() * 0.8; // drift
    }
    const orbGeo = new THREE.BufferGeometry();
    orbGeo.setAttribute('position', new THREE.BufferAttribute(orbPos, 3));
    orbGeo.setAttribute('aSeed', new THREE.BufferAttribute(orbSeed, 4));
    const orbs = new THREE.Points(
        orbGeo,
        new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                time: { value: 0 },
                scroll: { value: 0 },
                speed: { value: 0 },
                pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.75) }
            },
            vertexShader: `
                attribute vec4 aSeed;
                uniform float time;
                uniform float scroll;
                uniform float speed;
                uniform float pixelRatio;
                varying float vAlpha;
                varying vec3 vColor;
                void main() {
                    vec3 p = position;
                    float t = time * aSeed.w * 0.2;
                    // Gentle float + scroll lift (sakura / light orbs rising)
                    p.x += sin(t + aSeed.x) * 8.0;
                    p.y += cos(t * 0.7 + aSeed.x * 0.4) * 6.0 + scroll * 36.0;
                    p.z += scroll * 90.0 + sin(t * 0.5) * 4.0;
                    // Theme bokeh: indigo / teal / soft violet
                    vec3 cA = vec3(0.49, 0.61, 1.0);
                    vec3 cB = vec3(0.37, 0.92, 0.83);
                    vec3 cC = vec3(0.66, 0.55, 0.98);
                    vColor = mix(cA, cB, smoothstep(0.0, 0.55, aSeed.z));
                    vColor = mix(vColor, cC, smoothstep(0.55, 1.0, aSeed.z));
                    vAlpha = 0.18 + aSeed.z * 0.35 + speed * 0.12;
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_Position = projectionMatrix * mv;
                    gl_PointSize = aSeed.y * pixelRatio * (220.0 / max(1.0, -mv.z)) * (1.0 + speed * 0.3);
                }
            `,
            fragmentShader: `
                precision highp float;
                varying float vAlpha;
                varying vec3 vColor;
                void main() {
                    vec2 uv = gl_PointCoord - 0.5;
                    float d = length(uv);
                    // Soft bokeh disc with warm falloff
                    float a = exp(-d * 3.2) * vAlpha;
                    float rim = smoothstep(0.48, 0.2, d) * 0.15;
                    a += rim * vAlpha;
                    if (a < 0.006) discard;
                    gl_FragColor = vec4(vColor, a);
                }
            `
        })
    );
    orbs.frustumCulled = false;
    orbs.name = 'bokeh';
    group.add(orbs);

    // --- Anime speed lines (appear with scroll velocity) ---
    const lineCount = Math.floor((touchUi ? 80 : 160) * quality);
    const linePos = new Float32Array(lineCount * 3);
    const lineSeed = new Float32Array(lineCount * 4);
    for (let i = 0; i < lineCount; i++) {
        // Radial from center — classic anime rush
        const ang = Math.random() * Math.PI * 2;
        const r = 20 + Math.random() * 140;
        linePos[i * 3] = Math.cos(ang) * r;
        linePos[i * 3 + 1] = Math.sin(ang) * r * 0.65;
        linePos[i * 3 + 2] = -10 - Math.random() * 180;
        lineSeed[i * 4] = ang;
        lineSeed[i * 4 + 1] = 0.6 + Math.random() * 1.8; // length bias
        lineSeed[i * 4 + 2] = Math.random();
        lineSeed[i * 4 + 3] = 0.5 + Math.random();
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lineGeo.setAttribute('aSeed', new THREE.BufferAttribute(lineSeed, 4));
    const speedLines = new THREE.Points(
        lineGeo,
        new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                time: { value: 0 },
                scroll: { value: 0 },
                speed: { value: 0 },
                pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.75) }
            },
            vertexShader: `
                attribute vec4 aSeed;
                uniform float time;
                uniform float scroll;
                uniform float speed;
                uniform float pixelRatio;
                varying float vAlpha;
                varying vec3 vColor;
                void main() {
                    vec3 p = position;
                    // Rush outward + through depth when moving
                    float rush = speed * (18.0 + aSeed.y * 40.0);
                    p.x += cos(aSeed.x) * rush;
                    p.y += sin(aSeed.x) * rush * 0.7;
                    p.z += scroll * 120.0 + speed * 40.0 + time * aSeed.w * 2.0;
                    vAlpha = speed * (0.35 + aSeed.z * 0.55);
                    vColor = mix(vec3(0.9, 0.95, 1.0), vec3(0.55, 0.9, 1.0), aSeed.z);
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_Position = projectionMatrix * mv;
                    // Stretch into lines when fast
                    gl_PointSize = aSeed.y * pixelRatio * (28.0 / max(1.0, -mv.z))
                        * (1.0 + speed * 14.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                varying float vAlpha;
                varying vec3 vColor;
                void main() {
                    if (vAlpha < 0.02) discard;
                    vec2 uv = gl_PointCoord - 0.5;
                    // Elongated streak (horizontal stretch in point space)
                    float d = length(uv * vec2(0.35, 1.6));
                    float a = exp(-d * 5.5) * vAlpha;
                    if (a < 0.012) discard;
                    gl_FragColor = vec4(vColor, a);
                }
            `
        })
    );
    speedLines.frustumCulled = false;
    speedLines.name = 'speedLines';
    group.add(speedLines);

    // --- Distant horizon glow band ---
    const horizonMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
            time: { value: 0 },
            scroll: { value: 0 },
            colorA: { value: new THREE.Color(PALETTE.primary) },
            colorB: { value: new THREE.Color(PALETTE.cyan) },
            opacity: { value: 0.22 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            precision highp float;
            varying vec2 vUv;
            uniform float time;
            uniform float scroll;
            uniform vec3 colorA;
            uniform vec3 colorB;
            uniform float opacity;
            void main() {
                float h = smoothstep(0.0, 0.45, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
                float shimmer = 0.85 + 0.15 * sin(vUv.x * 12.0 + time * 0.4 + scroll * 3.0);
                vec3 col = mix(colorA, colorB, vUv.x * 0.6 + 0.2 + sin(time * 0.15) * 0.1);
                float a = h * opacity * shimmer * (0.7 + scroll * 0.4);
                if (a < 0.01) discard;
                gl_FragColor = vec4(col, a);
            }
        `
    });
    const horizon = new THREE.Mesh(new THREE.PlaneGeometry(420, 90, 1, 1), horizonMat);
    horizon.position.set(0, -28, -160);
    horizon.rotation.x = -0.15;
    horizon.frustumCulled = false;
    horizon.userData = { kind: 'horizon', mat: horizonMat };
    group.add(horizon);

    group.userData = { sheets, orbs, speedLines, horizon };
    return group;
}

/* Secondary vertical drift particles */
function createDrift(count) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 300;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 180;
        positions[i * 3 + 2] = -20 - Math.random() * 180;
        seeds[i * 4] = Math.random() * 10;
        seeds[i * 4 + 1] = 6 + Math.random() * 16;
        seeds[i * 4 + 2] = Math.random();
        seeds[i * 4 + 3] = 0.4 + Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
            time: { value: 0 },
            scroll: { value: 0 },
            speed: { value: 0 },
            pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.75) }
        },
        vertexShader: `
            attribute vec4 aSeed;
            uniform float time;
            uniform float scroll;
            uniform float speed;
            uniform float pixelRatio;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                vec3 p = position;
                float span = 200.0;
                float rush = 1.0 + speed * 2.8;
                p.y = mod(p.y + time * aSeed.y * 0.35 * rush + aSeed.x + scroll * 40.0 + span * 0.5, span) - span * 0.5;
                p.x += sin(time * 0.3 + aSeed.x + scroll * 2.0) * 4.0;
                p.z += scroll * 70.0;

                vAlpha = 0.28 + aSeed.z * 0.4 + speed * 0.18;
                vColor = mix(vec3(0.37, 0.92, 0.83), vec3(0.49, 0.61, 1.0), aSeed.z);

                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = aSeed.w * pixelRatio * (62.0 / max(1.0, -mv.z)) * (1.0 + speed);
            }
        `,
        fragmentShader: `
            precision highp float;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                vec2 uv = gl_PointCoord - 0.5;
                float d = length(uv);
                float a = exp(-d * 5.0) * vAlpha;
                if (a < 0.01) discard;
                gl_FragColor = vec4(vColor, a);
            }
        `
    });

    return new THREE.Points(geometry, material);
}

const FilmShader = {
    uniforms: {
        tDiffuse: { value: null },
        time: { value: 0 },
        amount: { value: 1 },
        speed: { value: 0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform float time;
        uniform float amount;
        uniform float speed;
        varying vec2 vUv;
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        void main() {
            vec2 uv = vUv;
            vec2 c = uv - 0.5;
            float d = length(c);
            // Directional motion streak (world-stream feel) — NOT radial zoom
            float ab = (0.0008 + speed * 0.0018) * amount * (0.28 + d);
            // Vertical smear = travel through depth; slight horizontal for truck
            vec2 streak = vec2(speed * 0.0025, -speed * 0.0065);
            float r = texture2D(tDiffuse, uv + c * ab + streak).r;
            float g = texture2D(tDiffuse, uv + streak * 0.45).g;
            float b = texture2D(tDiffuse, uv - c * ab - streak).b;
            vec3 col = vec3(r, g, b);
            col += (hash(uv * vec2(900.0, 520.0) + time * 3.0) - 0.5) * 0.012 * amount;
            float vig = smoothstep(1.38, 0.24, d);
            col *= mix(1.0, vig, 0.3 * amount + speed * 0.1);
            col = min(col, vec3(0.9));
            gl_FragColor = vec4(col, 1.0);
        }
    `
};

function createLights(scene) {
    scene.add(new THREE.AmbientLight(0xb8c8ff, state.mobile ? 0.95 : 0.72));
    // Mobile: one key light only — point lights are expensive
    const L = state.mobile
        ? [[0x7c9bff, 1.1, -40, 30, 10]]
        : [
              [0x7c9bff, 1.5, -120, 40, 20],
              [0x5eead4, 1.3, 130, -20, -40],
              [0xa78bfa, 0.9, 20, 80, -100],
              [0x67e8f9, 0.8, -40, -70, -60]
          ];
    L.forEach(([hex, intensity, x, y, z]) => {
        const light = new THREE.PointLight(hex, intensity, state.mobile ? 380 : 520, 2);
        light.position.set(x, y, z);
        scene.add(light);
    });
}

function animate() {
    requestAnimationFrame(animate);
    if (!state.renderer || !state.scene || !state.camera) return;
    if (!state.pageVisible) return;

    // Mobile: skip frames (~30fps) to cut GPU load
    state.frameCount += 1;
    if (state.frameSkip > 1 && state.frameCount % state.frameSkip !== 0) {
        // Still advance clock lightly so motion doesn't stutter when we resume
        state.clock.getDelta();
        return;
    }

    const dt = Math.min(state.clock.getDelta(), 0.05);
    const scale = state.motionScale;
    state.time += dt * scale;
    const t = state.time;

    // Pull progress + velocity from the flight / native scroll tracker
    const flight = getFlightState();
    state.scroll = flight.progress;
    const scrollFollow = state.mobile ? 0.22 : state.reducedMotion ? 0.18 : 0.14;
    state.smoothScroll += (flight.smoothProgress - state.smoothScroll) * scrollFollow;
    state.speed = flight.speed;
    state.smoothSpeed += (state.speed - state.smoothSpeed) * (state.mobile ? 0.25 : state.reducedMotion ? 0.2 : 0.12);

    const s = state.smoothScroll;
    const v = state.smoothSpeed;
    state.dir += ((flight.direction || 0) - state.dir) * 0.08;
    const dir = state.dir;
    const theatre = sampleTheatre(s, v, dir);
    const phase = theatre.phase;

    state.smoothMouse.x += (state.mouse.x - state.smoothMouse.x) * 0.045;
    state.smoothMouse.y += (state.mouse.y - state.smoothMouse.y) * 0.045;

    if (state.backdrop?.material?.uniforms) {
        const u = state.backdrop.material.uniforms;
        u.time.value = t + phase * 1.5;
        u.mouse.value.copy(state.smoothMouse);
        u.resolution.value.set(
            state.renderWidth || window.innerWidth,
            state.renderHeight || window.innerHeight
        );
        if (u.scroll) u.scroll.value = phase;
    }

    // Stage rotates as a diorama (counter to orbit) — this is the “not zoom” trick
    if (state.root) {
        state.root.rotation.y = theatre.stageYaw;
        state.root.rotation.x = theatre.stagePitch;
        state.root.rotation.z = Math.sin(phase * Math.PI) * 0.02;
        state.root.position.y = Math.sin(phase * Math.PI) * 4;
    }

    // Multiplane: lighter on mobile
    const mx = state.mobile ? 0 : state.smoothMouse.x;
    const my = state.mobile ? 0 : state.smoothMouse.y;
    if (state.planeNear) {
        state.planeNear.position.x = Math.sin(theatre.yaw) * (state.mobile ? -6 : -14) + mx * 10;
        state.planeNear.position.y = Math.sin(phase * Math.PI) * (state.mobile ? 3 : 6) + my * 6;
        state.planeNear.position.z = Math.cos(theatre.yaw) * (state.mobile ? 3 : 8);
        if (!state.mobile) state.planeNear.rotation.y = -theatre.yaw * 0.15;
    }
    if (!state.mobile && state.planeMid) {
        state.planeMid.position.x = Math.sin(theatre.yaw) * -7 + mx * 5;
        state.planeMid.position.y = Math.sin(phase * Math.PI) * 3 + my * 3;
        state.planeMid.position.z = Math.cos(theatre.yaw) * 4;
        state.planeMid.rotation.y = -theatre.yaw * 0.08;
    }
    if (!state.mobile && state.planeFar) {
        state.planeFar.position.x = Math.sin(theatre.yaw) * -3 + mx * 2;
        state.planeFar.position.y = phase * 4;
        state.planeFar.position.z = 0;
        state.planeFar.rotation.y = -theatre.yaw * 0.04;
    }

    // Anime sky: weather system on the far plane (desktop only)
    if (state.anime && !state.mobile) {
        const { sheets, orbs, speedLines, horizon } = state.anime.userData;
        sheets?.forEach((mesh, i) => {
            const mat = mesh.userData.mat;
            if (mat?.uniforms) {
                mat.uniforms.time.value = t;
                mat.uniforms.scroll.value = phase;
                mat.uniforms.speed.value = v * 0.6;
                if (mat.uniforms.opacity) {
                    // Phase-based presence: mid-act peaks, never white-out
                    const act = 0.75 + Math.sin(phase * Math.PI) * 0.35;
                    mat.uniforms.opacity.value = (0.06 + i * 0.012) * act;
                }
            }
            const baseY = mesh.userData.baseY ?? mesh.position.y;
            const baseZ = mesh.userData.baseZ ?? mesh.position.z;
            // Curtains drift sideways with the orbit, rise gently with phase
            mesh.position.y = baseY + Math.sin(t * 0.12 + i) * 3 + phase * 12;
            mesh.position.z = baseZ;
            mesh.position.x =
                (i - 1.5) * 32 +
                Math.sin(t * 0.08 + i + phase * 2.0) * 8 +
                Math.sin(theatre.yaw + i) * 10;
            mesh.rotation.y = (i - 1.5) * 0.15 + theatre.yaw * 0.2 + Math.sin(t * 0.06 + i) * 0.04;
        });
        if (orbs?.material?.uniforms) {
            orbs.material.uniforms.time.value = t + phase * 2;
            orbs.material.uniforms.scroll.value = phase * 0.55;
            orbs.material.uniforms.speed.value = v * 0.7;
        }
        if (speedLines?.material?.uniforms) {
            // Only a whisper of lines on fast flicks — not a constant zoom cue
            speedLines.material.uniforms.time.value = t;
            speedLines.material.uniforms.scroll.value = phase;
            speedLines.material.uniforms.speed.value = Math.max(0, v - 0.15) * 0.9;
        }
        if (horizon) {
            const hm = horizon.userData.mat;
            if (hm?.uniforms) {
                hm.uniforms.time.value = t;
                hm.uniforms.scroll.value = phase;
                if (hm.uniforms.opacity) {
                    hm.uniforms.opacity.value = 0.1 + Math.sin(phase * Math.PI) * 0.08;
                }
            }
            horizon.position.y = -30 + phase * 16;
            horizon.position.z = -150;
            horizon.rotation.y = theatre.yaw * 0.15;
        }
    }

    [state.veilA, state.veilB, state.veilC].forEach((veil, i) => {
        if (!veil) return;
        if (veil.userData.material) {
            const mat = veil.userData.material;
            mat.uniforms.time.value = t + phase * (1.2 + i * 0.35);
            mat.uniforms.mouse.value.copy(state.smoothMouse);
            if (mat.uniforms.opacity && veil.userData.baseOpacity != null) {
                const pulse = 1 + Math.sin(phase * Math.PI) * 0.12;
                mat.uniforms.opacity.value = Math.min(
                    veil.userData.baseOpacity * pulse,
                    veil.userData.baseOpacity * 1.15
                );
            }
        }
        // Float & orbit-local sway (weather, not tunnel)
        const ang = theatre.yaw * (0.4 + i * 0.15) + t * 0.05 + i;
        veil.position.x = Math.sin(ang) * (16 + i * 6) + Math.sin(t * 0.07 + i) * 6;
        veil.position.y = Math.cos(t * 0.06 + i * 1.2) * (5 + i * 2) + phase * (3 + i);
        veil.position.z = -40 - i * 50 + Math.cos(ang) * (8 + i * 3);
        veil.rotation.z = Math.sin(t * 0.05 + i) * 0.06;
        veil.rotation.y = ang * 0.25 + Math.sin(t * 0.04 + i) * 0.08;
    });

    // Weather clock — swirl & rise with phase, mild velocity accent
    const weatherT = t + phase * 3.2 + v * 1.2;
    const setParticle = (obj, timeScale = 1, speedMul = 0.7) => {
        if (!obj?.material?.uniforms) return;
        const u = obj.material.uniforms;
        u.time.value = weatherT * timeScale;
        // Lower scroll-driven Z push so it doesn't read as dive-zoom
        if (u.scroll) u.scroll.value = phase * 0.45;
        if (u.speed) u.speed.value = Math.min(0.85, v * speedMul);
        if (u.mouse) u.mouse.value.copy(state.smoothMouse);
    };
    setParticle(state.mist, 1, 0.75);
    setParticle(state.stream, 1.05, 0.9);
    setParticle(state.drift, 0.9, 0.7);

    // --- Orbital sky theatre camera (fixed FOV) ---
    const parallax = state.reducedMotion ? 0.08 : state.touchUi ? 0 : 1;
    const idle = scale;

    state.targetCam.x =
        theatre.cam.x +
        state.smoothMouse.x * 16 * parallax +
        Math.sin(t * 0.05) * 2 * idle;
    state.targetCam.y =
        theatre.cam.y +
        state.smoothMouse.y * 10 * parallax +
        Math.cos(t * 0.07) * 1.5 * idle;
    state.targetCam.z =
        theatre.cam.z +
        Math.sin(t * 0.04) * 1.5 * idle;

    const camEase = 0.065 + v * 0.04;
    state.camera.position.x += (state.targetCam.x - state.camera.position.x) * camEase;
    state.camera.position.y += (state.targetCam.y - state.camera.position.y) * camEase;
    state.camera.position.z += (state.targetCam.z - state.camera.position.z) * camEase;

    // Gaze at the stage focus; mouse peeks around the volume
    state._tmpFocus.set(
        theatre.focus.x + state.smoothMouse.x * 12 * parallax,
        theatre.focus.y + 4 + state.smoothMouse.y * 8 * parallax + Math.sin(phase * Math.PI) * 3,
        theatre.focus.z
    );
    state._tmpLook.copy(state._tmpFocus);

    state._m4.lookAt(state.camera.position, state._tmpLook, state._up);
    state._quatTarget.setFromRotationMatrix(state._m4);
    // Soft dutch from orbit angular velocity, not scroll-zoom bank
    const roll = Math.sin(theatre.yaw) * 0.03 + dir * v * 0.02;
    state._tmpCam.set(0, 0, 1);
    state._quat.setFromAxisAngle(state._tmpCam, roll);
    state._quatTarget.multiply(state._quat);
    state.camera.quaternion.slerp(state._quatTarget, 0.07 + v * 0.05);

    if (state.camera.fov !== state.baseFov) {
        state.camera.fov = state.baseFov;
        state.camera.updateProjectionMatrix();
    }

    // Fog: night denser mid-act, clears slightly at afterglow
    if (state.scene?.fog) {
        const fogBase = 0.0015;
        const night = Math.sin(phase * Math.PI);
        state.scene.fog.density = fogBase * (1 + night * 0.35);
    }

    if (state.bloomPass) {
        const base = state.baseBloom * (state.reducedMotion ? 0.65 : 1);
        const bloom = base + Math.sin(phase * Math.PI) * 0.06 + v * 0.03;
        state.bloomPass.strength = Math.min(bloom, state.baseBloom + 0.1);
    }

    if (state.renderer) {
        // Afterglow slightly warmer exposure, still capped
        const exp = state.baseExposure + phase * 0.03 + Math.sin(phase * Math.PI) * 0.02;
        state.renderer.toneMappingExposure = Math.min(exp, state.baseExposure + 0.06);
    }

    if (state.usePost && state.filmPass) {
        state.filmPass.uniforms.time.value = t;
        state.filmPass.uniforms.amount.value =
            (state.reducedMotion ? 0.28 : 0.48) + Math.min(0.12, v * 0.18);
        if (state.filmPass.uniforms.speed) {
            state.filmPass.uniforms.speed.value = Math.min(0.7, v * 0.55 + Math.abs(theatre.yaw) * 0.05);
        }
    }

    state.theatreSnap = {
        s,
        v,
        dir,
        phase,
        yaw: theatre.yaw,
        pitch: theatre.pitch,
        stageYaw: theatre.stageYaw,
        stagePitch: theatre.stagePitch,
        time: t
    };

    if (state.usePost && state.composer) {
        state.composer.render();
    } else {
        state.renderer.render(state.scene, state.camera);
    }

    if (state.frameHooks.length) {
        const payload = {
            camera: state.camera,
            theatre: state.theatreSnap,
            width: state.renderWidth,
            height: state.renderHeight
        };
        for (let i = 0; i < state.frameHooks.length; i += 1) {
            try {
                state.frameHooks[i](payload);
            } catch {
                /* ignore */
            }
        }
    }
}

function applyViewportSize(w, h, force = false) {
    if (!state.camera || !state.renderer) return;
    if (!force && w === state.renderWidth && h === state.renderHeight) return;

    state.renderWidth = w;
    state.renderHeight = h;

    // Mobile: lower internal resolution, stretch via CSS
    const rs = state.renderScale || 1;
    const bw = Math.max(1, Math.floor(w * rs));
    const bh = Math.max(1, Math.floor(h * rs));

    state.camera.aspect = w / Math.max(h, 1);
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(bw, bh, false);
    if (state.composer) state.composer.setSize(bw, bh);
    if (state.bloomPass) state.bloomPass.resolution.set(bw, bh);

    const pr = maxPixelRatio();
    state.renderer.setPixelRatio(pr);
    ['mist', 'stream', 'drift'].forEach((key) => {
        const obj = state[key];
        if (obj?.material?.uniforms?.pixelRatio) obj.material.uniforms.pixelRatio.value = pr;
    });
    if (state.anime?.userData) {
        const { orbs, speedLines } = state.anime.userData;
        if (orbs?.material?.uniforms?.pixelRatio) orbs.material.uniforms.pixelRatio.value = pr;
        if (speedLines?.material?.uniforms?.pixelRatio) speedLines.material.uniforms.pixelRatio.value = pr;
    }
    if (state.backdrop?.material?.uniforms) {
        state.backdrop.material.uniforms.resolution.value.set(bw, bh);
    }

    const canvas = state.renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.minHeight = '100lvh';
}

function onResize(force = false) {
    if (!state.camera || !state.renderer) return;
    const { w, h, changed } = getStableViewport();
    if (!force && !changed && state.renderWidth) return;
    applyViewportSize(w, h, force);
}

function scheduleResize(force = false) {
    if (state.resizeRaf) cancelAnimationFrame(state.resizeRaf);
    state.resizeRaf = requestAnimationFrame(() => {
        state.resizeRaf = 0;
        onResize(force);
    });
}

export function initThreeBackground() {
    if (state.initialized || typeof window === 'undefined' || !document.body) {
        return;
    }
    state.initialized = true;
    state.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.touchUi = detectTouchUi();
    const profile = detectMobileProfile(state.touchUi);
    state.mobile = profile.mobile || state.reducedMotion;

    // Quality ladder: desktop full → mobile lite → reduced-motion ultra-lite
    if (state.reducedMotion) {
        state.motionScale = 0.28;
        state.quality = 0.22;
        state.renderScale = 0.5;
        state.frameSkip = 3;
        state.usePost = false;
    } else if (state.mobile) {
        state.motionScale = 0.55;
        state.quality = profile.lowPower ? 0.22 : 0.32;
        state.renderScale = profile.lowPower ? 0.5 : 0.62;
        state.frameSkip = 2;
        state.usePost = false;
    } else {
        state.motionScale = 1;
        state.quality = 1;
        state.renderScale = 1;
        state.frameSkip = 1;
        state.usePost = true;
    }

    document.getElementById('three-bg-canvas')?.remove();

    state.clock = new THREE.Clock();
    state.scene = new THREE.Scene();
    state.scene.fog = new THREE.FogExp2(PALETTE.deep, state.mobile ? 0.0018 : 0.00145);

    const initialW = Math.max(1, window.innerWidth || 1);
    const initialH = Math.max(1, window.innerHeight || 1);
    state.lastLayoutWidth = initialW;
    state.renderWidth = initialW;
    state.renderHeight = initialH;

    state.baseFov = 55;
    state.camera = new THREE.PerspectiveCamera(state.baseFov, initialW / initialH, 0.5, state.mobile ? 700 : 1200);
    applyPageCamera(pageMode());
    state.camera.position.copy(state.cameraBase);

    const bw = Math.max(1, Math.floor(initialW * state.renderScale));
    const bh = Math.max(1, Math.floor(initialH * state.renderScale));

    state.renderer = new THREE.WebGLRenderer({
        antialias: !state.mobile && !state.reducedMotion,
        alpha: false,
        powerPreference: state.mobile ? 'low-power' : 'high-performance',
        stencil: false,
        depth: true
    });
    state.renderer.setPixelRatio(maxPixelRatio());
    state.renderer.setSize(bw, bh, false);
    state.renderer.setClearColor(PALETTE.deep, 1);
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    state.baseExposure = state.mobile ? 1.0 : 1.05;
    state.renderer.toneMappingExposure = state.baseExposure;
    // Avoid expensive shadow / mipmap work
    if (state.renderer.shadowMap) state.renderer.shadowMap.enabled = false;

    const canvas = state.renderer.domElement;
    canvas.id = 'three-bg-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.right = '0';
    canvas.style.bottom = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.minHeight = '100lvh';
    canvas.style.zIndex = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    document.body.prepend(canvas);

    createLights(state.scene);

    state.backdrop = createBackdrop();
    state.scene.add(state.backdrop);
    state.backdrop.matrixAutoUpdate = false;
    state.backdrop.matrixWorldAutoUpdate = false;

    state.root = new THREE.Group();
    state.scene.add(state.root);

    state.planeNear = new THREE.Group();
    state.planeMid = new THREE.Group();
    state.planeFar = new THREE.Group();
    state.planeNear.name = 'planeNear';
    state.planeMid.name = 'planeMid';
    state.planeFar.name = 'planeFar';
    state.root.add(state.planeFar, state.planeMid, state.planeNear);

    // Veils: 1 on mobile, 3 on desktop
    state.veilA = createVeil(380, 220, -40, PALETTE.primary, state.mobile ? 0.2 : 0.26, 0.38);
    state.veilA.userData.baseOpacity = state.mobile ? 0.2 : 0.26;
    state.veilA.rotation.x = -0.12;
    state.planeNear.add(state.veilA);

    if (!state.mobile) {
        state.veilB = createVeil(420, 240, -100, PALETTE.cyan, 0.2, 0.3);
        state.veilC = createVeil(460, 260, -170, PALETTE.mint, 0.16, 0.24);
        state.veilB.userData.baseOpacity = 0.2;
        state.veilC.userData.baseOpacity = 0.16;
        state.veilB.rotation.x = 0.08;
        state.veilB.rotation.y = 0.15;
        state.veilC.rotation.y = -0.1;
        state.planeMid.add(state.veilB);
        state.planeFar.add(state.veilC);
    }

    // Particles — huge cut on mobile
    const mistN = state.mobile
        ? Math.floor(380 * state.quality)
        : Math.floor((state.reducedMotion ? 900 : 2600) * state.quality);
    state.mist = createMist(Math.max(120, mistN));
    state.planeNear.add(state.mist);

    if (!state.mobile) {
        state.stream = createStream(Math.floor((state.reducedMotion ? 650 : 1900) * state.quality));
        state.planeMid.add(state.stream);
        state.drift = createDrift(Math.floor((state.reducedMotion ? 400 : 1100) * state.quality));
        state.planeMid.add(state.drift);
    }

    // Anime sky: desktop only (sheets + orbs + speed lines are heavy)
    if (!state.mobile && !state.reducedMotion) {
        state.anime = createAnimeSky({ touchUi: false, quality: state.quality });
        state.planeFar.add(state.anime);
    }

    // Post: desktop only — bloom/film is the biggest mobile killer
    if (state.usePost) {
        state.composer = new EffectComposer(state.renderer);
        state.composer.addPass(new RenderPass(state.scene, state.camera));
        state.baseBloom = 0.48;
        state.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(bw, bh),
            state.baseBloom,
            0.45,
            0.82
        );
        state.composer.addPass(state.bloomPass);
        state.filmPass = new ShaderPass(FilmShader);
        state.composer.addPass(state.filmPass);
    } else {
        state.composer = null;
        state.bloomPass = null;
        state.filmPass = null;
        state.baseBloom = 0;
    }

    if (!state.touchUi && !state.mobile) {
        document.addEventListener('pointermove', (e) => {
            if (e.pointerType && e.pointerType !== 'mouse') return;
            const rw = state.renderWidth || window.innerWidth || 1;
            const rh = state.renderHeight || window.innerHeight || 1;
            state.mouse.x = (e.clientX / rw) * 2 - 1;
            state.mouse.y = -(e.clientY / rh) * 2 + 1;
        }, { passive: true });
    } else {
        state.mouse.set(0, 0);
        state.smoothMouse.set(0, 0);
    }

    const flight = getFlightState();
    state.scroll = flight.progress;
    state.smoothScroll = flight.smoothProgress;
    state.speed = flight.speed;
    state.smoothSpeed = flight.speed;

    window.addEventListener('resize', () => scheduleResize(false), { passive: true });
    window.addEventListener('orientationchange', () => {
        state.lastLayoutWidth = 0;
        state.renderWidth = 0;
        state.renderHeight = 0;
        scheduleResize(true);
    }, { passive: true });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => scheduleResize(false), { passive: true });
    }

    // Pause WebGL when tab hidden
    document.addEventListener('visibilitychange', () => {
        state.pageVisible = document.visibilityState !== 'hidden';
        if (state.pageVisible && state.clock) state.clock.getDelta();
    });

    document.body.classList.add('has-three-bg');
    if (state.mobile) document.body.classList.add('has-three-bg--mobile');

    onResize(true);
    animate();
}
