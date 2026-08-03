function getScrollY() {

    const doc = document.documentElement;
    const body = document.body;
    return (
        window.scrollY ||
        window.pageYOffset ||
        doc?.scrollTop ||
        body?.scrollTop ||
        0
    );
}

export function initButtons() {
    const riseBtn = document.getElementById('cyRise') || document.getElementById('backToTop');

    if (riseBtn) {

        riseBtn.classList.add('cy-rise');
        riseBtn.setAttribute('type', riseBtn.getAttribute('type') || 'button');
        riseBtn.setAttribute('aria-label', riseBtn.getAttribute('aria-label') || 'Back to top');

        if (!riseBtn.querySelector('svg')) {
            riseBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                    <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span class="cy-rise__label">Back to top</span>
            `;
        } else if (!riseBtn.querySelector('.cy-rise__label')) {
            const label = document.createElement('span');
            label.className = 'cy-rise__label';
            label.textContent = 'Back to top';
            riseBtn.appendChild(label);
        }

        const SHOW_AT = 320;
        const HIDE_AT = 200;
        let visible = false;
        let ticking = false;

        const sync = () => {
            const y = getScrollY();
            if (!visible && y > SHOW_AT) visible = true;
            else if (visible && y < HIDE_AT) visible = false;

            riseBtn.classList.toggle('is-on', visible);
            riseBtn.classList.toggle('show', visible);
            riseBtn.setAttribute('aria-hidden', visible ? 'false' : 'true');
            ticking = false;
        };

        const onScroll = () => {
            if (ticking) return;
            ticking = true;
            window.requestAnimationFrame(sync);
        };

        window.addEventListener('scroll', onScroll, { passive: true });
        document.addEventListener('scroll', onScroll, { passive: true, capture: true });
        window.addEventListener('resize', onScroll, { passive: true });

        window.addEventListener('load', sync, { once: true });
        sync();

        riseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof window.__cyScrollTo === 'function') {
                window.__cyScrollTo(0);
                return;
            }
            try {
                window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
            } catch {
                window.scrollTo(0, 0);
            }
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
        });
    }

    document.querySelectorAll('.btn').forEach((button) => {
        button.addEventListener('click', function (e) {
            const ripple = document.createElement('span');
            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;

            ripple.style.cssText = `
                width:${size}px;height:${size}px;left:${x}px;top:${y}px;
                position:absolute;border-radius:50%;
                background:rgba(255,255,255,0.35);
                transform:scale(0);pointer-events:none;
                animation:ripple-animation 0.55s ease-out forwards;
            `;
            ripple.classList.add('ripple');
            this.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);
        });
    });

    if (!document.getElementById('ripple-style')) {
        const style = document.createElement('style');
        style.id = 'ripple-style';
        style.textContent = `
            @keyframes ripple-animation {
                to { transform: scale(4); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
}