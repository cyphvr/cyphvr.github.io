function initValuesRail() {
    document.querySelectorAll('.values-rail').forEach((wrap) => {
        const rail = wrap.querySelector('.values-scroll');
        if (!rail) return;
        rail.setAttribute('tabindex', '0');
        rail.setAttribute('role', 'region');
        rail.setAttribute('aria-label', 'Values, scroll sideways');

        const step = () => Math.max(240, Math.floor(rail.clientWidth * 0.78));
        const go = (dir) => {
            rail.scrollBy({ left: dir * step(), behavior: 'smooth' });
        };

        const prev = wrap.querySelector('.values-rail__nav[data-dir="-1"]');
        const next = wrap.querySelector('.values-rail__nav[data-dir="1"]');

        const syncNav = () => {
            const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
            const atStart = rail.scrollLeft <= 4;
            const atEnd = rail.scrollLeft >= max - 4 || max <= 4;
            [prev, next].forEach((btn, i) => {
                if (!btn) return;
                const off = i === 0 ? atStart : atEnd;
                btn.classList.toggle('is-disabled', off);
                btn.disabled = off;
                btn.setAttribute('aria-disabled', off ? 'true' : 'false');
            });
        };

        wrap.querySelectorAll('.values-rail__nav').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                go(Number(btn.dataset.dir) || 1);
            });
        });
        rail.addEventListener('scroll', syncNav, { passive: true });
        window.addEventListener('resize', syncNav, { passive: true });
        syncNav();
        requestAnimationFrame(syncNav);

        rail.addEventListener('wheel', (e) => {
            if (rail.scrollWidth <= rail.clientWidth + 2) return;
            const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (!dx) return;
            e.preventDefault();
            rail.scrollLeft += dx;
        }, { passive: false });

        let drag = null;
        rail.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch') return;
            drag = { id: e.pointerId, x: e.clientX, left: rail.scrollLeft };
            rail.classList.add('is-dragging');
            try { rail.setPointerCapture(e.pointerId); } catch { /* */ }
        });
        rail.addEventListener('pointermove', (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            rail.scrollLeft = drag.left - (e.clientX - drag.x);
        });
        const endDrag = (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            drag = null;
            rail.classList.remove('is-dragging');
            syncNav();
        };
        rail.addEventListener('pointerup', endDrag);
        rail.addEventListener('pointercancel', endDrag);
    });
}

export function initCards() {
    initValuesRail();

    const chapters = document.querySelectorAll('.feature-chapter[id]');
    const navLinks = document.querySelectorAll('.features-nav a[href^="#"]');
    if (!chapters.length || !navLinks.length) return;

    const map = new Map();
    navLinks.forEach((link) => {
        const id = link.getAttribute('href')?.slice(1);
        if (id) map.set(id, link);
    });

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const id = entry.target.id;
                navLinks.forEach((l) => l.classList.remove('is-active'));
                const active = map.get(id);
                if (active) active.classList.add('is-active');
            });
        },
        { rootMargin: '-30% 0px -55% 0px', threshold: 0 }
    );

    chapters.forEach((ch) => observer.observe(ch));
}