import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Site-wide Three.js background.
 * Full-viewport abstract field in the Cypher palette (not space-themed).
 */

const PALETTE = {
    deep: 0x05081a,
    mid: 0x09102a,
    edge: 0x121a3a,
    primary: 0x8a9bff,
    cyan: 0x67dbff,
    mint: 0x72ffd6,
    rose: 0xff7fc9
};

const state = {
    initialized: false,
    reducedMotion: false,
    touchUi: false,
    time: 0,
    motionScale: 1,
    quality: 1,
    mouse: new THREE.Vector2(0, 0),
    smoothMouse: new THREE.Vector2(0, 0),
    cameraBase: new THREE.Vector3(0, 0, 140),
    targetCam: new THREE.Vector3(0, 0, 140),
    lookAt: new THREE.Vector3(0, 0, -80),
    camera: null,
    scene: null,
    renderer: null,
    composer: null,
    clock: null,
    root: null,
    backdrop: null,
    veilA: null,
    veilB: null,
    veilC: null,
    mist: null,
    stream: null,
    drift: null,
    shards: null,
    shardData: [],
    ribbons: null,
    bloomPass: null,
    filmPass: null,
    tempObject: new THREE.Object3D(),
    // Stable viewport (mobile URL bar show/hide must not re-size WebGL)
    renderWidth: 0,
    renderHeight: 0,
    lastLayoutWidth: 0,
    resizeRaf: 0
};

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
float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p += dot(p, p.yzx + 19.19);
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = p * 2.03 + 13.1;
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
            mouse: { value: new THREE.Vector2(0, 0) },
            resolution: { value: new THREE.Vector2(1, 1) },
            colorDeep: { value: new THREE.Color(PALETTE.deep) },
            colorMid: { value: new THREE.Color(PALETTE.mid) },
            colorEdge: { value: new THREE.Color(PALETTE.edge) },
            colorPrimary: { value: new THREE.Color(PALETTE.primary) },
            colorCyan: { value: new THREE.Color(PALETTE.cyan) },
            colorMint: { value: new THREE.Color(PALETTE.mint) },
            colorRose: { value: new THREE.Color(PALETTE.rose) }
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
            uniform vec2 mouse;
            uniform vec2 resolution;
            uniform vec3 colorDeep;
            uniform vec3 colorMid;
            uniform vec3 colorEdge;
            uniform vec3 colorPrimary;
            uniform vec3 colorCyan;
            uniform vec3 colorMint;
            uniform vec3 colorRose;
            ${NOISE_GLSL}

            void main() {
                vec2 uv = vUv;
                vec2 p = (gl_FragCoord.xy / max(resolution, vec2(1.0))) * 2.0 - 1.0;
                p.x *= resolution.x / max(resolution.y, 1.0);

                float t = time * 0.04;
                float n1 = fbm(vec3(uv * 2.2 + vec2(t * 0.4, -t * 0.25), t * 0.3));
                float n2 = fbm(vec3(uv * 4.5 - vec2(t * 0.2, t * 0.35), -t * 0.2));
                float n3 = fbm(vec3((uv + mouse * 0.06) * 7.0, t * 0.5));

                vec3 col = mix(colorDeep, colorMid, smoothstep(-0.1, 1.1, uv.y + n1 * 0.18));
                col = mix(col, colorEdge, n2 * 0.28);

                // Corner / edge energy so the frame is active, not only the middle
                float c1 = exp(-length(p - vec2(-1.15, 0.55)) * 1.1);
                float c2 = exp(-length(p - vec2(1.2, -0.45)) * 1.15);
                float c3 = exp(-length(p - vec2(0.15, 1.05)) * 1.25);
                float c4 = exp(-length(p - vec2(-0.2, -1.1)) * 1.2);
                col += colorPrimary * c1 * 0.3;
                col += colorCyan * c2 * 0.24;
                col += colorMint * c3 * 0.14;
                col += colorRose * c4 * 0.11;

                float bands = 0.5 + 0.5 * sin((uv.y + n1 * 0.2) * 9.0 - t * 2.0);
                col += mix(colorPrimary, colorCyan, uv.x) * bands * n2 * 0.09;

                float speck = smoothstep(0.74, 0.92, n3);
                col += mix(colorCyan, colorPrimary, speck) * speck * 0.07;

                col += (hash(vec3(uv * 40.0, t)) - 0.5) * 0.018;
                float vig = smoothstep(1.75, 0.3, length(p * vec2(0.72, 1.0)));
                col *= 0.74 + vig * 0.36;

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
                float n = fbm(vec3(uv * 3.2, t));
                float n2 = fbm(vec3(uv * 6.0 - t * 0.4, t * 0.6));
                // Soft sheets — visible across whole plane, not a radial core
                float sheet = smoothstep(0.2, 0.75, n) * (0.35 + 0.65 * n2);
                float edge = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x)
                           * smoothstep(0.0, 0.1, uv.y) * smoothstep(1.0, 0.9, uv.y);
                float wave = 0.55 + 0.45 * sin(uv.x * 8.0 + t * 2.0 + n * 3.0);
                float a = sheet * edge * wave * opacity;
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
            mouse: { value: new THREE.Vector2(0, 0) },
            pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.75) }
        },
        vertexShader: `
            attribute vec4 aSeed;
            uniform float time;
            uniform float pixelRatio;
            uniform vec2 mouse;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                vec3 p = position;
                float t = time * aSeed.w * 0.25;
                p.x += sin(t + aSeed.x) * 12.0 + mouse.x * 18.0 * aSeed.z;
                p.y += cos(t * 0.8 + aSeed.x * 0.5) * 8.0 + mouse.y * 12.0 * aSeed.z;
                p.z += sin(t * 0.5 + aSeed.z * 4.0) * 6.0;

                vAlpha = 0.12 + aSeed.z * 0.28;
                vColor = mix(vec3(0.54, 0.61, 1.0), vec3(0.4, 0.86, 1.0), aSeed.z);
                vColor = mix(vColor, vec3(0.45, 1.0, 0.84), step(0.75, aSeed.z) * 0.7);

                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = aSeed.y * pixelRatio * (140.0 / max(1.0, -mv.z));
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
        const lane = Math.floor(Math.random() * 14);
        positions[i * 3] = (Math.random() - 0.5) * 360;
        positions[i * 3 + 1] = -90 + lane * 14 + (Math.random() - 0.5) * 6;
        positions[i * 3 + 2] = -30 - Math.random() * 200;
        seeds[i * 4] = Math.random() * Math.PI * 2;
        seeds[i * 4 + 1] = 18 + Math.random() * 55; // speed
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
            pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.75) }
        },
        vertexShader: `
            attribute vec4 aSeed;
            uniform float time;
            uniform float pixelRatio;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                vec3 p = position;
                float span = 380.0;
                float x = mod(p.x + time * aSeed.y + aSeed.x * 10.0 + span * 0.5, span) - span * 0.5;
                p.x = x;
                p.y += sin(time * 0.6 + aSeed.x * 3.0 + p.x * 0.02) * 3.5;

                vAlpha = 0.22 + aSeed.z * 0.45;
                vColor = mix(vec3(0.4, 0.86, 1.0), vec3(0.54, 0.61, 1.0), aSeed.z);

                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                // Streaky points feel like motion lines
                gl_PointSize = aSeed.w * pixelRatio * (55.0 / max(1.0, -mv.z));
            }
        `,
        fragmentShader: `
            precision highp float;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                vec2 uv = gl_PointCoord - 0.5;
                // Elongated soft dash
                uv.x *= 0.35;
                float d = length(uv);
                float a = smoothstep(0.5, 0.0, d) * vAlpha;
                if (a < 0.01) discard;
                gl_FragColor = vec4(vColor, a);
            }
        `
    });

    return new THREE.Points(geometry, material);
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
            pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.75) }
        },
        vertexShader: `
            attribute vec4 aSeed;
            uniform float time;
            uniform float pixelRatio;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                vec3 p = position;
                float span = 200.0;
                p.y = mod(p.y + time * aSeed.y * 0.35 + aSeed.x + span * 0.5, span) - span * 0.5;
                p.x += sin(time * 0.3 + aSeed.x) * 4.0;

                vAlpha = 0.15 + aSeed.z * 0.3;
                vColor = mix(vec3(0.45, 1.0, 0.84), vec3(0.82, 0.72, 1.0), aSeed.z);

                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = aSeed.w * pixelRatio * (48.0 / max(1.0, -mv.z));
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

/* Distributed glass shards across the volume (not clustered center) */
function createShards(count) {
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({
        color: 0xa8b6ff,
        emissive: 0x4a5fd4,
        emissiveIntensity: 0.35,
        metalness: 0.55,
        roughness: 0.25,
        transparent: true,
        opacity: 0.55,
        flatShading: true
    });

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const data = [];
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
        const x = (Math.random() - 0.5) * 280;
        const y = (Math.random() - 0.5) * 160;
        const z = -30 - Math.random() * 200;
        const scale = 0.6 + Math.random() * 2.4;
        data.push({
            x, y, z,
            scale,
            phase: Math.random() * Math.PI * 2,
            spin: 0.2 + Math.random() * 0.8,
            drift: 0.4 + Math.random() * 1.2,
            amp: 4 + Math.random() * 10
        });
        color.setHSL(0.55 + Math.random() * 0.12, 0.55, 0.55 + Math.random() * 0.2);
        mesh.setColorAt(i, color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    return { mesh, data };
}

/* Wide freeform ribbons spanning left-right */
function createRibbons(count = 5) {
    const group = new THREE.Group();
    const total = Math.max(1, count);

    for (let i = 0; i < total; i++) {
        const pts = [];
        const samples = 28;
        const yBase = -50 + i * 24;
        const zBase = -60 - i * 28;
        for (let j = 0; j < samples; j++) {
            const t = j / (samples - 1);
            const x = -160 + t * 320;
            pts.push(new THREE.Vector3(
                x,
                yBase + Math.sin(t * Math.PI * 2 + i) * (10 + i * 3),
                zBase + Math.cos(t * Math.PI * 1.5 + i * 0.7) * 16
            ));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const geo = new THREE.TubeGeometry(curve, 80, 0.45 + i * 0.12, 5, false);
        const mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                time: { value: 0 },
                color: { value: new THREE.Color(i % 2 ? PALETTE.cyan : PALETTE.primary) },
                speed: { value: 0.5 + i * 0.12 }
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
                uniform float speed;
                void main() {
                    float pulse = 0.45 + 0.55 * sin(vUv.x * 40.0 - time * speed * 5.0);
                    float edge = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
                    float a = (0.06 + pulse * 0.14) * edge;
                    gl_FragColor = vec4(color, a);
                }
            `
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.mat = mat;
        mesh.userData.offset = i * 0.4;
        group.add(mesh);
    }
    return group;
}

const FilmShader = {
    uniforms: {
        tDiffuse: { value: null },
        time: { value: 0 },
        amount: { value: 1 }
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
        varying vec2 vUv;
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        void main() {
            vec2 uv = vUv;
            vec2 c = uv - 0.5;
            float d = length(c);
            float ab = 0.0012 * amount * (0.35 + d);
            float r = texture2D(tDiffuse, uv + c * ab).r;
            float g = texture2D(tDiffuse, uv).g;
            float b = texture2D(tDiffuse, uv - c * ab).b;
            vec3 col = vec3(r, g, b);
            col += (hash(uv * vec2(1600.0, 900.0) + time * 8.0) - 0.5) * 0.045 * amount;
            // Soft edge treatment — keep periphery bright enough
            float vig = smoothstep(1.35, 0.2, d);
            col *= mix(1.0, vig, 0.35 * amount);
            gl_FragColor = vec4(col, 1.0);
        }
    `
};

function createLights(scene) {
    scene.add(new THREE.AmbientLight(0xb0c0ff, 0.55));
    // Multiple keys so lighting is even across the field
    const L = [
        [0x8a9bff, 1.2, -120, 40, 20],
        [0x67dbff, 1.0, 130, -20, -40],
        [0x72ffd6, 0.7, 20, 80, -100],
        [0xff7fc9, 0.45, -40, -70, -60]
    ];
    L.forEach(([hex, intensity, x, y, z]) => {
        const light = new THREE.PointLight(hex, intensity, 500, 2);
        light.position.set(x, y, z);
        scene.add(light);
    });
}

function animate() {
    requestAnimationFrame(animate);
    if (!state.renderer || !state.scene || !state.camera) return;

    const dt = Math.min(state.clock.getDelta(), 0.05);
    const scale = state.motionScale;
    state.time += dt * scale;
    const t = state.time;

    state.smoothMouse.x += (state.mouse.x - state.smoothMouse.x) * 0.045;
    state.smoothMouse.y += (state.mouse.y - state.smoothMouse.y) * 0.045;

    if (state.backdrop?.material?.uniforms) {
        state.backdrop.material.uniforms.time.value = t;
        state.backdrop.material.uniforms.mouse.value.copy(state.smoothMouse);
        state.backdrop.material.uniforms.resolution.value.set(
            state.renderWidth || window.innerWidth,
            state.renderHeight || window.innerHeight
        );
    }

    [state.veilA, state.veilB, state.veilC].forEach((veil, i) => {
        if (!veil) return;
        if (veil.userData.material) {
            veil.userData.material.uniforms.time.value = t;
            veil.userData.material.uniforms.mouse.value.copy(state.smoothMouse);
        }
        veil.position.x = Math.sin(t * (0.08 + i * 0.03) + i) * (12 + i * 4) + state.smoothMouse.x * (10 + i * 4);
        veil.position.y = Math.cos(t * (0.06 + i * 0.02) + i * 1.3) * (6 + i * 2) + state.smoothMouse.y * (6 + i * 2);
        veil.rotation.z = Math.sin(t * 0.05 + i) * 0.08;
        veil.rotation.y = Math.sin(t * 0.04 + i * 0.5) * 0.12;
    });

    if (state.mist?.material?.uniforms) {
        state.mist.material.uniforms.time.value = t;
        state.mist.material.uniforms.mouse.value.copy(state.smoothMouse);
    }

    if (state.stream?.material?.uniforms) {
        state.stream.material.uniforms.time.value = t;
    }

    if (state.drift?.material?.uniforms) {
        state.drift.material.uniforms.time.value = t;
    }

    if (state.ribbons) {
        state.ribbons.children.forEach((mesh) => {
            if (mesh.userData.mat) mesh.userData.mat.uniforms.time.value = t;
            mesh.position.y = Math.sin(t * 0.15 + mesh.userData.offset) * 3;
        });
    }

    if (state.shards && state.shardData.length) {
        for (let i = 0; i < state.shardData.length; i++) {
            const d = state.shardData[i];
            const ox = d.x + Math.sin(t * d.drift + d.phase) * d.amp + state.smoothMouse.x * 8;
            const oy = d.y + Math.cos(t * d.drift * 0.8 + d.phase) * d.amp * 0.6 + state.smoothMouse.y * 5;
            const oz = d.z + Math.sin(t * 0.2 + d.phase) * 4;
            state.tempObject.position.set(ox, oy, oz);
            state.tempObject.rotation.set(
                t * d.spin * 0.4 + d.phase,
                t * d.spin * 0.55,
                t * d.spin * 0.25
            );
            const s = d.scale * (1 + Math.sin(t * 0.8 + d.phase) * 0.08 * scale);
            state.tempObject.scale.setScalar(s);
            state.tempObject.updateMatrix();
            state.shards.setMatrixAt(i, state.tempObject.matrix);
        }
        state.shards.instanceMatrix.needsUpdate = true;
    }

    // Touch UIs: no pointer parallax (scroll was driving mouse → background jumps)
    const parallax = state.reducedMotion ? 0.12 : state.touchUi ? 0 : 1;
    state.targetCam.x = state.cameraBase.x + state.smoothMouse.x * 22 * parallax + Math.sin(t * 0.07) * 6 * scale;
    state.targetCam.y = state.cameraBase.y + state.smoothMouse.y * 14 * parallax + Math.cos(t * 0.09) * 4 * scale;
    state.targetCam.z = state.cameraBase.z + Math.sin(t * 0.05) * 5 * scale;

    state.camera.position.x += (state.targetCam.x - state.camera.position.x) * 0.035;
    state.camera.position.y += (state.targetCam.y - state.camera.position.y) * 0.035;
    state.camera.position.z += (state.targetCam.z - state.camera.position.z) * 0.035;

    const look = state.lookAt.clone();
    look.x += state.smoothMouse.x * 18 * parallax + Math.sin(t * 0.06) * 10;
    look.y += state.smoothMouse.y * 10 * parallax;
    state.camera.lookAt(look);

    if (state.filmPass) {
        state.filmPass.uniforms.time.value = t;
        state.filmPass.uniforms.amount.value = state.reducedMotion ? 0.4 : 0.85;
    }

    if (state.composer) {
        state.composer.render();
    } else {
        state.renderer.render(state.scene, state.camera);
    }
}

function applyViewportSize(w, h, force = false) {
    if (!state.camera || !state.renderer) return;
    if (!force && w === state.renderWidth && h === state.renderHeight) return;

    state.renderWidth = w;
    state.renderHeight = h;

    state.camera.aspect = w / Math.max(h, 1);
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h, false);
    if (state.composer) state.composer.setSize(w, h);
    if (state.bloomPass) state.bloomPass.resolution.set(w, h);

    const maxDpr = state.reducedMotion ? 1.1 : state.touchUi ? 1.35 : 1.75;
    const pr = Math.min(window.devicePixelRatio || 1, maxDpr);
    state.renderer.setPixelRatio(pr);
    ['mist', 'stream', 'drift'].forEach((key) => {
        const obj = state[key];
        if (obj?.material?.uniforms?.pixelRatio) obj.material.uniforms.pixelRatio.value = pr;
    });
    if (state.backdrop?.material?.uniforms) {
        state.backdrop.material.uniforms.resolution.value.set(w, h);
    }

    const canvas = state.renderer.domElement;
    // CSS covers the visual viewport; GL buffer stays at stable size (no scroll jump)
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

    // Same visual theme on mobile and desktop; only honor reduced-motion preference
    state.motionScale = state.reducedMotion ? 0.35 : 1;
    state.quality = state.reducedMotion ? 0.55 : 1;

    document.getElementById('three-bg-canvas')?.remove();

    state.clock = new THREE.Clock();
    state.scene = new THREE.Scene();
    state.scene.fog = new THREE.FogExp2(PALETTE.deep, 0.0024);

    const initialW = Math.max(1, window.innerWidth || 1);
    const initialH = Math.max(1, window.innerHeight || 1);
    state.lastLayoutWidth = initialW;
    state.renderWidth = initialW;
    state.renderHeight = initialH;

    state.camera = new THREE.PerspectiveCamera(55, initialW / initialH, 0.5, 900);
    applyPageCamera(pageMode());
    state.camera.position.copy(state.cameraBase);

    // Cap DPR only (does not change composition); full scene layers stay identical
    const maxDpr = state.reducedMotion ? 1.1 : state.touchUi ? 1.35 : Math.min(window.devicePixelRatio || 1, 1.75);
    state.renderer = new THREE.WebGLRenderer({
        antialias: !state.reducedMotion && !state.touchUi,
        alpha: false,
        powerPreference: 'high-performance'
    });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    state.renderer.setSize(initialW, initialH, false);
    state.renderer.setClearColor(PALETTE.deep, 1);
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    state.renderer.toneMappingExposure = 1.0;
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

    // Fullscreen NDC backdrop (always fills the view)
    state.backdrop = createBackdrop();
    // Parent to scene; draw with depthTest false first via renderOrder
    state.scene.add(state.backdrop);
    // Override matrix auto update so it stays fullscreen
    state.backdrop.matrixAutoUpdate = false;
    state.backdrop.matrixWorldAutoUpdate = false;

    state.root = new THREE.Group();
    state.scene.add(state.root);

    // Same layers on every device so the theme matches desktop
    state.veilA = createVeil(380, 220, -40, PALETTE.primary, 0.14, 0.35);
    state.veilB = createVeil(420, 240, -100, PALETTE.cyan, 0.11, 0.28);
    state.veilC = createVeil(460, 260, -170, PALETTE.mint, 0.08, 0.22);
    state.veilA.rotation.x = -0.12;
    state.veilB.rotation.x = 0.08;
    state.veilB.rotation.y = 0.15;
    state.veilC.rotation.y = -0.1;
    state.root.add(state.veilA, state.veilB, state.veilC);

    state.mist = createMist(Math.floor((state.reducedMotion ? 700 : 1800) * state.quality));
    state.root.add(state.mist);

    state.stream = createStream(Math.floor((state.reducedMotion ? 500 : 1400) * state.quality));
    state.root.add(state.stream);

    state.drift = createDrift(Math.floor((state.reducedMotion ? 300 : 800) * state.quality));
    state.root.add(state.drift);

    const shards = createShards(Math.floor((state.reducedMotion ? 40 : 90) * state.quality));
    state.shards = shards.mesh;
    state.shardData = shards.data;
    state.root.add(state.shards);

    state.ribbons = createRibbons(5);
    state.root.add(state.ribbons);

    // Post stack — same look desktop and mobile
    state.composer = new EffectComposer(state.renderer);
    state.composer.addPass(new RenderPass(state.scene, state.camera));
    state.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(initialW, initialH),
        state.reducedMotion ? 0.35 : state.touchUi ? 0.42 : 0.55,
        0.7,
        0.82
    );
    state.composer.addPass(state.bloomPass);
    state.filmPass = new ShaderPass(FilmShader);
    state.composer.addPass(state.filmPass);

    // Desktop only: pointer parallax. Touch scroll was feeding pointermove → jump/stop.
    if (!state.touchUi) {
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

    window.addEventListener('resize', () => scheduleResize(false), { passive: true });
    window.addEventListener('orientationchange', () => {
        state.lastLayoutWidth = 0;
        state.renderWidth = 0;
        state.renderHeight = 0;
        scheduleResize(true);
    }, { passive: true });

    // visualViewport fires on mobile chrome changes — ignore height-only via getStableViewport
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => scheduleResize(false), { passive: true });
    }

    document.body.classList.add('has-three-bg');

    onResize(true);
    animate();
}
