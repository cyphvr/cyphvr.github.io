import * as THREE from '../vendor/three/three.module.js';

let camera, scene, renderer, particleSystems = [], lines = [], mouse = { x: 0, y: 0 };

function randomColor() {
    const palette = [0x8a9bff, 0x3ecfff, 0xff52a0, 0xf4fbff, 0x9c72ff, 0x14b8a6];
    return palette[Math.floor(Math.random() * palette.length)];
}

function createParticleLayer(count, size, speed, color, opacity) {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    for (let i = 0; i < count; i++) {
        positions.push((Math.random() - 0.5) * 400);
        positions.push((Math.random() - 0.5) * 200);
        positions.push((Math.random() - 0.5) * 400);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color,
        size,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const points = new THREE.Points(geometry, material);
    points.userData = { speed };
    scene.add(points);
    return points;
}

function createLinesBetweenParticles(points, maxDist, color, opacity) {
    const positions = points.geometry.attributes.position.array;
    const lineMaterial = new THREE.LineBasicMaterial({ color, opacity, transparent: true });
    const lineGeometry = new THREE.BufferGeometry();
    let linePositions = [];
    for (let i = 0; i < positions.length; i += 3) {
        for (let j = i + 3; j < positions.length; j += 3) {
            const dx = positions[i] - positions[j];
            const dy = positions[i+1] - positions[j+1];
            const dz = positions[i+2] - positions[j+2];
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (dist < maxDist && Math.random() > 0.93) {
                linePositions.push(positions[i], positions[i+1], positions[i+2]);
                linePositions.push(positions[j], positions[j+1], positions[j+2]);
            }
        }
    }
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    const line = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(line);
    return line;
}

function initThreeBackground() {
    // Remove old background if exists
    const oldBg = document.getElementById('three-bg-canvas');
    if (oldBg) oldBg.remove();

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 1000);
    camera.position.z = 120;

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x09102a, 0);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.id = 'three-bg-canvas';
    renderer.domElement.style.position = 'fixed';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.width = '100vw';
    renderer.domElement.style.height = '100vh';
    renderer.domElement.style.zIndex = '0';
    document.body.prepend(renderer.domElement);

    // Multi-layered particles
    particleSystems = [
        createParticleLayer(220, 3.2, 0.0009, 0x8a9bff, 0.7),
        createParticleLayer(120, 2.1, 0.0015, 0x3ecfff, 0.5),
        createParticleLayer(60, 5.2, 0.0005, 0xff52a0, 0.3)
    ];

    // Glowing lines between some particles
    lines = [
        createLinesBetweenParticles(particleSystems[0], 38, 0x8a9bff, 0.18),
        createLinesBetweenParticles(particleSystems[1], 48, 0x3ecfff, 0.12)
    ];

    // Mouse parallax
    document.addEventListener('mousemove', (e) => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    animate();
    window.addEventListener('resize', onWindowResize);
}

function animate() {
    requestAnimationFrame(animate);
    // Parallax camera
    camera.position.x += (mouse.x * 20 - camera.position.x) * 0.04;
    camera.position.y += (mouse.y * 10 - camera.position.y) * 0.04;
    camera.lookAt(scene.position);
    // Animate layers
    particleSystems.forEach((ps, i) => {
        ps.rotation.y += ps.userData.speed;
        ps.rotation.x += ps.userData.speed * 0.3;
    });
    // Animate lines (subtle pulsate)
    lines.forEach((line, i) => {
        line.material.opacity = 0.12 + 0.08 * Math.abs(Math.sin(Date.now() * 0.0007 + i));
    });
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

export { initThreeBackground };