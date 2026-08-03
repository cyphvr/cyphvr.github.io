/**
 * Smooth scroll-flight engine
 * Inertia scroll (Lenis-style) for the page; Three.js reads progress/velocity.
 * No CSS3D stage — normal document layout + hidden scrollbar.
 */

const flight = {
    initialized: false,
    reduced: false,
    enabled: true,
    current: 0,
    target: 0,
    velocity: 0,
    max: 1,
    progress: 0,
    smoothProgress: 0,
    direction: 0,
    raf: 0,
    lastT: 0,
    touchY: null,
    touchActive: false,
    listeners: new Set(),
    // Soft, full-range smooth scroll (not the old hard caps)
    lerp: 0.085,
    wheelScale: 0.95,
    touchScale: 1.05,
    maxWheel: 180
};

function prefersReduced() {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

function measureMax() {
    const doc = document.documentElement;
    const view = window.innerHeight || doc.clientHeight || 1;
    const total = Math.max(doc.scrollHeight || 0, document.body?.scrollHeight || 0, view);
    return Math.max(1, total - view);
}

function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
}

function isScrollableAncestor(el) {
    let node = el instanceof Element ? el : null;
    while (node && node !== document.body && node !== document.documentElement) {
        const style = window.getComputedStyle(node);
        const oy = style.overflowY;
        const canY =
            (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
            node.scrollHeight > node.clientHeight + 2;
        if (canY) return node;
        node = node.parentElement;
    }
    return null;
}

function readNativeY() {
    return (
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0
    );
}

function writeNativeY(y) {
    const v = clamp(y, 0, flight.max);
    document.documentElement.scrollTop = v;
    document.body.scrollTop = v;
    if (Math.abs(readNativeY() - v) > 1) {
        window.scrollTo(0, v);
    }
}

function publish() {
    const root = document.documentElement;
    root.style.setProperty('--cy-scroll', flight.smoothProgress.toFixed(5));
    root.style.setProperty('--cy-scroll-raw', flight.progress.toFixed(5));
    root.style.setProperty('--cy-scroll-v', Math.min(1, Math.abs(flight.velocity) / 2400).toFixed(4));
    root.style.setProperty('--cy-scroll-dir', String(flight.direction));
    root.dataset.cyFlight = '1';

    const snap = getFlightState();
    flight.listeners.forEach((fn) => {
        try {
            fn(snap);
        } catch {
            /* ignore */
        }
    });
}

function tick(now) {
    flight.raf = 0;
    if (!flight.enabled || flight.reduced) return;

    const t = now || performance.now();
    const dt = flight.lastT ? Math.min(0.05, (t - flight.lastT) / 1000) : 0.016;
    flight.lastT = t;

    flight.max = measureMax();
    flight.target = clamp(flight.target, 0, flight.max);

    const prev = flight.current;
    // Smooth exponential follow
    const k = 1 - Math.pow(1 - flight.lerp, dt * 60);
    flight.current += (flight.target - flight.current) * k;

    if (Math.abs(flight.target - flight.current) < 0.2) {
        flight.current = flight.target;
    }

    const dy = flight.current - prev;
    const inst = dt > 0 ? dy / dt : 0;
    flight.velocity += (inst - flight.velocity) * Math.min(1, dt * 14);
    if (Math.abs(flight.velocity) < 0.5) flight.velocity = 0;
    flight.direction = flight.velocity > 2 ? 1 : flight.velocity < -2 ? -1 : flight.direction * 0.92;

    writeNativeY(flight.current);

    flight.progress = clamp(flight.current / flight.max, 0, 1);
    const sk = 1 - Math.pow(1 - 0.12, dt * 60);
    flight.smoothProgress += (flight.progress - flight.smoothProgress) * sk;

    publish();

    const stillMoving =
        Math.abs(flight.target - flight.current) > 0.25 ||
        Math.abs(flight.velocity) > 4 ||
        Math.abs(flight.progress - flight.smoothProgress) > 0.0004;

    if (stillMoving) {
        flight.raf = requestAnimationFrame(tick);
    } else {
        flight.velocity = 0;
        flight.current = flight.target;
        flight.smoothProgress = flight.progress;
        writeNativeY(flight.current);
        publish();
        flight.lastT = 0;
    }
}

function kick() {
    if (flight.reduced || !flight.enabled) return;
    if (!flight.raf) {
        flight.lastT = 0;
        flight.raf = requestAnimationFrame(tick);
    }
}

function onWheel(e) {
    if (flight.reduced || !flight.enabled) return;
    if (e.ctrlKey) return;
    if (isScrollableAncestor(e.target)) return;

    e.preventDefault();

    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;
    if (e.deltaMode === 2) delta *= window.innerHeight;

    const mag = Math.abs(delta);
    const boosted =
        Math.sign(delta) *
        Math.min(flight.maxWheel, mag * flight.wheelScale * (mag < 10 ? 1.2 : 1));

    flight.max = measureMax();
    flight.target = clamp(flight.target + boosted, 0, flight.max);
    kick();
}

function onTouchStart(e) {
    if (flight.reduced || !flight.enabled) return;
    if (isScrollableAncestor(e.target)) {
        flight.touchActive = false;
        flight.touchY = null;
        return;
    }
    if (!e.touches?.[0]) return;
    flight.touchActive = true;
    flight.touchY = e.touches[0].clientY;
}

function onTouchMove(e) {
    if (!flight.touchActive || flight.reduced || !flight.enabled) return;
    if (!e.touches?.[0] || flight.touchY == null) return;
    if (isScrollableAncestor(e.target)) return;

    const y = e.touches[0].clientY;
    const dy = (flight.touchY - y) * flight.touchScale;
    flight.touchY = y;
    if (Math.abs(dy) < 0.2) return;

    e.preventDefault();
    flight.max = measureMax();
    flight.target = clamp(flight.target + dy, 0, flight.max);
    kick();
}

function onTouchEnd() {
    flight.touchActive = false;
    flight.touchY = null;
}

function onKey(e) {
    if (flight.reduced || !flight.enabled) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.target?.isContentEditable) return;

    const view = window.innerHeight || 800;
    let delta = 0;
    switch (e.key) {
        case 'ArrowDown':
            delta = 80;
            break;
        case 'ArrowUp':
            delta = -80;
            break;
        case 'PageDown':
            delta = view * 0.88;
            break;
        case 'PageUp':
            delta = -view * 0.88;
            break;
        case ' ':
            delta = e.shiftKey ? -view * 0.88 : view * 0.88;
            break;
        case 'Home':
            e.preventDefault();
            scrollToY(0);
            return;
        case 'End':
            e.preventDefault();
            scrollToY(measureMax());
            return;
        default:
            return;
    }
    e.preventDefault();
    flight.max = measureMax();
    flight.target = clamp(flight.target + delta, 0, flight.max);
    kick();
}

function onNativeScroll() {
    // When virtual flight is animating, ignore native echoes
    if (flight.enabled && flight.raf) return;
    if (flight.touchActive) return;

    const y = readNativeY();
    flight.max = measureMax();
    const prev = flight.current;
    flight.current = clamp(y, 0, flight.max);
    flight.target = flight.current;
    flight.progress = clamp(flight.current / flight.max, 0, 1);

    // Estimate velocity from native deltas (mobile path)
    if (!flight.enabled) {
        const dy = flight.current - prev;
        flight.velocity = dy * 45; // rough px/s feel for Three.js
        if (Math.abs(flight.velocity) < 0.5) flight.velocity = 0;
        flight.direction = flight.velocity > 2 ? 1 : flight.velocity < -2 ? -1 : flight.direction * 0.9;
        // Don't snap smoothProgress — pump eases it
        if (Math.abs(flight.progress - flight.smoothProgress) < 0.00001) {
            flight.smoothProgress = flight.progress;
        }
    } else {
        flight.smoothProgress = flight.progress;
        flight.velocity = 0;
    }
    publish();
}

function onResize() {
    flight.max = measureMax();
    flight.target = clamp(flight.target, 0, flight.max);
    flight.current = clamp(flight.current, 0, flight.max);
    flight.progress = clamp(flight.current / flight.max, 0, 1);
    publish();
    if (flight.enabled && !flight.reduced) kick();
}

export function refreshScrollMetrics() {
    flight.max = measureMax();
    flight.target = clamp(flight.target, 0, flight.max);
    flight.current = clamp(flight.current, 0, flight.max);
    flight.progress = clamp(flight.current / flight.max, 0, 1);
    flight.smoothProgress = flight.progress;
    writeNativeY(flight.current);
    publish();
}

export function getFlightState() {
    return {
        y: flight.current,
        target: flight.target,
        max: flight.max,
        progress: flight.progress,
        smoothProgress: flight.smoothProgress,
        velocity: flight.velocity,
        speed: Math.min(1, Math.abs(flight.velocity) / 2400),
        direction: flight.direction,
        reduced: flight.reduced,
        enabled: flight.enabled
    };
}

export function onFlightFrame(fn) {
    if (typeof fn === 'function') flight.listeners.add(fn);
    return () => flight.listeners.delete(fn);
}

export function scrollToY(y, immediate = false) {
    flight.max = measureMax();
    const next = clamp(typeof y === 'number' ? y : 0, 0, flight.max);
    flight.velocity = 0;

    if (flight.reduced || immediate || !flight.enabled) {
        flight.current = next;
        flight.target = next;
        flight.progress = clamp(next / flight.max, 0, 1);
        flight.smoothProgress = flight.progress;
        writeNativeY(next);
        publish();
        return;
    }

    flight.target = next;
    // Long jumps (Top button): ease in without fighting reverse inertia
    if (Math.abs(flight.target - flight.current) > 600) {
        flight.current += (flight.target - flight.current) * 0.12;
    }
    kick();
}

export function scrollByY(dy, immediate = false) {
    scrollToY(flight.target + dy, immediate);
}

function isTouchDevice() {
    try {
        return (
            window.matchMedia('(pointer: coarse)').matches ||
            window.matchMedia('(hover: none)').matches ||
            (navigator.maxTouchPoints > 0 && 'ontouchstart' in window) ||
            Math.min(window.innerWidth || 9999, window.innerHeight || 9999) < 820
        );
    } catch {
        return navigator.maxTouchPoints > 0;
    }
}

export function initScrollFlight() {
    if (flight.initialized || typeof window === 'undefined') return getFlightState;
    flight.initialized = true;
    flight.reduced = prefersReduced();
    // Mobile: native scroll only — virtual wheel/touch hijack is a major lag source
    const touch = isTouchDevice();
    flight.enabled = !flight.reduced && !touch;

    flight.max = measureMax();
    flight.current = clamp(readNativeY(), 0, flight.max);
    flight.target = flight.current;
    flight.progress = clamp(flight.current / flight.max, 0, 1);
    flight.smoothProgress = flight.progress;

    document.documentElement.classList.add('cy-flight');
    if (!flight.enabled) {
        document.documentElement.classList.add('cy-flight--native');
    }

    if (flight.enabled) {
        // Desktop smooth inertia
        window.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('keydown', onKey, { passive: false });
    }

    // Always track native scroll (mobile primary path; desktop external/sync)
    window.addEventListener('scroll', onNativeScroll, { passive: true });
    document.addEventListener('scroll', onNativeScroll, { passive: true, capture: true });
    window.addEventListener('resize', onResize, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onResize, { passive: true });
    }

    if (document.fonts?.ready) {
        document.fonts.ready.then(() => {
            onResize();
        }).catch(() => {});
    }
    window.addEventListener('load', onResize, { once: true });

    // Mobile: smooth CSS scroll is fine; keep progress fresh while finger-scrolling
    if (!flight.enabled) {
        let last = performance.now();
        const pump = (now) => {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            // Decay velocity for Three.js when using native scroll
            if (Math.abs(flight.velocity) > 0.5) {
                flight.velocity *= Math.pow(0.88, dt * 60);
                if (Math.abs(flight.velocity) < 0.5) flight.velocity = 0;
                // smooth progress eases toward native
                flight.smoothProgress += (flight.progress - flight.smoothProgress) * Math.min(1, dt * 10);
                publish();
            } else if (Math.abs(flight.progress - flight.smoothProgress) > 0.0005) {
                flight.smoothProgress += (flight.progress - flight.smoothProgress) * Math.min(1, dt * 10);
                publish();
            }
            requestAnimationFrame(pump);
        };
        requestAnimationFrame(pump);
    }

    publish();
    return getFlightState;
}