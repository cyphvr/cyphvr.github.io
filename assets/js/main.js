import { initNavigation } from './navigation.js?v=20260803v1';
import { initAnimations } from './animations.js?v=20260803v1';
import { initCards } from './cards.js?v=20260803v1';
import { initButtons } from './buttons.js?v=20260803v1';
import { initCommands } from './commands.js?v=20260803v1';
import { initDeckDemo } from './deck-demo.js?v=20260803v1';
import { initScrollFlight, scrollToY } from './scroll-flight.js?v=20260803v1';
import { initThreeBackground } from './three-bg-advanced.js?v=20260803v1';

try {
    initScrollFlight();
} catch (error) {
    console.error('Scroll flight failed to initialize:', error);
}

window.__cyScrollTo = scrollToY;

try {
    initThreeBackground();
} catch (error) {
    console.error('Three.js background failed to initialize:', error);
}

function initPageTransitions() {
    const body = document.body;
    if (!body) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ensureTransitionOverlay = () => {
        let overlay = document.querySelector('.page-transition-overlay');
        if (overlay || prefersReducedMotion) return overlay;

        overlay = document.createElement('div');
        overlay.className = 'page-transition-overlay';
        overlay.innerHTML = `
            <div class="page-transition-overlay__content" aria-hidden="true">
                <img class="page-transition-overlay__logo" src="/images/cypher rebrand logo round (No BG).png" alt="">
                <div class="page-transition-overlay__label">Loading</div>
                <div class="page-transition-overlay__progress" aria-hidden="true"></div>
            </div>
        `;
        body.insertBefore(overlay, body.firstChild);
        overlay.setAttribute('aria-hidden', 'true');
        return overlay;
    };

    const transitionOverlay = ensureTransitionOverlay();
    if (!prefersReducedMotion) {
        body.classList.add('page-transition', 'page-ready');
    }

    let isNavigating = false;

    document.addEventListener('click', (event) => {
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (!link) return;
        if (event.defaultPrevented) return;
        if (event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (link.target && link.target !== '_self') return;
        if (link.hasAttribute('download')) return;

        const rawHref = link.getAttribute('href');
        if (!rawHref) return;
        if (rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) return;

        let destination;
        try {
            destination = new URL(link.href, window.location.href);
        } catch {
            return;
        }

        if (destination.origin !== window.location.origin) return;
        if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) return;
        if (isNavigating) {
            event.preventDefault();
            return;
        }

        isNavigating = true;

        if (prefersReducedMotion) return;

        event.preventDefault();
        body.classList.add('page-leaving');
        if (transitionOverlay) transitionOverlay.setAttribute('aria-hidden', 'false');

        window.setTimeout(() => {
            window.location.assign(destination.href);
        }, 240);
    }, true);

    window.addEventListener('pageshow', () => {
        body.classList.remove('page-leaving');
        if (transitionOverlay) transitionOverlay.setAttribute('aria-hidden', 'true');
        isNavigating = false;
    });
}

function initImageProtect() {
    const isImageTarget = (target) =>
        target instanceof Element && Boolean(target.closest('img'));

    document.addEventListener('contextmenu', (event) => {
        if (isImageTarget(event.target)) event.preventDefault();
    });

    document.addEventListener('dragstart', (event) => {
        if (isImageTarget(event.target)) event.preventDefault();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initPageTransitions();
    initNavigation();
    initAnimations();
    initCards();
    initButtons();
    initCommands();
    initDeckDemo();
    initImageProtect();
});