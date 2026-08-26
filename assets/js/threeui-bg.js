import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FluidFieldBackground } from '@designcodeio/threeui/components/FluidFieldBackground';
import { getFlightState } from './scroll-flight.js?v=20260822v17';

export function initThreeBackground() {
    if (typeof window === 'undefined' || !document.body) return;

    try {
        const lite =
            document.documentElement.classList.contains('cy-lite') ||
            window.matchMedia('(max-width: 768px)').matches ||
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (lite) return;
    } catch {
        if ((window.innerWidth || 0) <= 768) return;
    }

    document.getElementById('three-bg-canvas')?.remove();
    document.getElementById('threeui-bg')?.remove();

    const mount = document.createElement('div');
    mount.id = 'threeui-bg';
    mount.className = 'cy-threeui';
    mount.setAttribute('aria-hidden', 'true');
    document.body.prepend(mount);

    const root = createRoot(mount);
    const props = {
        mode: 'dark',
        hue: 6,
        saturation: 1.08,
        brightness: 1.22,
        className: 'cy-fluid'
    };

    const render = () => root.render(createElement(FluidFieldBackground, props));
    render();

    let raf = 0;
    const tick = () => {
        const flight = getFlightState();
        const p = Math.min(1, Math.max(0, flight.smoothProgress || flight.progress || 0));
        const rush = Math.min(1, flight.speed || 0);
        props.hue = 4 + p * 14;
        props.brightness = 1.16 + p * 0.12 + rush * 0.08;
        props.saturation = 1.04 + rush * 0.08;
        const frame = mount.querySelector('iframe, canvas');
        if (frame) {
            frame.style.filter = `hue-rotate(${props.hue}deg) saturate(${props.saturation}) brightness(${props.brightness})`;
        }
        raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    document.body.classList.add('has-three-bg');
}
