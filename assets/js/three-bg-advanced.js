import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';

const PALETTE = {
    deep: 0x040816,
    mid: 0x09142b,
    edge: 0x152651,
    cyan: 0x67dbff,
    blue: 0x7a9dff,
    mint: 0x72ffd6,
    rose: 0xff7fc9,
    gold: 0xffcb74,
    fog: 0xd9f2ff
};

const clock = new THREE.Clock();
const mouse = new THREE.Vector2();
const tempObject = new THREE.Object3D();

let camera = null;
let scene = null;
let renderer = null;
let initialized = false;
let backdrop = null;
let starField = null;
let streamField = null;
let ribbonField = null;
let rootGroup = null;
let crystalField = null;
let orbitGroup = null;
let beamGroup = null;
let crystalData = [];
let beamData = [];

function createBackdropMaterial() {
    return new THREE.ShaderMaterial({
        transparent: false,
        depthWrite: false,
        uniforms: {
            time: { value: 0 },
            resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
            colorDeep: { value: new THREE.Color(PALETTE.deep) },
            colorMid: { value: new THREE.Color(PALETTE.mid) },
            colorEdge: { value: new THREE.Color(PALETTE.edge) },
            colorCyan: { value: new THREE.Color(PALETTE.cyan) },
            colorBlue: { value: new THREE.Color(PALETTE.blue) },
            colorMint: { value: new THREE.Color(PALETTE.mint) },
            colorRose: { value: new THREE.Color(PALETTE.rose) },
            colorGold: { value: new THREE.Color(PALETTE.gold) }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            precision highp float;

            varying vec2 vUv;
            uniform float time;
            uniform vec2 resolution;
            uniform vec3 colorDeep;
            uniform vec3 colorMid;
            uniform vec3 colorEdge;
            uniform vec3 colorCyan;
            uniform vec3 colorBlue;
            uniform vec3 colorMint;
            uniform vec3 colorRose;
            uniform vec3 colorGold;

            float hash(vec2 p) {
                p = fract(p * vec2(123.34, 456.21));
                p += dot(p, p + 34.345);
                return fract(p.x * p.y);
            }

            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                float a = hash(i);
                float b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0));
                float d = hash(i + vec2(1.0, 1.0));
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
            }

            float fbm(vec2 p) {
                float value = 0.0;
                float amplitude = 0.5;
                for (int i = 0; i < 5; i++) {
                    value += amplitude * noise(p);
                    p *= 2.05;
                    amplitude *= 0.5;
                }
                return value;
            }

            float lineGrid(vec2 uv, float scale) {
                vec2 g = abs(fract(uv * scale - 0.5) - 0.5) / fwidth(uv * scale);
                return 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
            }

            void main() {
                vec2 uv = vUv - 0.5;
                uv.x *= resolution.x / resolution.y;
                float t = time * 0.12;

                float radial = length(uv);
                float vignette = smoothstep(0.95, 0.20, radial);
                vec3 col = mix(colorDeep, colorMid, smoothstep(-0.36, 0.58, vUv.y));

                float baseFog = fbm(uv * vec2(1.6, 1.2) + vec2(t * 0.08, -t * 0.04));
                float secondFog = fbm(uv * vec2(3.4, 2.0) - vec2(t * 0.12, t * 0.07));

                vec2 auroraUv = uv;
                auroraUv.y += sin((auroraUv.x * 1.8 + t) * 2.2) * 0.08;
                auroraUv += vec2(0.0, sin(t * 0.8 + uv.x * 2.5) * 0.05);
                float aurora = fbm(auroraUv * 2.2 + vec2(0.0, t * 0.45));
                aurora *= smoothstep(0.55, -0.15, abs(uv.y + 0.12 * sin(t * 0.8)));
                float auroraCore = smoothstep(0.46, 0.12, abs(uv.y + 0.08 * sin(t * 0.7 + uv.x * 0.9)));

                float haloA = exp(-pow(length(uv - vec2(-0.28, 0.22)), 2.0) * 5.0);
                float haloB = exp(-pow(length(uv - vec2(0.30, -0.18)), 2.0) * 7.2);
                float haloC = exp(-pow(length(uv - vec2(0.05, 0.02)), 2.0) * 9.0);

                float gridA = lineGrid(uv + vec2(0.08 * sin(t * 0.4), -t * 0.08), 7.8) * 0.14;
                float gridB = lineGrid(uv * vec2(1.0, 0.62) + vec2(-t * 0.05, t * 0.03), 13.0) * 0.08;
                float scan = sin((vUv.y + time * 0.015) * 180.0) * 0.004;

                vec3 nebula = mix(colorCyan, colorBlue, smoothstep(0.1, 0.8, aurora));
                nebula = mix(nebula, colorMint, baseFog * 0.45 + haloC * 0.2);
                nebula = mix(nebula, colorRose, secondFog * 0.18 + haloA * 0.22);

                col += nebula * (0.30 + aurora * 0.62 + auroraCore * 0.22 + baseFog * 0.08);
                col += colorGold * haloB * 0.04;
                col += colorEdge * (gridA + gridB * 0.22);
                col += vec3(scan);

                float horizon = smoothstep(0.42, -0.04, uv.y + 0.02 * sin(t * 0.7));
                col += colorEdge * horizon * 0.06;

                float stars = 0.0;
                vec2 starUv = uv * vec2(34.0, 20.0) + vec2(t * 0.4, -t * 0.2);
                vec2 starCell = floor(starUv);
                vec2 starFrac = fract(starUv) - 0.5;
                float starSeed = hash(starCell);
                float starMask = smoothstep(0.995, 1.0, starSeed);
                stars = starMask * smoothstep(0.09, 0.0, length(starFrac));
                col += vec3(1.0, 1.0, 1.0) * stars * 0.7;

                col *= vignette;
                col = 1.0 - exp(-col * 1.55);
                gl_FragColor = vec4(col, 1.0);
            }
        `
    });
}

function createBackdrop() {
    const material = createBackdropMaterial();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -20;
    scene.add(mesh);
    return material;
}

function createStarField(count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        const radius = 180 + Math.random() * 760;
        const angle = Math.random() * Math.PI * 2;
        const height = (Math.random() - 0.5) * 360;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = Math.sin(angle * 1.2) * radius * 0.56 + height * 0.08;
        positions[i * 3 + 2] = -220 - Math.random() * 620;
        seeds[i * 3] = radius;
        seeds[i * 3 + 1] = angle;
        seeds[i * 3 + 2] = height;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));

    const material = new THREE.PointsMaterial({
        color: PALETTE.fog,
        size: 1.25,
        transparent: true,
        opacity: 0.56,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    return points;
}

function createStreamField(count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
        const baseX = (Math.random() - 0.5) * 520;
        const baseY = (Math.random() - 0.5) * 280;
        const baseZ = -80 - Math.random() * 640;
        positions[i * 3] = baseX;
        positions[i * 3 + 1] = baseY;
        positions[i * 3 + 2] = baseZ;
        seeds[i * 4] = Math.random() * Math.PI * 2;
        seeds[i * 4 + 1] = 0.8 + Math.random() * 1.4;
        seeds[i * 4 + 2] = 0.3 + Math.random() * 0.8;
        seeds[i * 4 + 3] = Math.random() * 0.9;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

    const material = new THREE.PointsMaterial({
        color: PALETTE.cyan,
        size: 1.0,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    return points;
}

function createRibbonField(count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const data = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
        const lane = i % 6;
        const laneAngle = (lane / 6) * Math.PI * 2;
        const radius = 120 + lane * 34 + Math.random() * 24;
        const y = -150 + (i / count) * 340;
        positions[i * 3] = Math.cos(laneAngle) * radius;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = Math.sin(laneAngle) * radius * 0.22;
        data[i * 4] = laneAngle;
        data[i * 4 + 1] = radius;
        data[i * 4 + 2] = y;
        data[i * 4 + 3] = 0.6 + Math.random() * 1.2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(data, 4));

    const material = new THREE.PointsMaterial({
        color: PALETTE.rose,
        size: 1.55,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    return points;
}

function createCrystalField(count) {
    const geometry = new THREE.IcosahedronGeometry(10, 0);
    const material = new THREE.MeshStandardMaterial({
        color: 0xaed7ff,
        emissive: 0x163a66,
        emissiveIntensity: 1.2,
        metalness: 0.15,
        roughness: 0.26,
        transparent: true,
        opacity: 0.46,
        flatShading: true,
        vertexColors: true,
        depthWrite: false
    });

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    crystalData = new Array(count);
    for (let i = 0; i < count; i++) {
        const orbitRadius = 90 + Math.random() * 320;
        const orbitTilt = Math.random() * Math.PI * 2;
        const orbitPhase = Math.random() * Math.PI * 2;
        const orbitSpeed = 0.05 + Math.random() * 0.16;
        const pulseSpeed = 0.4 + Math.random() * 1.2;
        const baseScale = 0.55 + Math.random() * 1.4;
        const color = new THREE.Color().setHSL(0.54 + Math.random() * 0.18, 0.72, 0.62 + Math.random() * 0.12);

        crystalData[i] = { orbitRadius, orbitTilt, orbitPhase, orbitSpeed, pulseSpeed, baseScale };
        mesh.setColorAt(i, color);
    }

    mesh.instanceColor.needsUpdate = true;
    rootGroup.add(mesh);
    return mesh;
}

function createOrbitGroup() {
    const group = new THREE.Group();

    const ringConfigs = [
        { radius: 110, tube: 1.8, color: PALETTE.cyan, x: 0.42, y: 0.2, z: -0.15, opacity: 0.18 },
        { radius: 170, tube: 2.4, color: PALETTE.rose, x: -0.35, y: 0.5, z: 0.18, opacity: 0.12 },
        { radius: 238, tube: 2.0, color: PALETTE.mint, x: 0.72, y: -0.18, z: 0.08, opacity: 0.10 }
    ];

    ringConfigs.forEach((config, index) => {
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(config.radius, config.tube, 10, 180),
            new THREE.MeshBasicMaterial({
                color: config.color,
                transparent: true,
                opacity: config.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })
        );
        ring.rotation.set(config.x, config.y, config.z);
        ring.userData = { spin: 0.001 + index * 0.0006, pulse: 0.02 + index * 0.008 };
        group.add(ring);
    });

    rootGroup.add(group);
    return group;
}

function createBeamGroup() {
    const group = new THREE.Group();
    beamData = [];

    for (let i = 0; i < 4; i++) {
        const points = [];
        const samples = 18;
        const baseRadius = 70 + i * 36;
        for (let j = 0; j < samples; j++) {
            const progress = j / (samples - 1);
            points.push(new THREE.Vector3(
                Math.cos(progress * Math.PI * 2 + i) * (baseRadius + progress * 40),
                -180 + progress * 360,
                Math.sin(progress * Math.PI * 1.4 + i * 0.5) * (18 + i * 6)
            ));
        }

        const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        const geometry = new THREE.TubeGeometry(curve, 56, 1.8 + i * 0.35, 8, false);
        const material = new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? PALETTE.blue : PALETTE.rose,
            transparent: true,
            opacity: 0.10 + i * 0.02,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const beam = new THREE.Mesh(geometry, material);
        beam.rotation.y = i * 0.65;
        beam.userData = { spin: 0.0009 + i * 0.00035, sway: 0.03 + i * 0.01 };
        beamData.push({ mesh: beam, curve, points, baseRadius, index: i });
        group.add(beam);
    }

    rootGroup.add(group);
    return group;
}

function createLights() {
    const ambient = new THREE.AmbientLight(0xbfd6ff, 0.46);
    scene.add(ambient);

    const topLight = new THREE.DirectionalLight(0xffffff, 1.1);
    topLight.position.set(-0.9, 1.2, 0.6);
    scene.add(topLight);

    const cyanLight = new THREE.PointLight(0x67dbff, 1.5, 1000, 2.0);
    cyanLight.position.set(-220, 80, 240);
    scene.add(cyanLight);

    const roseLight = new THREE.PointLight(0xff7fc9, 1.0, 900, 2.0);
    roseLight.position.set(220, -120, 180);
    scene.add(roseLight);

    const mintLight = new THREE.PointLight(0x72ffd6, 0.8, 700, 2.2);
    mintLight.position.set(0, 200, -80);
    scene.add(mintLight);
}

function updateCrystalField(time, motionScale) {
    if (!crystalField) return;

    for (let i = 0; i < crystalData.length; i++) {
        const data = crystalData[i];
        const orbit = time * data.orbitSpeed + data.orbitPhase;
        const radius = data.orbitRadius + Math.sin(time * data.pulseSpeed + i * 0.3) * 16;
        const x = Math.cos(orbit) * radius * Math.cos(data.orbitTilt);
        const y = Math.sin(orbit * 1.3) * 72 + Math.sin(time * 0.5 + data.orbitPhase) * 26;
        const z = Math.sin(orbit) * radius * Math.sin(data.orbitTilt) - 180;

        tempObject.position.set(x, y, z);
        tempObject.rotation.set(
            time * 0.3 + data.orbitPhase,
            time * 0.45 + data.orbitTilt,
            time * 0.2 + i * 0.05
        );
        const scale = data.baseScale * (1 + Math.sin(time * data.pulseSpeed + i) * 0.18 * motionScale);
        tempObject.scale.setScalar(scale);
        tempObject.updateMatrix();
        crystalField.setMatrixAt(i, tempObject.matrix);
    }

    crystalField.instanceMatrix.needsUpdate = true;
}

function updateOrbitGroup(time, motionScale) {
    if (!orbitGroup) return;

    orbitGroup.rotation.y += 0.0007 * motionScale;
    orbitGroup.rotation.x = Math.sin(time * 0.16) * 0.02;
    orbitGroup.children.forEach((child, index) => {
        child.rotation.z += child.userData.spin * (0.8 + motionScale);
        child.scale.setScalar(1 + Math.sin(time * (0.5 + index * 0.1)) * child.userData.pulse * motionScale);
    });
}

function updateBeamGroup(time, motionScale) {
    if (!beamGroup) return;

    beamGroup.rotation.y = Math.sin(time * 0.12) * 0.18;
    beamGroup.rotation.x = Math.cos(time * 0.14) * 0.08;

    beamData.forEach((item, index) => {
        item.mesh.rotation.z = Math.sin(time * item.mesh.userData.sway + index) * 0.12;
        item.mesh.position.x = Math.sin(time * 0.24 + index) * 8 * motionScale;
        item.mesh.position.y = Math.cos(time * 0.2 + index) * 6 * motionScale;
    });
}

function updateStreamField(points, time, driftScale) {
    if (!points || !points.geometry?.attributes?.position) return;

    const positions = points.geometry.attributes.position.array;
    const seeds = points.geometry.attributes.aSeed?.array;
    if (!seeds) return;

    for (let i = 0; i < positions.length; i += 3) {
        const index = i / 3;
        const angle = seeds[index * 4];
        const radius = seeds[index * 4 + 1];
        const yBase = seeds[index * 4 + 2];
        const speed = seeds[index * 4 + 3];

        const orbit = time * (0.12 + speed * 0.08);
        const wobble = Math.sin(time * 0.8 + angle * 3.0) * (10 + speed * 10);

        positions[i] = Math.cos(angle + orbit) * radius + Math.sin(time * 0.35 + yBase * 0.02) * 12 * driftScale;
        positions[i + 1] = yBase * 0.55 + Math.sin(orbit * 2.2 + angle) * wobble;
        positions[i + 2] = -120 - radius * 0.45 + Math.cos(orbit * 1.3 + yBase * 0.03) * 20;
    }

    points.geometry.attributes.position.needsUpdate = true;
}

function updateRibbonField(points, time) {
    if (!points || !points.geometry?.attributes?.position) return;

    const positions = points.geometry.attributes.position.array;
    const seeds = points.geometry.attributes.aSeed?.array;
    if (!seeds) return;

    for (let i = 0; i < positions.length; i += 3) {
        const index = i / 3;
        const angle = seeds[index * 4];
        const radius = seeds[index * 4 + 1];
        const yBase = seeds[index * 4 + 2];
        const drift = seeds[index * 4 + 3];

        const wave = Math.sin(time * 0.55 + index * 0.08) * 14 * drift;
        positions[i] = Math.cos(angle + time * 0.2) * (radius + wave * 0.2);
        positions[i + 1] = yBase + Math.sin(time * 0.45 + index * 0.12) * 18 * drift;
        positions[i + 2] = Math.sin(angle + time * 0.16) * 36 + Math.cos(time * 0.34 + index * 0.04) * 10;
    }

    points.geometry.attributes.position.needsUpdate = true;
}

function initThreeBackground() {
    if (initialized || typeof window === 'undefined' || !document.body) return;
    initialized = true;

    const oldBg = document.getElementById('three-bg-canvas');
    if (oldBg) oldBg.remove();

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(PALETTE.deep, 0.0012);

    camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 1, 2600);
    camera.position.set(0, 0, 420);

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.45));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.id = 'three-bg-canvas';
    renderer.domElement.style.position = 'fixed';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.width = '100vw';
    renderer.domElement.style.height = '100vh';
    renderer.domElement.style.zIndex = '0';
    renderer.domElement.style.pointerEvents = 'none';
    renderer.domElement.style.mixBlendMode = 'screen';
    renderer.domElement.style.opacity = '0.9';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    document.body.prepend(renderer.domElement);

    rootGroup = new THREE.Group();
    scene.add(rootGroup);

    backdrop = createBackdrop();
    createLights();
    starField = createStarField(420);
    streamField = createStreamField(220);
    ribbonField = createRibbonField(96);
    crystalField = createCrystalField(84);
    orbitGroup = createOrbitGroup();
    beamGroup = createBeamGroup();

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.addEventListener('pointermove', (event) => {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }, { passive: true });

    function animate() {
        requestAnimationFrame(animate);
        const elapsed = clock.getElapsedTime();
        const motionScale = prefersReducedMotion ? 0.22 : 1;

        if (backdrop?.uniforms) {
            backdrop.uniforms.time.value = elapsed;
            backdrop.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
        }

        if (rootGroup) {
            rootGroup.rotation.y += 0.0003 * motionScale;
            rootGroup.rotation.x = Math.sin(elapsed * 0.12) * 0.01;
        }

        const targetX = mouse.x * 44;
        const targetY = mouse.y * 24;
        camera.position.x += (targetX - camera.position.x) * 0.028 * motionScale;
        camera.position.y += (targetY - camera.position.y) * 0.028 * motionScale;
        camera.position.z = 420 + Math.sin(elapsed * 0.26) * 10 * motionScale;
        camera.lookAt(0, 0, -120);

        if (starField) {
            const positions = starField.geometry.attributes.position.array;
            const seeds = starField.geometry.attributes.aSeed.array;
            for (let i = 0; i < positions.length; i += 3) {
                const index = i / 3;
                const radius = seeds[index * 3];
                const angle = seeds[index * 3 + 1];
                const height = seeds[index * 3 + 2];
                const drift = elapsed * (0.06 + (radius / 900) * 0.09) * motionScale;
                positions[i] = Math.cos(angle + drift) * radius;
                positions[i + 1] = Math.sin(angle * 1.1 + drift * 0.6) * radius * 0.56 + height * 0.08;
                positions[i + 2] = -220 - ((radius + elapsed * 18) % 860);
            }
            starField.geometry.attributes.position.needsUpdate = true;
        }

        updateStreamField(streamField, elapsed, motionScale);
        updateRibbonField(ribbonField, elapsed);
        updateCrystalField(elapsed, motionScale);
        updateOrbitGroup(elapsed, motionScale);
        updateBeamGroup(elapsed, motionScale);

        renderer.render(scene, camera);
    }

    animate();
    window.addEventListener('resize', onWindowResize, { passive: true });
}

function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

export { initThreeBackground };