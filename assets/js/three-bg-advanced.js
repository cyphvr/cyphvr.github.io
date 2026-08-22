import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { getFlightState } from './scroll-flight.js?v=20260822v10';

const PALETTE = {
    deep: 0x05070e,
    mid: 0x0c1428,
    primary: 0x7c9bff,
    cyan: 0x5eead4,
    violet: 0xa78bfa,
    mint: 0x67e8f9
};

export function sampleTheatre(s, v = 0, dir = 0) {
    const p = Math.min(1, Math.max(0, s));
    const e = p * p * (3 - 2 * p);
    const yaw = -0.55 + e * 1.35 + dir * v * 0.14;
    const pitch = 0.04 + e * 0.32 + Math.sin(e * Math.PI) * 0.05;
    const radius = 92 + Math.sin(e * Math.PI) * 18 - v * 6;
    const focus = {
        x: Math.sin(e * 1.4) * 10,
        y: 4 + e * 16,
        z: -20 - e * 28
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
            y: focus.y + sp * radius * 0.7 + 4,
            z: focus.z + cy * radius * cp
        },
        phase: e,
        stageYaw: -yaw * 0.5,
        stagePitch: -pitch * 0.22
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
    scroll: 0,
    smoothScroll: 0,
    speed: 0,
    smoothSpeed: 0,
    dir: 0,
    camera: null,
    scene: null,
    renderer: null,
    composer: null,
    clock: null,
    volume: null,
    auroraA: null,
    auroraB: null,
    dust: null,
    rivers: null,
    bloomPass: null,
    gradePass: null,
    renderWidth: 0,
    renderHeight: 0,
    lastLayoutWidth: 0,
    resizeRaf: 0,
    frameHooks: [],
    theatreSnap: null,
    targetCam: new THREE.Vector3(),
    _look: new THREE.Vector3(),
    _up: new THREE.Vector3(0, 1, 0),
    _m4: new THREE.Matrix4(),
    _quat: new THREE.Quaternion(),
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
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.07 + vec3(17.1, 9.4, 3.7);
        a *= 0.5;
    }
    return v * 0.5 + 0.5;
}
`;

function createVolume(mobile) {
    const steps = mobile ? 6 : 10;
    const material = new THREE.ShaderMaterial({
        depthWrite: false,
        depthTest: false,
        uniforms: {
            time: { value: 0 },
            scroll: { value: 0 },
            mouse: { value: new THREE.Vector2() },
            resolution: { value: new THREE.Vector2(1, 1) },
            colorDeep: { value: new THREE.Color(PALETTE.deep) },
            colorMid: { value: new THREE.Color(PALETTE.mid) },
            colorA: { value: new THREE.Color(PALETTE.primary) },
            colorB: { value: new THREE.Color(PALETTE.cyan) },
            colorC: { value: new THREE.Color(PALETTE.violet) }
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
            uniform vec3 colorA;
            uniform vec3 colorB;
            uniform vec3 colorC;
            ${NOISE}
            void main() {
                vec2 p = (gl_FragCoord.xy / max(resolution, vec2(1.0))) * 2.0 - 1.0;
                p.x *= resolution.x / max(resolution.y, 1.0);
                float t = time * 0.05 + scroll * 0.7;
                vec3 ro = vec3(0.35 + mouse.x * 0.2, 0.1 + mouse.y * 0.1, 2.0 - scroll * 0.35);
                vec3 rd = normalize(vec3(p * 0.9, -1.42));
                vec3 col = mix(colorDeep, colorMid, 0.35 + vUv.y * 0.28);
                float trans = 1.0;
                float z = 0.1;
                for (int i = 0; i < ${steps}; i++) {
                    vec3 pos = ro + rd * z;
                    pos += vec3(t * 0.18, scroll * 0.55, t * 0.12);
                    vec3 q = pos;
                    q.xy += 0.28 * vec2(fbm(pos + t * 0.7), fbm(pos.zyx - t * 0.55));
                    float n = fbm(q * 0.62);
                    float dens = smoothstep(0.36, 0.74, n);
                    dens *= smoothstep(2.6, 0.4, length(pos.xy));
                    vec3 emit = mix(colorA, colorB, n);
                    emit = mix(emit, colorC, smoothstep(0.62, 1.0, n));
                    col += emit * dens * trans * 0.2;
                    trans *= 1.0 - dens * 0.14;
                    z += 0.18 + (1.0 - n) * 0.07;
                }
                float well = exp(-length((p - vec2(-0.58, 0.04)) * vec2(1.55, 1.2)) * 2.35);
                col = mix(col, colorDeep, well * 0.62);
                float vig = smoothstep(1.85, 0.22, length(p * vec2(0.7, 1.0)));
                col *= 0.82 + vig * 0.22;
                col = min(col, vec3(0.62));
                gl_FragColor = vec4(col, 1.0);
            }
        `
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -20;
    mesh.onBeforeRender = () => { mesh.matrixWorld.identity(); };
    mesh.userData.mat = material;
    return mesh;
}

function createAurora(width, height, color, opacity, z) {
    const geo = new THREE.PlaneGeometry(width, height, 80, 28);
    const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
            time: { value: 0 },
            scroll: { value: 0 },
            color: { value: new THREE.Color(color) },
            opacity: { value: opacity }
        },
        vertexShader: `
            uniform float time;
            uniform float scroll;
            varying vec2 vUv;
            varying float vLift;
            ${NOISE}
            void main() {
                vUv = uv;
                vec3 p = position;
                float n = fbm(vec3(uv * 3.2, time * 0.12 + scroll));
                p.z += (n - 0.5) * 28.0;
                p.y += sin(uv.x * 6.283 + time * 0.4 + scroll * 2.0) * 10.0;
                vLift = n;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }
        `,
        fragmentShader: `
            precision highp float;
            uniform vec3 color;
            uniform float opacity;
            uniform float time;
            varying vec2 vUv;
            varying float vLift;
            void main() {
                float band = pow(sin(vUv.x * 3.14159), 1.4);
                float fall = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.12, vUv.y);
                float shimmer = 0.7 + 0.3 * sin(vUv.x * 18.0 + time * 1.4 + vLift * 6.0);
                float a = band * fall * shimmer * opacity * (0.45 + vLift);
                if (a < 0.012) discard;
                gl_FragColor = vec4(color * (0.85 + vLift * 0.4), a);
            }
        `
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = z;
    mesh.frustumCulled = false;
    mesh.userData.mat = mat;
    return mesh;
}

function createField(count, mode) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 240;
        pos[i * 3 + 1] = (Math.random() - 0.45) * 140;
        pos[i * 3 + 2] = -20 - Math.random() * 180;
        seed[i * 4] = Math.random() * 100;
        seed[i * 4 + 1] = mode === 'river' ? 1.2 + Math.random() * 2.4 : 0.5 + Math.random() * 1.6;
        seed[i * 4 + 2] = Math.random();
        seed[i * 4 + 3] = 0.4 + Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const river = mode === 'river';
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
                float t = time * aSeed.w * ${river ? '0.55' : '0.18'};
                ${river ? `
                    float span = 260.0;
                    p.x = mod(p.x + t * (22.0 + aSeed.y * 18.0) + scroll * 80.0 + span * 0.5, span) - span * 0.5;
                    p.y += sin(p.x * 0.04 + t + aSeed.x) * 7.0;
                    p.z += scroll * 40.0;
                ` : `
                    p.x += sin(t + aSeed.x) * 10.0;
                    p.y += cos(t * 0.7 + aSeed.z * 4.0) * 6.0 + scroll * 24.0;
                    p.z += scroll * 90.0 + sin(t * 0.4) * 5.0;
                `}
                vAlpha = ${river ? '0.34' : '0.2'} + aSeed.z * 0.28 + speed * 0.1;
                vColor = mix(vec3(0.49, 0.61, 1.0), vec3(0.37, 0.92, 0.83), aSeed.z);
                vColor = mix(vColor, vec3(0.66, 0.55, 0.98), step(0.72, aSeed.z));
                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = aSeed.y * pixelRatio * (${river ? '70.0' : '140.0'} / max(1.0, -mv.z))
                    * (1.0 + speed * ${river ? '1.8' : '0.4'});
            }
        `,
        fragmentShader: `
            precision highp float;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                vec2 uv = gl_PointCoord - 0.5;
                float d = length(uv * vec2(${river ? '0.32, 1.5' : '1.0, 1.0'}));
                float a = exp(-d * ${river ? '5.2' : '3.4'}) * vAlpha;
                if (a < 0.01) discard;
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
        void main() {
            vec2 uv = vUv;
            vec2 c = uv - 0.5;
            float d = length(c);
            float ab = (0.0014 + speed * 0.0024) * amount * d;
            float r = texture2D(tDiffuse, uv + c * ab).r;
            float g = texture2D(tDiffuse, uv).g;
            float b = texture2D(tDiffuse, uv - c * ab).b;
            vec3 col = vec3(r, g, b);
            col += (fract(sin(dot(uv * 900.0, vec2(12.9, 78.2)) + time) * 43758.5) - 0.5) * 0.03 * amount;
            col *= mix(0.78, 1.0, smoothstep(0.05, 0.7, d));
            gl_FragColor = vec4(min(col, vec3(0.85)), 1.0);
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
    state.smoothScroll += (flight.smoothProgress - state.smoothScroll) * (state.mobile ? 0.2 : 0.12);
    state.smoothSpeed += (flight.speed - state.smoothSpeed) * 0.12;
    state.dir += ((flight.direction || 0) - state.dir) * 0.08;
    const theatre = sampleTheatre(state.smoothScroll, state.smoothSpeed, state.dir);
    state.smoothMouse.lerp(state.mouse, 0.045);

    const uVol = state.volume?.userData?.mat?.uniforms;
    if (uVol) {
        uVol.time.value = t;
        uVol.scroll.value = theatre.phase;
        uVol.mouse.value.copy(state.smoothMouse);
        uVol.resolution.value.set(state.renderWidth, state.renderHeight);
    }
    [state.auroraA, state.auroraB].forEach((mesh, i) => {
        if (!mesh) return;
        const u = mesh.userData.mat.uniforms;
        u.time.value = t;
        u.scroll.value = theatre.phase;
        mesh.rotation.y = theatre.yaw * (0.25 + i * 0.1);
        mesh.position.y = 6 + i * 8 + Math.sin(t * 0.15 + i) * 4 + theatre.phase * 10;
        mesh.position.x = 28 + i * 16 + Math.sin(theatre.yaw + i) * 10;
    });
    [state.dust, state.rivers].forEach((pts) => {
        if (!pts?.userData?.mat?.uniforms) return;
        const u = pts.userData.mat.uniforms;
        u.time.value = t;
        u.scroll.value = theatre.phase;
        u.speed.value = state.smoothSpeed;
    });

    const par = state.mobile ? 0 : 1;
    state.targetCam.set(
        theatre.cam.x + state.smoothMouse.x * 14 * par,
        theatre.cam.y + state.smoothMouse.y * 8 * par,
        theatre.cam.z
    );
    state.camera.position.lerp(state.targetCam, 0.07);
    state._look.set(
        theatre.focus.x + state.smoothMouse.x * 10 * par,
        theatre.focus.y + 2,
        theatre.focus.z
    );
    state._m4.lookAt(state.camera.position, state._look, state._up);
    state._quatTarget.setFromRotationMatrix(state._m4);
    state.camera.quaternion.slerp(state._quatTarget, 0.08);

    if (state.bloomPass) {
        state.bloomPass.strength = 0.46 + Math.sin(theatre.phase * Math.PI) * 0.06;
    }
    if (state.gradePass) {
        state.gradePass.uniforms.time.value = t;
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
}

export function initThreeBackground() {
    if (state.initialized || typeof window === 'undefined' || !document.body) return;
    state.initialized = true;
    state.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.mobile = detectMobile() || state.reducedMotion;
    if (state.reducedMotion) {
        state.motionScale = 0.3;
        state.quality = 0.28;
        state.renderScale = 0.55;
        state.frameSkip = 3;
        state.usePost = false;
    } else if (state.mobile) {
        state.motionScale = 0.65;
        state.quality = 0.4;
        state.renderScale = 0.62;
        state.frameSkip = 2;
        state.usePost = false;
    }

    document.getElementById('three-bg-canvas')?.remove();
    state.clock = new THREE.Clock();
    state.scene = new THREE.Scene();
    state.scene.fog = new THREE.FogExp2(PALETTE.deep, 0.012);

    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    state.camera = new THREE.PerspectiveCamera(52, w / h, 0.4, 800);
    state.camera.position.set(0, 6, 88);
    state.targetCam.copy(state.camera.position);

    state.renderer = new THREE.WebGLRenderer({
        antialias: !state.mobile,
        alpha: false,
        powerPreference: state.mobile ? 'low-power' : 'high-performance',
        depth: true
    });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, state.mobile ? 1 : 1.6));
    state.renderer.setClearColor(PALETTE.deep, 1);
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    state.renderer.toneMappingExposure = 1.05;
    const canvas = state.renderer.domElement;
    canvas.id = 'three-bg-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
        position: 'fixed', inset: '0', width: '100%', height: '100%',
        zIndex: '0', pointerEvents: 'none', display: 'block'
    });
    document.body.prepend(canvas);

    state.volume = createVolume(state.mobile);
    state.volume.matrixAutoUpdate = false;
    state.scene.add(state.volume);

    state.auroraA = createAurora(300, 120, PALETTE.primary, state.mobile ? 0.2 : 0.32, -80);
    state.auroraB = createAurora(340, 140, PALETTE.cyan, state.mobile ? 0.16 : 0.26, -120);
    state.auroraA.rotation.x = -0.18;
    state.auroraB.rotation.x = 0.12;
    state.scene.add(state.auroraA, state.auroraB);

    const dustN = Math.floor((state.mobile ? 500 : 1800) * state.quality);
    const riverN = Math.floor((state.mobile ? 400 : 1400) * state.quality);
    state.dust = createField(Math.max(180, dustN), 'dust');
    state.rivers = createField(Math.max(160, riverN), 'river');
    state.scene.add(state.dust, state.rivers);

    if (state.usePost) {
        const bw = Math.max(1, Math.floor(w * state.renderScale));
        const bh = Math.max(1, Math.floor(h * state.renderScale));
        state.composer = new EffectComposer(state.renderer);
        state.composer.addPass(new RenderPass(state.scene, state.camera));
        state.bloomPass = new UnrealBloomPass(new THREE.Vector2(bw, bh), 0.48, 0.5, 0.42);
        state.composer.addPass(state.bloomPass);
        state.gradePass = new ShaderPass(GradeShader);
        state.composer.addPass(state.gradePass);
    }

    if (!state.mobile) {
        document.addEventListener('pointermove', (e) => {
            if (e.pointerType && e.pointerType !== 'mouse') return;
            state.mouse.set((e.clientX / w) * 2 - 1, -(e.clientY / h) * 2 + 1);
        }, { passive: true });
    }

    const onResize = () => {
        const nw = Math.max(1, window.innerWidth);
        const nh = Math.max(1, window.innerHeight);
        applySize(nw, nh);
    };
    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('visibilitychange', () => {
        state.pageVisible = document.visibilityState !== 'hidden';
        if (state.pageVisible) state.clock.getDelta();
    });

    document.body.classList.add('has-three-bg');
    applySize(w, h);
    animate();
}
