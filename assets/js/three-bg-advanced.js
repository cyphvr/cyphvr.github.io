import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';

let camera;
let scene;
let renderer;
let clockStart = 0;
let mouse = { x: 0, y: 0 };
let animationFrameId = null;
let initialized = false;
let layers = [];
let driftPoints = null;

const PALETTE = {
    baseTop: 0x060814,
    baseBottom: 0x0a1220,
    line: 0x7fb6ff,
    glow: 0x4fd7ff,
    mint: 0x7cf7e3,
    mist: 0xd9ebff,
    rose: 0xff7db8
};

function createBackdropMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            precision mediump float;
            uniform float time;
            uniform vec2 resolution;
            varying vec2 vUv;

            float gridLine(vec2 uv, float scale) {
                uv *= scale;
                vec2 gv = abs(fract(uv - 0.5) - 0.5) / fwidth(uv);
                return 1.0 - smoothstep(0.0, 1.0, min(gv.x, gv.y));
            }

            void main() {
                vec2 uv = vUv - 0.5;
                uv.x *= resolution.x / resolution.y;

                float t = time * 0.08;
                float vignette = smoothstep(0.95, 0.15, length(uv));

                vec3 base = mix(vec3(0.03, 0.04, 0.08), vec3(0.06, 0.08, 0.13), vUv.y);

                float horizon = smoothstep(0.12, 0.0, abs(uv.y + 0.02));
                float diagonal = smoothstep(0.45, 0.0, abs(uv.x * 0.9 + uv.y * 0.6 + sin(t) * 0.08));
                float gridA = gridLine(uv + vec2(0.0, t * 0.05), 10.0) * 0.18;
                float gridB = gridLine(uv * vec2(1.0, 0.72) + vec2(t * 0.04, -t * 0.02), 16.0) * 0.11;

                float scan = sin((vUv.y + time * 0.003) * 120.0) * 0.012;
                float bloom = exp(-pow(length(uv * vec2(1.1, 0.8) - vec2(-0.14, 0.06)), 2.0) * 4.0);
                bloom += exp(-pow(length(uv * vec2(1.0, 0.9) - vec2(0.24, -0.08)), 2.0) * 5.0) * 0.7;

                vec3 lineTint = vec3(0.48, 0.73, 1.0);
                vec3 glowTint = vec3(0.30, 0.85, 0.95);
                vec3 roseTint = vec3(1.0, 0.52, 0.73);

                vec3 col = base;
                col += lineTint * (gridA + gridB * 0.7);
                col += glowTint * bloom * 0.18;
                col += roseTint * diagonal * 0.05;
                col += vec3(scan);
                col += vec3(0.02, 0.03, 0.04) * horizon;

                col *= vignette;
                col = 1.0 - exp(-col * 1.45);
                gl_FragColor = vec4(col, 1.0);
            }
        `,
        depthWrite: false,
        transparent: false
    });
}

function createBackdrop() {
    const material = createBackdropMaterial();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return material;
}

function createDriftField(count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 900;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 500;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 1000;
        speeds[i] = 0.08 + Math.random() * 0.16;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    const material = new THREE.PointsMaterial({
        color: 0xd9ebff,
        size: 1.15,
        transparent: true,
        opacity: 0.48,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    return points;
}

function createWireframePanel(width, height, depth, color, position, rotation) {
    const group = new THREE.Group();

    const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)),
        new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        })
    );

    const glass = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth * 0.95),
        new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.028,
            side: THREE.DoubleSide,
            depthWrite: false
        })
    );

    const innerGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.72, height * 0.72),
        new THREE.MeshBasicMaterial({
            color: 0x7fb6ff,
            transparent: true,
            opacity: 0.035,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        })
    );
    innerGlow.position.z = depth * 0.51;

    group.add(glass, frame, innerGlow);
    group.position.copy(position);
    group.rotation.set(rotation.x, rotation.y, rotation.z);
    group.userData = {
        sway: 0.002 + Math.random() * 0.003,
        drift: 0.35 + Math.random() * 0.35,
        baseY: position.y,
        baseX: position.x
    };
    scene.add(group);
    layers.push(group);
    return group;
}

function createOrbitRing(radius, color, position, scale) {
    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, radius * 0.06, 10, 96),
        new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.18,
            wireframe: false,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        })
    );
    ring.position.copy(position);
    ring.scale.setScalar(scale);
    ring.rotation.x = Math.PI * 0.5;
    ring.userData = { spin: 0.0016 + Math.random() * 0.0016, wobble: 0.001 + Math.random() * 0.0015 };
    scene.add(ring);
    layers.push(ring);
    return ring;
}

function createSignalNode(position, color, size) {
    const node = new THREE.Mesh(
        new THREE.IcosahedronGeometry(size, 1),
        new THREE.MeshBasicMaterial({
            color,
            wireframe: true,
            transparent: true,
            opacity: 0.25,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        })
    );
    node.position.copy(position);
    node.userData = { spinX: 0.004 + Math.random() * 0.003, spinY: 0.003 + Math.random() * 0.003 };
    scene.add(node);
    layers.push(node);
    return node;
}

function initThreeBackground() {
    if (initialized) return;
    initialized = true;

    const oldBg = document.getElementById('three-bg-canvas');
    if (oldBg) oldBg.remove();

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(PALETTE.baseTop, 0.0010);

    camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 1, 2500);
    camera.position.set(0, 0, 360);

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.id = 'three-bg-canvas';
    renderer.domElement.style.position = 'fixed';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.width = '100vw';
    renderer.domElement.style.height = '100vh';
    renderer.domElement.style.zIndex = '0';
    renderer.domElement.style.pointerEvents = 'none';
    renderer.domElement.style.mixBlendMode = 'screen';
    renderer.domElement.style.opacity = '0.82';
    document.body.prepend(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xbfe1ff, 0.65);
    directional.position.set(-1, 1, 0.8);
    scene.add(directional);

    const bgMaterial = createBackdrop();
    driftPoints = createDriftField(120);

    createWireframePanel(280, 170, 8, PALETTE.line, new THREE.Vector3(-220, 36, -140), new THREE.Vector3(0.18, -0.48, -0.05));
    createWireframePanel(210, 120, 8, PALETTE.mist, new THREE.Vector3(130, -90, -190), new THREE.Vector3(-0.1, 0.36, 0.08));
    createWireframePanel(160, 92, 8, PALETTE.glow, new THREE.Vector3(240, 68, -60), new THREE.Vector3(0.14, -0.28, 0.06));

    createOrbitRing(82, PALETTE.line, new THREE.Vector3(-110, -10, -20), 1.0);
    createOrbitRing(54, PALETTE.glow, new THREE.Vector3(190, 70, -10), 1.08);
    createOrbitRing(42, PALETTE.rose, new THREE.Vector3(260, -60, -120), 1.12);

    createSignalNode(new THREE.Vector3(-45, 18, 10), PALETTE.mint, 14);
    createSignalNode(new THREE.Vector3(120, -30, -80), PALETTE.mist, 11);
    createSignalNode(new THREE.Vector3(240, 35, -30), PALETTE.line, 9);

    document.addEventListener('mousemove', (event) => {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }, { passive: true });

    clockStart = performance.now();

    function animate() {
        animationFrameId = requestAnimationFrame(animate);
        const t = (performance.now() - clockStart) * 0.001;

        if (bgMaterial.uniforms) {
            bgMaterial.uniforms.time.value = t;
            bgMaterial.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
        }

        const targetX = mouse.x * 42;
        const targetY = mouse.y * 22;
        camera.position.x += (targetX - camera.position.x) * 0.03;
        camera.position.y += (targetY - camera.position.y) * 0.03;
        camera.lookAt(0, 0, 0);

        if (driftPoints) {
            const positions = driftPoints.geometry.attributes.position.array;
            const speeds = driftPoints.geometry.attributes.aSpeed.array;
            for (let i = 0; i < positions.length; i += 3) {
                positions[i + 2] += speeds[i / 3];
                positions[i] += Math.sin(t * 0.15 + i) * 0.01;
                positions[i + 1] += Math.cos(t * 0.12 + i) * 0.01;
                if (positions[i + 2] > 700) positions[i + 2] = -900;
            }
            driftPoints.geometry.attributes.position.needsUpdate = true;
        }

        layers.forEach((layer, index) => {
            if (layer.userData && layer.geometry && layer.geometry.type === 'BoxGeometry') {
                layer.position.y = layer.userData.baseY + Math.sin(t * layer.userData.drift + index) * 6;
                layer.position.x = layer.userData.baseX + Math.cos(t * layer.userData.drift * 0.8 + index) * 4;
                layer.rotation.z += layer.userData.sway;
                layer.rotation.x += layer.userData.sway * 0.6;
            } else if (layer.geometry && layer.geometry.type === 'TorusGeometry') {
                layer.rotation.z += layer.userData.spin * 1.2;
                layer.rotation.x += layer.userData.wobble * 0.8;
                layer.scale.setScalar(1 + Math.sin(t * 0.6 + index) * 0.02);
            } else if (layer.geometry && layer.geometry.type === 'IcosahedronGeometry') {
                layer.rotation.x += layer.userData.spinX;
                layer.rotation.y += layer.userData.spinY;
                layer.position.y += Math.sin(t * 0.6 + index) * 0.03;
            }
        });

        renderer.render(scene, camera);
    }

    animate();
    window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

export { initThreeBackground };