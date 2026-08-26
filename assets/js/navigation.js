export function initNavigation() {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (!href || href === '#') return;
            const target = document.querySelector(href);
            if (!target) return;
            e.preventDefault();
            const instant = target.classList.contains('feature-chapter');
            const nowY =
                typeof window.__cyScrollY === 'function'
                    ? window.__cyScrollY()
                    : window.scrollY || document.documentElement.scrollTop || 0;
            const top = target.getBoundingClientRect().top + nowY - 88;
            if (typeof window.__cyScrollTo === 'function') {
                window.__cyScrollTo(Math.max(0, top), instant);
                return;
            }
            target.scrollIntoView({
                behavior: instant ? 'auto' : 'smooth',
                block: 'start',
            });
        });
    });

    const navbar = document.querySelector('.navbar');
    const navbarMenu = document.getElementById('navbarMenu');
    const navbarToggle = document.getElementById('navbarToggle');
    const trail = initNavTrail(navbar);
    let ticking = false;
    const SCROLL_ENTER = 52;
    const SCROLL_EXIT = 22;

    const updateNavbarState = () => {
        if (!navbar) return;

        if (window.innerWidth <= 768) {
            navbar.classList.remove('scrolled');
            navbar.classList.remove('is-compact');
            trail && trail.stop();
            ticking = false;
            return;
        }

        const currentScrollY =
            typeof window.__cyScrollY === 'function'
                ? window.__cyScrollY()
                : window.scrollY || document.documentElement.scrollTop || 0;
        const isScrolled = navbar.classList.contains('scrolled');

        if (!isScrolled && currentScrollY > SCROLL_ENTER) {
            navbar.classList.add('scrolled');
            navbar.classList.add('is-compact');
            trail && trail.start();
        } else if (isScrolled && currentScrollY < SCROLL_EXIT) {
            navbar.classList.remove('scrolled');
            navbar.classList.remove('is-compact');
            trail && trail.stop();
        }

        ticking = false;
    };

    window.addEventListener(
        'scroll',
        () => {
            if (!ticking) {
                window.requestAnimationFrame(updateNavbarState);
                ticking = true;
            }
        },
        { passive: true }
    );

    window.addEventListener('resize', updateNavbarState);
    updateNavbarState();

    if (navbar && navbarMenu && navbarToggle) {
        navbarToggle.addEventListener('click', () => {
            const isOpen = navbarMenu.classList.toggle('open');
            navbar.classList.toggle('menu-open', isOpen);
            navbarToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        navbarMenu.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => {
                navbarMenu.classList.remove('open');
                navbar.classList.remove('menu-open');
                navbarToggle.setAttribute('aria-expanded', 'false');
            });
        });
    }

    function setMenuTop() {
        if (!navbar || !navbarMenu) return;
        if (window.innerWidth <= 768) {
            const navbarHeight = navbar.offsetHeight;
            navbarMenu.style.top = `${navbarHeight + 8}px`;
        } else {
            navbarMenu.style.top = '';
        }
    }

    window.addEventListener('resize', setMenuTop);
    setMenuTop();

    const path = window.location.pathname.replace(/\/$/, '') || '/';
    document.querySelectorAll('.navbar-link').forEach((link) => {
        try {
            const url = new URL(link.href, window.location.origin);
            const linkPath = url.pathname.replace(/\/$/, '') || '/';
            if (linkPath === path) link.setAttribute('aria-current', 'page');
        } catch {

        }
    });
}

function initNavTrail(navbar) {
    const container = navbar && navbar.querySelector('.container');
    if (!container) return { start() {}, stop() {} };
    if (window.innerWidth <= 768) return { start() {}, stop() {} };
    if (container.querySelector('.navbar-trail')) return { start() {}, stop() {} };

    const canvas = document.createElement('canvas');
    canvas.className = 'navbar-trail';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d', { alpha: true });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const INSET = 1;
    const DURATION = 3600;
    const COMET = 0.12;
    const SAMPLES = 48;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let active = false;

    const metrics = (w, h) => {
        const r = Math.max(0.5, (h - INSET * 2) / 2);
        const straight = Math.max(0, w - INSET * 2 - 2 * r);
        const cap = Math.PI * r;
        return {
            r,
            straight,
            cap,
            perim: 2 * straight + 2 * cap,
            left: INSET + r,
            right: w - INSET - r,
            top: INSET,
            bot: h - INSET,
            cy: h / 2,
        };
    };

    const pointAt = (dist, m) => {
        const perim = m.perim || 1;
        let s = ((dist % perim) + perim) % perim;
        if (s <= m.straight) return { x: m.left + s, y: m.top };
        s -= m.straight;
        if (s <= m.cap) {
            const a = -Math.PI / 2 + s / m.r;
            return { x: m.right + m.r * Math.cos(a), y: m.cy + m.r * Math.sin(a) };
        }
        s -= m.cap;
        if (s <= m.straight) return { x: m.right - s, y: m.bot };
        s -= m.straight;
        const a = Math.PI / 2 + s / m.r;
        return { x: m.left + m.r * Math.cos(a), y: m.cy + m.r * Math.sin(a) };
    };

    const fit = () => {
        if (!active) return;
        const rect = container.getBoundingClientRect();
        const nextW = rect.width;
        const nextH = rect.height;
        const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
        if (
            Math.abs(nextW - width) < 0.5 &&
            Math.abs(nextH - height) < 0.5 &&
            nextDpr === dpr &&
            canvas.width > 1
        ) {
            return;
        }
        width = nextW;
        height = nextH;
        dpr = nextDpr;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const paint = (now) => {
        if (!active || width < 8 || height < 8) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const m = metrics(width, height);
        const head = reduced ? m.perim * 0.18 : ((now / DURATION) % 1) * m.perim;
        const cometLen = m.perim * COMET;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2;

        let prev = pointAt(head, m);
        for (let i = 1; i <= SAMPLES; i += 1) {
            const u = i / SAMPLES;
            const p = pointAt(head - u * cometLen, m);
            const alpha = Math.pow(1 - u, 1.85);
            ctx.strokeStyle = `rgba(214, 242, 255, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            prev = p;
        }
    };

    const tick = (now) => {
        if (!active || reduced) {
            raf = 0;
            return;
        }
        paint(now);
        raf = requestAnimationFrame(tick);
    };

    const resize = new ResizeObserver(() => {
        if (!active) return;
        fit();
        if (reduced) paint(0);
    });

    const stop = () => {
        if (!active && !raf) return;
        active = false;
        if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
        }
        resize.disconnect();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        canvas.width = 1;
        canvas.height = 1;
        width = 0;
        height = 0;
    };

    const start = () => {
        if (active) return;
        active = true;
        resize.observe(container);
        fit();
        if (reduced) paint(0);
        else if (!raf) raf = requestAnimationFrame(tick);
    };

    return { start, stop };
}