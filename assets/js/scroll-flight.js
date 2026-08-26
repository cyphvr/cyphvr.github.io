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
    touchX: null,
    touchY: null,
    touchActive: false,

    lerp: 0.085,
    wheelScale: 0.95,
    touchScale: 1,
    maxWheel: 180,
    touch: false,
    touchLock: null,
    touchStartX: 0,
    touchStartY: 0,
    touchVy: 0,
    touchT: 0,
    writing: false,
    dragged: false,
    ignoreNativeUntil: 0,
    virtual: false,
    shift: null
};

function prefersReduced() {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

function measureMax() {
    if (flight.virtual && flight.shift) {
        const view = document.body?.clientHeight || window.innerHeight || 1;
        const total = Math.max(flight.shift.scrollHeight || 0, flight.shift.offsetHeight || 0, view);
        return Math.max(1, total - view);
    }
    const doc = document.documentElement;
    const view = doc.clientHeight || window.innerHeight || 1;
    const total = Math.max(doc.scrollHeight || 0, document.body?.scrollHeight || 0, view);
    return Math.max(1, total - view);
}

function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
}

function overflowCan(value) {
    return value === 'auto' || value === 'scroll' || value === 'overlay';
}

function isScrollableAncestor(el) {
    let node = el instanceof Element ? el : null;
    while (
        node &&
        node !== document.body &&
        node !== document.documentElement &&
        !node.classList.contains('cy-scroll-shift')
    ) {
        const style = window.getComputedStyle(node);
        const canY =
            overflowCan(style.overflowY) &&
            node.scrollHeight > node.clientHeight + 2;
        const canX =
            overflowCan(style.overflowX) &&
            node.scrollWidth > node.clientWidth + 2;
        if (canY || canX) return node;
        node = node.parentElement;
    }
    return null;
}

function feedScroller(el, dx, dy) {
    const node = isScrollableAncestor(el);
    if (!node) return false;
    const style = window.getComputedStyle(node);
    const canY = overflowCan(style.overflowY) && node.scrollHeight > node.clientHeight + 2;
    const canX = overflowCan(style.overflowX) && node.scrollWidth > node.clientWidth + 2;

    if (canY && Math.abs(dy) >= Math.abs(dx)) {
        const max = node.scrollHeight - node.clientHeight;
        const next = clamp(node.scrollTop + dy, 0, max);
        if (Math.abs(next - node.scrollTop) < 0.4) return false;
        node.scrollTop = next;
        return true;
    }

    if (canX && Math.abs(dx) > Math.abs(dy)) {
        const max = node.scrollWidth - node.clientWidth;
        const next = clamp(node.scrollLeft + dx, 0, max);
        if (Math.abs(next - node.scrollLeft) < 0.4) return false;
        node.scrollLeft = next;
        return true;
    }

    return false;
}

function feedHorizontalScroll(scroller, e) {
    const style = window.getComputedStyle(scroller);
    const canX = overflowCan(style.overflowX) && scroller.scrollWidth > scroller.clientWidth + 2;
    const canY = overflowCan(style.overflowY) && scroller.scrollHeight > scroller.clientHeight + 2;
    if (!canX) return false;

    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (canY ? 0 : e.deltaY);
    if (!dx) return false;

    const max = scroller.scrollWidth - scroller.clientWidth;
    const next = clamp(scroller.scrollLeft + dx, 0, max);
    const moving =
        (dx > 0 && scroller.scrollLeft < max - 0.5) ||
        (dx < 0 && scroller.scrollLeft > 0.5);
    if (!moving) return false;

    e.preventDefault();
    scroller.scrollLeft = next;
    return true;
}

function readNativeY() {
    if (flight.virtual) return flight.current;
    return (
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0
    );
}

function paintVirtual(y) {
    if (!flight.shift) return;
    flight.shift.style.setProperty('--cy-y', `${-y}px`);
}

function writeNativeY(y) {
    const v = clamp(y, 0, flight.max);
    if (flight.virtual) {
        paintVirtual(v);
        return;
    }
    if (Math.abs(readNativeY() - v) < 0.25) return;
    flight.ignoreNativeUntil = performance.now() + 120;
    flight.writing = true;
    try {
        window.scrollTo({ top: v, left: 0, behavior: 'instant' });
    } catch {
        window.scrollTo(0, v);
    }
    if (Math.abs(readNativeY() - v) >= 0.5) {
        document.documentElement.scrollTop = v;
    }
    flight.writing = false;
}

function keepOutsideShift(node) {
    if (!(node instanceof Element)) return false;
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK') return true;
    if (node.id === 'threeui-bg') return true;
    if (node.classList.contains('navbar')) return true;
    if (node.classList.contains('cy-rise')) return true;
    if (node.classList.contains('page-transition-overlay')) return true;
    if (node.classList.contains('cy-scroll-shift')) return true;
    return false;
}

function installShift() {
    if (flight.shift) return flight.shift;
    const existing = document.querySelector('.cy-scroll-shift');
    if (existing) {
        flight.shift = existing;
        return existing;
    }
    const body = document.body;
    if (!body) return null;
    const shift = document.createElement('div');
    shift.className = 'cy-scroll-shift';
    const migrate = [];
    for (const child of [...body.childNodes]) {
        if (keepOutsideShift(child)) continue;
        migrate.push(child);
    }
    for (const node of migrate) shift.appendChild(node);
    body.appendChild(shift);
    flight.shift = shift;
    return shift;
}

function stopRaf() {
    if (flight.raf) {
        cancelAnimationFrame(flight.raf);
        flight.raf = 0;
    }
    flight.lastT = 0;
}

function publish() {
    const root = document.documentElement;
    root.style.setProperty('--cy-scroll', flight.smoothProgress.toFixed(5));
    root.style.setProperty('--cy-scroll-raw', flight.progress.toFixed(5));
    root.style.setProperty('--cy-scroll-v', Math.min(1, Math.abs(flight.velocity) / 2400).toFixed(4));
    root.style.setProperty('--cy-scroll-dir', String(flight.direction));
    root.dataset.cyFlight = '1';
    if (flight.virtual) {
        window.dispatchEvent(new Event('scroll'));
    }
}

function tick(now) {
    flight.raf = 0;
    if (!flight.enabled || flight.reduced) return;

    const t = now || performance.now();
    const dt = flight.lastT ? Math.min(0.05, (t - flight.lastT) / 1000) : 0.016;
    flight.lastT = t;

    if (flight.touchActive) {
        flight.raf = requestAnimationFrame(tick);
        return;
    }

    flight.max = measureMax();
    flight.target = clamp(flight.target, 0, flight.max);

    const prev = flight.current;

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

let nativeRaf = 0;
let nativeLast = 0;

function nativePump(now) {
    nativeRaf = 0;
    if (flight.enabled || flight.reduced) return;

    const t = now || performance.now();
    const dt = nativeLast ? Math.min(0.05, (t - nativeLast) / 1000) : 0.016;
    nativeLast = t;

    let keep = false;
    if (Math.abs(flight.velocity) > 0.5) {
        flight.velocity *= Math.pow(0.88, dt * 60);
        if (Math.abs(flight.velocity) < 0.5) flight.velocity = 0;
        else keep = true;
        flight.smoothProgress += (flight.progress - flight.smoothProgress) * Math.min(1, dt * 10);
        publish();
    } else if (Math.abs(flight.progress - flight.smoothProgress) > 0.0005) {
        flight.smoothProgress += (flight.progress - flight.smoothProgress) * Math.min(1, dt * 10);
        publish();
        keep = Math.abs(flight.progress - flight.smoothProgress) > 0.0005;
    }

    if (keep) nativeRaf = requestAnimationFrame(nativePump);
    else nativeLast = 0;
}

function kickNativePump() {
    if (flight.enabled || flight.reduced) return;
    if (!nativeRaf) {
        nativeLast = 0;
        nativeRaf = requestAnimationFrame(nativePump);
    }
}

function onWheel(e) {
    if (flight.reduced || !flight.enabled) return;
    if (e.ctrlKey) return;
    const nested = isScrollableAncestor(e.target);
    if (nested) {
        if (feedHorizontalScroll(nested, e)) return;
        const style = window.getComputedStyle(nested);
        if (overflowCan(style.overflowY) && nested.scrollHeight > nested.clientHeight + 2) return;
    }

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
    if (e.touches?.length > 1) {
        flight.touchActive = false;
        flight.touchLock = null;
        flight.touchX = null;
        flight.touchY = null;
        return;
    }
    if (!e.touches?.[0]) return;

    stopRaf();
    flight.touchActive = true;
    flight.touchLock = null;
    flight.dragged = false;
    flight.touchStartX = e.touches[0].clientX;
    flight.touchStartY = e.touches[0].clientY;
    flight.touchX = e.touches[0].clientX;
    flight.touchY = e.touches[0].clientY;
    flight.touchVy = 0;
    flight.touchT = performance.now();
    flight.velocity = 0;

    const y = readNativeY();
    if (Math.abs(y - flight.current) > 1) {
        flight.current = clamp(y, 0, flight.max);
    }
    flight.target = flight.current;
}

function onTouchMove(e) {
    if (!flight.touchActive || flight.reduced || !flight.enabled) return;
    if (!e.touches?.[0] || flight.touchY == null || flight.touchX == null) return;
    if (e.touches.length > 1) {
        flight.touchActive = false;
        flight.touchLock = null;
        return;
    }

    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dxTotal = x - flight.touchStartX;
    const dyTotal = y - flight.touchStartY;
    const dx = flight.touchX - x;
    const dy = (flight.touchY - y) * flight.touchScale;

    if (!flight.touchLock) {
        if (Math.hypot(dxTotal, dyTotal) < 8) return;
        flight.touchLock = Math.abs(dxTotal) > Math.abs(dyTotal) * 1.15 ? 'x' : 'y';
    }

    const now = performance.now();
    const dt = Math.max(8, now - (flight.touchT || now));

    if (flight.touchLock === 'x') {
        if (feedScroller(e.target, dx, 0)) {
            if (e.cancelable) e.preventDefault();
            flight.dragged = true;
        }
        flight.touchX = x;
        flight.touchY = y;
        flight.touchT = now;
        return;
    }

    if (e.cancelable) e.preventDefault();

    flight.touchVy = flight.touchVy * 0.55 + (dy / dt * 16.67) * 0.45;
    flight.touchX = x;
    flight.touchY = y;
    flight.touchT = now;

    if (Math.abs(dy) < 0.15) return;

    flight.dragged = true;

    if (feedScroller(e.target, 0, dy)) return;

    flight.max = measureMax();
    const next = clamp(flight.current + dy, 0, flight.max);
    flight.current = next;
    flight.target = next;
    flight.velocity = dy / (dt / 1000);
    flight.direction = dy > 0.2 ? 1 : dy < -0.2 ? -1 : flight.direction;
    flight.progress = clamp(flight.current / Math.max(1, flight.max), 0, 1);
    flight.smoothProgress = flight.progress;
    writeNativeY(flight.current);
    if (now - (flight.lastPub || 0) > 80) {
        flight.lastPub = now;
        publish();
    }
}

function onTouchEnd(e) {
    const wasActive = flight.touchActive;
    const wasDrag = flight.dragged;
    const lock = flight.touchLock;
    const vy = flight.touchVy;
    const canceled = e.type === 'touchcancel';

    flight.touchActive = false;
    flight.touchX = null;
    flight.touchY = null;
    flight.touchLock = null;
    flight.touchVy = 0;

    if (!wasActive || canceled || lock !== 'y' || !wasDrag) return;

    const flick = vy * 12;
    if (Math.abs(flick) < 10) return;

    flight.max = measureMax();
    flight.target = clamp(flight.current + flick, 0, flight.max);
    kick();
}

function onDragClick(e) {
    if (!flight.dragged) return;
    e.preventDefault();
    e.stopPropagation();
    flight.dragged = false;
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
    if (flight.virtual) return;
    if (flight.writing || nativeTweening) return;
    if (flight.touchActive) return;
    if (performance.now() < flight.ignoreNativeUntil) return;

    const y = readNativeY();
    flight.max = measureMax();

    if (flight.enabled) {
        if (flight.raf) return;
        if (Math.abs(y - flight.current) < 2) return;
        flight.current = clamp(y, 0, flight.max);
        flight.target = flight.current;
        flight.progress = clamp(flight.current / flight.max, 0, 1);
        flight.smoothProgress = flight.progress;
        flight.velocity = 0;
        publish();
        return;
    }

    const prev = flight.current;
    flight.current = clamp(y, 0, flight.max);
    flight.target = flight.current;
    flight.progress = clamp(flight.current / flight.max, 0, 1);
    const dy = flight.current - prev;
    flight.velocity = dy * 45;
    if (Math.abs(flight.velocity) < 0.5) flight.velocity = 0;
    flight.direction = flight.velocity > 2 ? 1 : flight.velocity < -2 ? -1 : flight.direction * 0.9;
    if (Math.abs(flight.progress - flight.smoothProgress) < 0.00001) {
        flight.smoothProgress = flight.progress;
    }
    publish();
    kickNativePump();
}

function onResize() {
    const prevMax = flight.max;
    flight.max = measureMax();
    flight.target = clamp(flight.target, 0, flight.max);
    flight.current = clamp(flight.current, 0, flight.max);
    if (flight.virtual) paintVirtual(flight.current);
    if (flight.touchActive || flight.raf) return;
    if (Math.abs(flight.max - prevMax) < 2) return;
    flight.progress = clamp(flight.current / Math.max(1, flight.max), 0, 1);
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

let nativeTween = 0;
let nativeTweening = false;

function cancelNativeTween() {
    if (nativeTween) {
        cancelAnimationFrame(nativeTween);
        nativeTween = 0;
    }
    nativeTweening = false;
}

function nativeSmoothTo(next) {
    cancelNativeTween();
    flight.max = measureMax();
    const start = readNativeY();
    const dist = next - start;
    if (Math.abs(dist) < 2) {
        flight.current = next;
        flight.target = next;
        flight.progress = clamp(next / Math.max(1, flight.max), 0, 1);
        flight.smoothProgress = flight.progress;
        writeNativeY(next);
        publish();
        return;
    }

    const duration = Math.min(460, Math.max(280, Math.abs(dist) * 0.2));
    const t0 = performance.now();
    nativeTweening = true;

    const step = (now) => {
        const u = Math.min(1, (now - t0) / duration);
        const ease = 1 - (1 - u) ** 3;
        const y = start + dist * ease;
        writeNativeY(y);
        flight.current = y;
        flight.target = next;
        flight.progress = clamp(y / Math.max(1, flight.max), 0, 1);
        flight.smoothProgress = flight.progress;
        publish();
        if (u < 1) {
            nativeTween = requestAnimationFrame(step);
            return;
        }
        writeNativeY(next);
        flight.current = next;
        flight.target = next;
        nativeTween = 0;
        nativeTweening = false;
        publish();
    };

    nativeTween = requestAnimationFrame(step);
}

export function scrollToY(y, immediate = false) {
    flight.max = measureMax();
    const next = clamp(typeof y === 'number' ? y : 0, 0, flight.max);
    flight.velocity = 0;

    if (flight.reduced || immediate) {
        cancelNativeTween();
        flight.current = next;
        flight.target = next;
        flight.progress = clamp(next / Math.max(1, flight.max), 0, 1);
        flight.smoothProgress = flight.progress;
        writeNativeY(next);
        publish();
        return;
    }

    if (!flight.enabled) {
        nativeSmoothTo(next);
        return;
    }

    flight.target = next;

    if (Math.abs(flight.target - flight.current) > 600) {
        flight.current += (flight.target - flight.current) * 0.12;
    }
    kick();
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

function useVirtualScroll() {
    try {
        return (
            window.matchMedia('(pointer: coarse)').matches ||
            window.matchMedia('(max-width: 960px)').matches
        );
    } catch {
        return isTouchDevice();
    }
}

export function initScrollFlight() {
    if (flight.initialized || typeof window === 'undefined') return getFlightState;
    flight.initialized = true;
    flight.reduced = prefersReduced();

    flight.touch = isTouchDevice();
    flight.enabled = !flight.reduced;
    flight.lerp = 0.085;
    flight.touchScale = 1;
    flight.virtual = flight.enabled && useVirtualScroll();

    document.documentElement.classList.add('cy-flight');
    if (!flight.enabled) {
        document.documentElement.classList.add('cy-flight--native');
    }

    if (flight.virtual) {
        document.documentElement.classList.add('cy-flight--touch');
        installShift();
        paintVirtual(0);
    }

    window.__cyScrollY = () => flight.current;

    flight.max = measureMax();
    flight.current = flight.virtual ? 0 : clamp(readNativeY(), 0, flight.max);
    flight.target = flight.current;
    flight.progress = clamp(flight.current / flight.max, 0, 1);
    flight.smoothProgress = flight.progress;

    if (flight.enabled) {
        window.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('keydown', onKey, { passive: false });
        window.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
        window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
        window.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
        window.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true });
        document.addEventListener('click', onDragClick, true);
    } else {
        window.addEventListener('touchstart', () => {
            if (!nativeTweening) return;
            cancelNativeTween();
            const y = readNativeY();
            flight.max = measureMax();
            flight.current = y;
            flight.target = y;
            flight.progress = clamp(y / Math.max(1, flight.max), 0, 1);
            flight.smoothProgress = flight.progress;
            publish();
        }, { passive: true });
    }

    window.addEventListener('scroll', onNativeScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    if (document.fonts?.ready) {
        document.fonts.ready.then(() => {
            onResize();
        }).catch(() => {});
    }
    window.addEventListener('load', onResize, { once: true });

    publish();
    return getFlightState;
}