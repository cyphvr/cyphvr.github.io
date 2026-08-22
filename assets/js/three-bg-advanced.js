import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { getFlightState } from './scroll-flight.js?v=20260822v15';

const PALETTE = {
    deep: 0x05070d,
    mid: 0x0a1222,
    ember: 0x7c9bff,
    cyan: 0x5eead4,
    violet: 0xa78bfa
};

export function sampleTheatre(s, v = 0, dir = 0) {
    const p = Math.min(1, Math.max(0, s));
    const e = p * p * (3 - 2 * p);
    const yaw = -0.62 + e * 1.55 + dir * v * 0.18;
    const pitch = 0.05 + Math.sin(e * Math.PI) * 0.22 + e * 0.18;
    const radius = 78 + Math.cos(e * Math.PI) * 22 - v * 8;
    const focus = {
        x: Math.sin(e * 1.7) * 14,
        y: 3 + e * 22,
        z: -12 - e * 36
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
        cam: {
            x: focus.x + sy * radius * cp,
            y: focus.y + sp * radius * 0.62 + 5,
            z: focus.z + cy * radius * cp
        },
        phase: e,
        stageYaw: -yaw * 0.48,
        stagePitch: -pitch * 0.2
    };
}

const state = {
    initialized: false,
    reducedMotion: false,
    mobile: false,
    usePost: true,
    renderScale: 1,
    frameSkip: 1,
    frameCount: 0,
    pageVisible: true,
    time: 0,
    motionScale: 1,
    quality: 1,
    mouse: new THREE.Vector2(),
    smoothMouse: new THREE.Vector2(),
    smoothScroll: 0,
    smoothSpeed: 0,
    dir: 0,
    camera: null,
    scene: null,
    renderer: null,
    composer: null,
    clock: null,
    volume: null,
    motes: null,
    embers: null,
    ash: null,
    bloomPass: null,
    gradePass: null,
    renderWidth: 0,
    renderHeight: 0,
    frameHooks: [],
    theatreSnap: null,
    targetCam: new THREE.Vector3(),
    _look: new THREE.Vector3(),
    _up: new THREE.Vector3(0, 1, 0),
    _m4: new THREE.Matrix4(),
    _quatTarget: new THREE.Quaternion()
};

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

const NOISE = `
vec3 hash33(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float n000 = dot(hash33(i), f);
    float n100 = dot(hash33(i + vec3(1,0,0)), f - vec3(1,0,0));
    float n010 = dot(hash33(i + vec3(0,1,0)), f - vec3(0,1,0));
    float n110 = dot(hash33(i + vec3(1,1,0)), f - vec3(1,1,0));
    float n001 = dot(hash33(i + vec3(0,0,1)), f - vec3(0,0,1));
    float n101 = dot(hash33(i + vec3(1,0,1)), f - vec3(1,0,1));
    float n011 = dot(hash33(i + vec3(0,1,1)), f - vec3(0,1,1));
    float n111 = dot(hash33(i + vec3(1,1,1)), f - vec3(1,1,1));
    return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = p * 2.03 + vec3(11.7, 5.3, 19.1);
        a *= 0.51;
    }
    return v * 0.5 + 0.5;
}
`;

function coverGeometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        -1, -1, 0, 3, -1, 0, -1, 3, 0
    ]), 3));
    return geo;
}

function createVolume(mobile) {
    const steps = mobile ? 8 : 14;
    const mat = new THREE.ShaderMaterial({
        depthWrite: false,
        depthTest: false,
        uniforms: {
            time: { value: 0 },
            scroll: { value: 0 },
            speed: { value: 0 },
            mouse: { value: new THREE.Vector2() },
            resolution: { value: new THREE.Vector2(1, 1) },
            colorDeep: { value: new THREE.Color(PALETTE.deep) },
            colorMid: { value: new THREE.Color(PALETTE.mid) },
            colorA: { value: new THREE.Color(PALETTE.ember) },
            colorB: { value: new THREE.Color(PALETTE.cyan) },
            colorC: { value: new THREE.Color(PALETTE.violet) }
        },
        vertexShader: `
            void main() {
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `,
        fragmentShader: `
            precision highp float;
            uniform float time;
            uniform float scroll;
            uniform float speed;
            uniform vec2 mouse;
            uniform vec2 resolution;
            uniform vec3 colorDeep;
            uniform vec3 colorMid;
            uniform vec3 colorA;
            uniform vec3 colorB;
            uniform vec3 colorC;
            ${NOISE}
            void main() {
                vec2 uv = gl_FragCoord.xy / max(resolution, vec2(1.0));
                vec2 p = uv * 2.0 - 1.0;
                p.x *= resolution.x / max(resolution.y, 1.0);

                float t = time * 0.06 + scroll * 1.15;
                vec3 ro = vec3(0.42 + mouse.x * 0.22, 0.08 + mouse.y * 0.12, 1.65 - scroll * 0.55);
                vec3 rd = normalize(vec3(p * 0.92, -1.38));

                vec3 col = mix(colorDeep, colorMid, 0.28 + uv.y * 0.35);
                float trans = 1.0;
                float z = 0.06;
                float energy = 0.14 + scroll * 0.1 + speed * 0.05;

                for (int i = 0; i < ${steps}; i++) {
                    vec3 pos = ro + rd * z;
                    pos += vec3(t * 0.21, scroll * 0.85, t * 0.13);
                    vec3 w = pos;
                    float n1 = fbm(pos * 0.55);
                    w.xy += (n1 - 0.5) * 0.55;
                    w.z += fbm(pos.zyx + t * 0.4) * 0.35;
                    float n = fbm(w * 0.7);
                    float dens = smoothstep(0.34, 0.78, n);
                    dens *= smoothstep(2.7, 0.35, length(pos.xy));
                    dens *= 0.55 + 0.45 * fbm(pos * 1.4 - t);

                    vec3 emit = mix(colorA, colorB, n);
                    emit = mix(emit, colorC, smoothstep(0.45, 1.0, scroll + n * 0.35));
                    float glow = pow(dens, 1.35);
                    col += emit * glow * trans * energy;
                    trans *= 1.0 - dens * 0.13;
                    z += 0.13 + (1.0 - n) * 0.08;
                }

                float well = exp(-length((p - vec2(-0.58, 0.02)) * vec2(1.5, 1.15)) * 2.2);
                col = mix(col, colorDeep, well * 0.58);
                float vig = smoothstep(1.82, 0.2, length(p * vec2(0.68, 1.0)));
                col *= 0.78 + vig * 0.28;
                col = min(col, vec3(0.72));
                gl_FragColor = vec4(col, 1.0);
            }
        `
    });
    const mesh = new THREE.Mesh(coverGeometry(), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -40;
    mesh.matrixAutoUpdate = false;
    mesh.onBeforeRender = () => { mesh.matrixWorld.identity(); };
    mesh.userData.mat = mat;
    return mesh;
}

function createField(count, kind) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.pow(Math.random(), 0.55) * 150;
        pos[i * 3] = Math.cos(a) * r * (0.7 + Math.random() * 0.8);
        pos[i * 3 + 1] = (Math.random() - 0.42) * 120;
        pos[i * 3 + 2] = -8 - Math.random() * 190;
        seed[i * 4] = Math.random() * 100;
        seed[i * 4 + 1] = 0.45 + Math.random() * (kind === 'ember' ? 2.4 : 1.5);
        seed[i * 4 + 2] = Math.random();
        seed[i * 4 + 3] = 0.35 + Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));

    const ember = kind === 'ember';
    const ash = kind === 'ash';
    const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
            time: { value: 0 },
            scroll: { value: 0 },
            speed: { value: 0 },
            pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.6) }
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
                float t = time * aSeed.w * ${ember ? '0.55' : ash ? '0.22' : '0.16'};
                float flow = 10.0 + scroll * 18.0 + speed * 24.0;
                p.x += sin(t + aSeed.x + p.y * 0.04) * ${ember ? '14.0' : '7.0'};
                p.y += cos(t * 0.71 + aSeed.z * 5.0) * ${ember ? '9.0' : '5.0'} + scroll * ${ember ? '36.0' : '18.0'};
                p.z += scroll * flow + sin(t * 0.4 + aSeed.x) * 6.0;
                ${ember ? `
                    p.x += sin(t * 1.7 + aSeed.z * 8.0) * 4.0;
                    p.y += t * aSeed.y * 2.2;
                ` : ''}
                float life = 0.5 + 0.5 * sin(t * 0.8 + aSeed.x);
                vAlpha = (${ember ? '0.28' : ash ? '0.1' : '0.16'} + aSeed.z * 0.32) * (0.55 + life * 0.45);
                vAlpha *= 0.62 + scroll * 0.22 + speed * 0.08;
                vec3 cA = vec3(0.49, 0.61, 1.0);
                vec3 cB = vec3(0.37, 0.92, 0.83);
                vec3 cC = vec3(0.66, 0.55, 0.98);
                vColor = mix(cA, cB, aSeed.z);
                vColor = mix(vColor, cC, smoothstep(0.55, 1.0, scroll * 0.7 + aSeed.z));
                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                float size = aSeed.y * pixelRatio * (${ember ? '88.0' : ash ? '46.0' : '120.0'} / max(1.0, -mv.z));
                size *= 0.85 + speed * 0.55 + life * 0.2;
                gl_PointSize = size;
            }
        `,
        fragmentShader: `
            precision highp float;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                vec2 uv = gl_PointCoord - 0.5;
                float d = length(uv);
                float edge = 0.48 + 0.04 * sin(uv.x * 12.0 + uv.y * 9.0);
                if (d > edge) discard;
                float core = exp(-d * ${ember ? '3.1' : '4.2'});
                float halo = exp(-d * 1.6) * 0.35;
                float a = (core + halo) * vAlpha;
                if (a < 0.012) discard;
                gl_FragColor = vec4(vColor, a);
            }
        `
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.userData.mat = mat;
    return pts;
}

const GradeShader = {
    uniforms: {
        tDiffuse: { value: null },
        time: { value: 0 },
        scroll: { value: 0 },
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
        uniform float scroll;
        uniform float speed;
        varying vec2 vUv;
        void main() {
            vec2 uv = vUv;
            vec2 c = uv - 0.5;
            float d = length(c);
            float ab = (0.0012 + speed * 0.003 + scroll * 0.0008) * d;
            float r = texture2D(tDiffuse, uv + c * ab).r;
            float g = texture2D(tDiffuse, uv).g;
            float b = texture2D(tDiffuse, uv - c * ab).b;
            vec3 col = vec3(r, g, b);
            col += (fract(sin(dot(uv * 740.0 + time, vec2(12.9, 78.2))) * 43758.5) - 0.5) * 0.028;
            float pulse = 0.97 + 0.03 * sin(time * 1.3 + scroll * 6.0);
            col *= pulse;
            col *= mix(0.76, 1.0, smoothstep(0.05, 0.72, d));
            gl_FragColor = vec4(min(col, vec3(0.92)), 1.0);
        }
    `
};

function detectMobile() {
    try {
        const touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
        const narrow = Math.min(window.innerWidth, window.innerHeight) < 820;
        return touch || narrow || (navigator.hardwareConcurrency || 8) <= 4;
    } catch {
        return false;
    }
}

function animate() {
    requestAnimationFrame(animate);
    if (!state.renderer || !state.pageVisible) return;
    state.frameCount += 1;
    if (state.frameSkip > 1 && state.frameCount % state.frameSkip !== 0) {
        state.clock.getDelta();
        return;
    }
    const dt = Math.min(state.clock.getDelta(), 0.05);
    state.time += dt * state.motionScale;
    const t = state.time;
    const flight = getFlightState();
    const homing = flight.target <= 8 && flight.y > 140;
    if (homing) {
        state.smoothScroll += (0 - state.smoothScroll) * 0.28;
        state.smoothSpeed *= 0.7;
    } else {
        state.smoothScroll += (flight.smoothProgress - state.smoothScroll) * (state.mobile ? 0.18 : 0.1);
        state.smoothSpeed += (Math.min(0.45, flight.speed) - state.smoothSpeed) * 0.12;
    }
    state.dir += ((flight.direction || 0) - state.dir) * 0.08;
    const theatre = sampleTheatre(state.smoothScroll, state.smoothSpeed, state.dir);
    state.smoothMouse.lerp(state.mouse, 0.05);

    const uVol = state.volume?.userData?.mat?.uniforms;
    if (uVol) {
        uVol.time.value = t;
        uVol.scroll.value = theatre.phase;
        uVol.speed.value = state.smoothSpeed;
        uVol.mouse.value.copy(state.smoothMouse);
        uVol.resolution.value.set(state.renderWidth, state.renderHeight);
    }
    [state.motes, state.embers, state.ash].forEach((pts) => {
        if (!pts?.userData?.mat?.uniforms) return;
        const u = pts.userData.mat.uniforms;
        u.time.value = t;
        u.scroll.value = theatre.phase;
        u.speed.value = state.smoothSpeed;
    });

    const par = state.mobile ? 0 : 1;
    state.targetCam.set(
        theatre.cam.x + state.smoothMouse.x * 16 * par,
        theatre.cam.y + state.smoothMouse.y * 9 * par,
        theatre.cam.z
    );
    state.camera.position.lerp(state.targetCam, 0.065 + state.smoothSpeed * 0.04);
    state._look.set(
        theatre.focus.x + state.smoothMouse.x * 11 * par,
        theatre.focus.y + 2 + Math.sin(theatre.phase * Math.PI) * 4,
        theatre.focus.z
    );
    state._m4.lookAt(state.camera.position, state._look, state._up);
    state._quatTarget.setFromRotationMatrix(state._m4);
    state.camera.quaternion.slerp(state._quatTarget, 0.075);

    if (state.bloomPass) {
        const bloom = homing
            ? 0.28
            : 0.34 + theatre.phase * 0.08 + state.smoothSpeed * 0.05;
        state.bloomPass.strength = bloom;
    }
    if (state.gradePass) {
        state.gradePass.uniforms.time.value = t;
        state.gradePass.uniforms.scroll.value = theatre.phase;
        state.gradePass.uniforms.speed.value = state.smoothSpeed;
    }

    state.theatreSnap = {
        s: state.smoothScroll,
        v: state.smoothSpeed,
        dir: state.dir,
        phase: theatre.phase,
        yaw: theatre.yaw,
        pitch: theatre.pitch,
        stageYaw: theatre.stageYaw,
        stagePitch: theatre.stagePitch,
        time: t
    };

    if (state.usePost && state.composer) state.composer.render();
    else state.renderer.render(state.scene, state.camera);

    if (state.frameHooks.length) {
        const payload = { camera: state.camera, theatre: state.theatreSnap, width: state.renderWidth, height: state.renderHeight };
        for (let i = 0; i < state.frameHooks.length; i++) {
            try { state.frameHooks[i](payload); } catch { /* */ }
        }
    }
}

function applySize(w, h) {
    state.renderWidth = w;
    state.renderHeight = h;
    const bw = Math.max(1, Math.floor(w * state.renderScale));
    const bh = Math.max(1, Math.floor(h * state.renderScale));
    state.camera.aspect = w / Math.max(h, 1);
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(bw, bh, false);
    if (state.composer) state.composer.setSize(bw, bh);
    if (state.bloomPass) state.bloomPass.resolution.set(bw, bh);
    const canvas = state.renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const pr = Math.min(window.devicePixelRatio || 1, state.mobile ? 1 : 1.6);
    [state.motes, state.embers, state.ash].forEach((pts) => {
        if (pts?.userData?.mat?.uniforms?.pixelRatio) pts.userData.mat.uniforms.pixelRatio.value = pr;
    });
}

export function initThreeBackground() {
    if (state.initialized || typeof window === 'undefined' || !document.body) return;
    state.initialized = true;
    state.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.mobile = detectMobile() || state.reducedMotion;
    if (state.reducedMotion) {
        state.motionScale = 0.28;
        state.quality = 0.3;
        state.renderScale = 0.55;
        state.frameSkip = 3;
        state.usePost = false;
    } else if (state.mobile) {
        state.motionScale = 0.7;
        state.quality = 0.42;
        state.renderScale = 0.64;
        state.frameSkip = 2;
        state.usePost = false;
    }

    document.getElementById('three-bg-canvas')?.remove();
    state.clock = new THREE.Clock();
    state.scene = new THREE.Scene();

    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    state.camera = new THREE.PerspectiveCamera(54, w / h, 0.35, 900);
    state.camera.position.set(0, 6, 72);
    state.targetCam.copy(state.camera.position);

    state.renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: state.mobile ? 'low-power' : 'high-performance',
        depth: false
    });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, state.mobile ? 1 : 1.6));
    state.renderer.setClearColor(PALETTE.deep, 1);
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    state.renderer.toneMappingExposure = 1.08;
    const canvas = state.renderer.domElement;
    canvas.id = 'three-bg-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
        position: 'fixed', inset: '0', width: '100%', height: '100%',
        zIndex: '0', pointerEvents: 'none', display: 'block'
    });
    document.body.prepend(canvas);

    state.volume = createVolume(state.mobile);
    state.scene.add(state.volume);

    const q = state.quality;
    state.motes = createField(Math.max(220, Math.floor((state.mobile ? 700 : 2200) * q)), 'mote');
    state.embers = createField(Math.max(160, Math.floor((state.mobile ? 420 : 1400) * q)), 'ember');
    state.ash = createField(Math.max(120, Math.floor((state.mobile ? 280 : 900) * q)), 'ash');
    state.scene.add(state.motes, state.embers, state.ash);

    if (state.usePost) {
        const bw = Math.max(1, Math.floor(w * state.renderScale));
        const bh = Math.max(1, Math.floor(h * state.renderScale));
        state.composer = new EffectComposer(state.renderer);
        state.composer.addPass(new RenderPass(state.scene, state.camera));
        state.bloomPass = new UnrealBloomPass(new THREE.Vector2(bw, bh), 0.36, 0.42, 0.48);
        state.composer.addPass(state.bloomPass);
        state.gradePass = new ShaderPass(GradeShader);
        state.composer.addPass(state.gradePass);
    }

    if (!state.mobile) {
        document.addEventListener('pointermove', (e) => {
            if (e.pointerType && e.pointerType !== 'mouse') return;
            const rw = state.renderWidth || w;
            const rh = state.renderHeight || h;
            state.mouse.set((e.clientX / rw) * 2 - 1, -(e.clientY / rh) * 2 + 1);
        }, { passive: true });
    }

    window.addEventListener('resize', () => applySize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight)), { passive: true });
    document.addEventListener('visibilitychange', () => {
        state.pageVisible = document.visibilityState !== 'hidden';
        if (state.pageVisible) state.clock.getDelta();
    });

    document.body.classList.add('has-three-bg');
    applySize(w, h);
    animate();
}
