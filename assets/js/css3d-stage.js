import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { getFlightState, refreshScrollMetrics } from './scroll-flight.js?v=20260803v3';
import { onThreeFrame, sampleTheatre } from './three-bg-advanced.js?v=20260803v3';

const FOV = 45;

const stage = {
    initialized: false,
    enabled: false,
    renderer: null,
    scene: null,
    camera: null,
    root: null,
    objects: [],
    spacer: null,
    width: 0,
    height: 0,
    unsub: null,

    softYaw: 0,
    softPitch: 0
};

function prefersReduced() {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

function isCoarse() {
    try {
        return (
            window.matchMedia('(pointer: coarse)').matches ||
            window.matchMedia('(hover: none)').matches
        );
    } catch {
        return false;
    }
}

function cameraDistance(viewH, fov = FOV) {
    const h = Math.max(1, viewH);
    return h / (2 * Math.tan(THREE.MathUtils.degToRad(fov * 0.5)));
}

function makeSpacer(height) {
    let el = document.getElementById('css3d-scroll-spacer');
    if (!el) {
        el = document.createElement('div');
        el.id = 'css3d-scroll-spacer';
        el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);
    }
    el.style.height = `${Math.max(height, window.innerHeight)}px`;
    stage.spacer = el;
    return el;
}

function collectBlocks() {
    const main = document.querySelector('main.site-main');
    const footer = document.querySelector('footer.site-footer');
    if (!main) return { main: null, footer: null, blocks: [] };

    let blocks = Array.from(main.children).filter(
        (el) => el.nodeType === 1 && el.getBoundingClientRect().height > 8
    );
    if (blocks.length === 0) blocks = [main];
    if (footer) blocks.push(footer);
    return { main, footer, blocks };
}

function placeObject(obj, metrics, index, total) {
    const { top, height, width } = metrics;
    const t = total <= 1 ? 0 : index / (total - 1);

    const side = index % 2 === 0 ? -1 : 1;

    obj.position.x = 0;
    obj.position.y = -(top + height * 0.5);
    obj.position.z = -24 - Math.sin(t * Math.PI) * 16;

    obj.rotation.set(0, side * 0.55, 0);
    obj.userData = {
        index,
        side,
        baseZ: obj.position.z,
        top,
        height,
        width,

        flap: 0,
        flapV: 0
    };
}

function targetFlap(top, height, scrollY, viewH) {
    const plateCenter = top + height * 0.5;
    const viewCenter = scrollY + viewH * 0.5;

    const d = (plateCenter - viewCenter) / Math.max(viewH, 1);
    if (d >= 0) {

        return 1 - THREE.MathUtils.smoothstep(0.1, 0.95, d);
    }

    return 1 - THREE.MathUtils.smoothstep(0.45, 1.2, -d) * 0.4;
}

function buildStage() {
    const { main, footer, blocks } = collectBlocks();
    if (!main || !blocks.length) return false;

    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;

    blocks.forEach((el) => {
        el.classList.add('css3d-plate');
    });

    void document.body.offsetHeight;

    const metrics = blocks.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
            el,

            top: rect.top + scrollY,
            height: rect.height,
            width: rect.width,
            left: rect.left
        };
    });

    const navPad = 88;
    const gap = 36;
    let cursor = navPad;
    metrics.forEach((m) => {
        m.top = cursor;
        cursor += m.height + gap;
    });
    const maxBottom = cursor + 48;
    makeSpacer(maxBottom);

    metrics.forEach((m) => {
        m.el.style.width = `${m.width}px`;
        m.el.style.maxWidth = `${m.width}px`;
        m.el.style.boxSizing = 'border-box';
        m.el.dataset.css3dTop = String(m.top);
        m.el.dataset.css3dHeight = String(m.height);
    });

    stage.scene = new THREE.Scene();
    stage.root = new THREE.Group();
    stage.scene.add(stage.root);

    stage.objects = [];
    metrics.forEach((m, i) => {
        const obj = new CSS3DObject(m.el);
        placeObject(obj, m, i, metrics.length);
        stage.root.add(obj);
        stage.objects.push(obj);
    });

    if (main && !main.children.length) {
        main.style.display = 'none';
        main.dataset.css3dMoved = '1';
    }

    if (footer && footer.parentElement === document.body && !document.body.contains(footer)) {

    }

    document.body.classList.add('has-css3d-stage');

    try {
        refreshScrollMetrics();
    } catch {

    }
    return true;
}

function syncCamera(theatre, flight, dt = 0.016) {
    if (!stage.camera || !stage.root) return;

    const w = stage.width || window.innerWidth;
    const h = stage.height || window.innerHeight;
    const scrollY = flight.y ?? window.scrollY ?? 0;
    const v = theatre?.v ?? flight.speed ?? 0;

    const viewCenterY = scrollY + h * 0.5;
    const z = cameraDistance(h, FOV);

    const targetYaw = (theatre?.yaw || 0) * 0.08;
    stage.softYaw += (targetYaw - stage.softYaw) * 0.06;
    const yaw = stage.softYaw;

    stage.camera.fov = FOV;
    stage.camera.aspect = w / Math.max(h, 1);
    stage.camera.near = 1;
    stage.camera.far = Math.max(10000, z * 4);
    stage.camera.position.set(Math.sin(yaw) * z * 0.03, -viewCenterY, z);
    stage.camera.lookAt(0, -viewCenterY, 0);
    stage.camera.updateProjectionMatrix();

    stage.root.position.set(0, 0, 0);
    stage.root.rotation.set(0, 0, 0);
    stage.root.scale.set(1, 1, 1);

    const step = Math.min(0.05, Math.max(0.008, dt));

    stage.objects.forEach((obj) => {
        const ud = obj.userData || {};
        const side = ud.side ?? 1;
        const top = ud.top ?? 0;
        const height = ud.height ?? 200;
        const width = ud.width ?? 600;

        const want = targetFlap(top, height, scrollY, h);
        ud.flap = ud.flap ?? 0;
        ud.flapV = ud.flapV ?? 0;

        const stiffness = 22;
        const damping = 0.78;
        ud.flapV += (want - ud.flap) * stiffness * step;
        ud.flapV *= Math.pow(damping, step * 60);
        ud.flap += ud.flapV * step;
        ud.flap = THREE.MathUtils.clamp(ud.flap, 0, 1.15);

        const f = THREE.MathUtils.clamp(ud.flap, 0, 1);

        const closedAng = side * 1.15;
        const openAng = side * 0.04;
        const ang = THREE.MathUtils.lerp(closedAng, openAng, f);

        const flapKick = ud.flapV * 0.012 * side;

        const halfW = width * 0.5;
        const hinge = (1 - Math.cos(ang)) * halfW * 0.35 * side;

        obj.position.x = hinge + side * (1 - f) * 18;
        obj.position.y = -(top + height * 0.5);
        obj.position.z = (ud.baseZ || 0) - (1 - f) * 40 - v * 2;

        obj.rotation.x = 0;
        obj.rotation.y = ang + flapKick;
        obj.rotation.z = side * (1 - f) * 0.03;
        obj.scale.set(1, 1, 1);
    });
}

let _lastFrameT = 0;

function onFrame(payload) {
    if (!stage.enabled || !stage.renderer || !stage.scene || !stage.camera) return;
    const now = performance.now();
    const dt = _lastFrameT ? Math.min(0.05, (now - _lastFrameT) / 1000) : 0.016;
    _lastFrameT = now;

    const flight = getFlightState();
    const theatre =
        payload?.theatre ||
        sampleTheatre(
            flight.smoothProgress || flight.progress || 0,
            flight.speed || 0,
            flight.direction || 0
        );

    syncCamera(theatre, flight, dt);
    stage.renderer.render(stage.scene, stage.camera);
}

function remeasurePlates() {

    const gap = 36;
    let cursor = 88;
    stage.objects.forEach((obj) => {
        const el = obj.element;
        if (!el) return;
        const height = el.offsetHeight || obj.userData.height || 0;
        const width = Math.min(el.offsetWidth || obj.userData.width || stage.width, stage.width);
        el.style.width = `${width}px`;
        el.style.maxWidth = `${stage.width}px`;
        obj.userData.top = cursor;
        obj.userData.height = height;
        obj.userData.width = width;
        obj.position.y = -(cursor + height * 0.5);
        cursor += height + gap;
    });

    if (stage.spacer) {
        stage.spacer.style.height = `${cursor + 48}px`;
    }
    try {
        refreshScrollMetrics();
    } catch {

    }
}

function onResize() {
    if (!stage.renderer || !stage.camera) return;
    const w = Math.max(1, window.innerWidth || 1);
    const h = Math.max(1, window.innerHeight || 1);
    stage.width = w;
    stage.height = h;

    stage.camera.fov = FOV;
    stage.camera.aspect = w / h;
    stage.camera.updateProjectionMatrix();
    stage.renderer.setSize(w, h);

    remeasurePlates();
}

export function initCSS3DStage() {
    if (stage.initialized || typeof window === 'undefined' || !document.body) {
        return;
    }
    stage.initialized = true;

    const narrow = window.innerWidth < 720;
    if (prefersReduced() || (isCoarse() && narrow)) {
        document.documentElement.classList.add('css3d-stage--fallback');
        return;
    }

    const start = () => {
        if (stage.enabled) return;
        if (!buildStage()) return;

        stage.width = window.innerWidth;
        stage.height = window.innerHeight;

        const z = cameraDistance(stage.height, FOV);
        stage.camera = new THREE.PerspectiveCamera(
            FOV,
            stage.width / Math.max(stage.height, 1),
            1,
            Math.max(10000, z * 4)
        );
        stage.camera.position.set(0, -(stage.height * 0.5), z);
        stage.camera.lookAt(0, -(stage.height * 0.5), 0);

        stage.renderer = new CSS3DRenderer();
        stage.renderer.setSize(stage.width, stage.height);
        const el = stage.renderer.domElement;
        el.id = 'css3d-root';
        el.className = 'css3d-root';
        el.style.position = 'fixed';
        el.style.inset = '0';
        el.style.zIndex = '2';
        el.style.pointerEvents = 'none';
        document.body.appendChild(el);

        stage.enabled = true;

        let lastHook = performance.now();
        const ensureLive = (now) => {
            if (!stage.enabled) return;
            if (now - lastHook > 48) onFrame(null);
            requestAnimationFrame(ensureLive);
        };
        stage.unsub = onThreeFrame((payload) => {
            lastHook = performance.now();
            onFrame(payload);
        });
        requestAnimationFrame(ensureLive);

        window.addEventListener('resize', onResize, { passive: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', onResize, { passive: true });
        }

        onFrame(null);
        onResize();
    };

    requestAnimationFrame(() => {
        requestAnimationFrame(start);
    });
    window.addEventListener(
        'load',
        () => {
            if (!stage.enabled) start();
            else onResize();
        },
        { once: true }
    );
}