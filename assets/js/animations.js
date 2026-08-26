const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const UNITS = [
    ['.page-intro', null],
    ['.about-mast', null],
    ['.about-split > *:first-child', 'left'],
    ['.about-split > *:last-child', 'right'],
    ['.band__head', null],
    ['.feature-row', null],
    ['.marquee', null],
    ['.cmd-app', 'scale'],
    ['.status-orb', 'scale'],
    ['.history-panel', null],
    ['.diag-intro', null],
    ['.diag-panel', null],
    ['.legal-doc', null],
    ['.legal-toc', 'left'],
    ['.footer-invite', null],
    ['.lost > div', null],
    ['.features-nav', 'left'],
];

const GROUPS = [
    { root: '.stat-wall', child: ':scope > article', util: 'lift' },
    { root: '.bullet-grid', child: ':scope > li', util: 'lift' },
    { root: '.values-scroll', child: ':scope > .value-card', util: 'lift glow-border' },
    { root: '.timeline', child: ':scope > article', util: 'nudge' },
    { root: '.status-side', child: ':scope > .status-tile', util: 'lift glow-border' },
    { root: '.footer-grid', child: ':scope > *', util: 'nudge' },
    { root: '.matrix tbody', child: ':scope > tr', util: null },
    { root: '.checklist', child: ':scope > li', util: 'nudge' },
];

function skip(el) {
    return Boolean(
        el.closest('.hero-split') ||
        el.closest('.navbar') ||
        el.closest('.page-transition-overlay') ||
        el.closest('.feature-chapter') ||
        el.matches('.feature-chapter') ||
        el.closest('.legal-layout') ||
        el.matches('.legal-doc') ||
        el.matches('.legal-toc')
    );
}

function markMotionTree() {
    const seen = new Set();

    GROUPS.forEach(({ root, child, util, directional }) => {
        document.querySelectorAll(root).forEach((parent) => {
            if (skip(parent) || seen.has(parent)) return;
            seen.add(parent);
            parent.classList.add('reveal-group');

            const kids = parent.querySelectorAll(child);
            kids.forEach((kid, i) => {
                kid.classList.add('reveal-child');
                kid.style.setProperty('--reveal-delay', `${Math.min(i, 10) * 0.065}s`);
                if (util) util.split(/\s+/).forEach((c) => kid.classList.add(c));
                seen.add(kid);
            });
        });
    });

    UNITS.forEach(([selector, variant]) => {
        document.querySelectorAll(selector).forEach((el, i) => {
            if (skip(el) || seen.has(el)) return;

            if (el.classList.contains('reveal-child') || el.classList.contains('reveal-group')) return;
            seen.add(el);
            el.classList.add('reveal-unit');
            if (variant === 'left') el.classList.add('reveal-unit--left');
            if (variant === 'right') el.classList.add('reveal-unit--right');
            if (variant === 'scale') el.classList.add('reveal-unit--scale');

            if (el.matches('.feature-row, .feature-chapter')) {
                el.style.setProperty('--reveal-delay', `${Math.min(i, 5) * 0.07}s`);
            }

            if (el.matches('.cmd-app, .status-orb, .history-panel, .legal-doc, .diag-panel')) {
                el.classList.add('glow-border', 'pointer-glow');
            }
            if (el.matches('.value-card')) {
                el.classList.add('lift', 'glow-border', 'pointer-glow');
            }
        });
    });

    document.querySelectorAll('.history-bar .history-item').forEach((item, i) => {
        item.style.setProperty('--hi', String(i));
    });

    document.querySelectorAll('.value-card, .status-tile, .bullet-grid li, .stat-wall article').forEach((el) => {
        if (skip(el)) return;
        if (!el.classList.contains('lift') && el.matches('.status-tile, .stat-wall article, .bullet-grid li')) {
            el.classList.add('lift');
        }
        if (el.matches('.status-tile, .value-card')) {
            el.classList.add('glow-border', 'pointer-glow');
        }
    });
}

function initReveals() {
    const targets = [
        ...document.querySelectorAll('.reveal-unit'),
        ...document.querySelectorAll('.reveal-group'),
    ];

    if (!targets.length) return;

    if (reduced() || document.documentElement.classList.contains('cy-lite')) {
        targets.forEach((el) => el.classList.add('is-visible'));
        return;
    }

    const io = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-visible');
                io.unobserve(entry.target);
            });
        },
        { root: null, rootMargin: '20% 0px', threshold: 0 }
    );

    targets.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const view = window.innerHeight || 800;
        const onScreen = rect.bottom > 0 && rect.top < view;
        if (onScreen) {
            el.classList.add('is-visible');
        } else {
            io.observe(el);
        }
    });
}

function initMarquee() {
    const marquees = document.querySelectorAll('.marquee');
    if (!marquees.length) return;

    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const track = entry.target.querySelector('.marquee__track');
                if (!track) return;
                track.style.animationPlayState = entry.isIntersecting ? 'running' : 'paused';
            });
        }, { threshold: 0.01 });
        marquees.forEach((el) => io.observe(el));
    }

    marquees.forEach((el) => {
        const track = el.querySelector('.marquee__track');
        if (!track) return;
        el.addEventListener('mouseenter', () => {
            track.style.animationPlayState = 'paused';
        });
        el.addEventListener('mouseleave', () => {
            track.style.animationPlayState = 'running';
        });
    });
}

function animateCounter(el, endValue, duration = 1100) {
    if (reduced()) {
        el.textContent = endValue;
        return;
    }

    const text = String(endValue);
    const numeric = parseFloat(text.replace(/[^\d.]/g, ''));
    if (Number.isNaN(numeric)) {
        el.textContent = endValue;
        el.classList.add('metric-pop');
        return;
    }

    const suffix = text.replace(/[\d.,\s]/g, '');
    const prefix = text.match(/^[^\d]*/)?.[0] || '';
    const isInt = Number.isInteger(numeric) || !text.includes('.');
    const start = performance.now();

    const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - t) ** 3;
        const current = numeric * eased;
        el.textContent = `${prefix}${isInt ? Math.round(current) : current.toFixed(1)}${suffix}`;
        if (t < 1) requestAnimationFrame(tick);
        else {
            el.textContent = endValue;
            el.classList.add('metric-pop');
        }
    };

    requestAnimationFrame(tick);
}

function initCounters() {
    if (reduced()) return;

    const nodes = document.querySelectorAll('.hero-metrics strong, .stat-wall strong, #serverCount');
    const io = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                if (el.dataset.counted === '1') return;

                if (el.id === 'serverCount') {
                    const val = el.textContent.trim();
                    if (val && val !== '—' && val !== 'Loading...') {
                        el.dataset.counted = '1';
                        animateCounter(el, val, 1000);
                        io.unobserve(el);
                    }
                    return;
                }

                const value = el.textContent.trim();
                if (!value || value === '—') return;
                el.dataset.counted = '1';
                animateCounter(el, value);
                io.unobserve(el);
            });
        },
        { threshold: 0.45 }
    );

    nodes.forEach((el) => io.observe(el));

    const serverCount = document.getElementById('serverCount');
    if (serverCount) {
        const mo = new MutationObserver(() => {
            const val = serverCount.textContent.trim();
            if (val && val !== '—' && val !== 'Loading...' && serverCount.dataset.counted !== '1') {
                serverCount.dataset.counted = '1';
                animateCounter(serverCount, val, 1000);
                mo.disconnect();
            }
        });
        mo.observe(serverCount, { childList: true, characterData: true, subtree: true });
    }
}

function initPointerGlow() {
    if (reduced() || !finePointer()) return;

    document.querySelectorAll('.pointer-glow').forEach((el) => {
        el.addEventListener('pointermove', (e) => {
            const r = el.getBoundingClientRect();
            el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
            el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
        });
    });
}

function initAnchorPulse() {
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
        a.addEventListener('click', () => {
            const id = a.getAttribute('href')?.slice(1);
            if (!id || reduced()) return;
            const target = document.getElementById(id);
            if (!target) return;
            window.setTimeout(() => {
                target.classList.add('metric-pop');
                window.setTimeout(() => target.classList.remove('metric-pop'), 500);
            }, 380);
        });
    });
}

export function initAnimations() {
    markMotionTree();
    initReveals();
    initMarquee();
    initCounters();
    initPointerGlow();
    initAnchorPulse();
}