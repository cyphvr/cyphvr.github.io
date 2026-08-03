export function initNavigation() {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (!href || href === '#') return;
            const target = document.querySelector(href);
            if (!target) return;
            e.preventDefault();
            const top =
                target.getBoundingClientRect().top +
                (window.scrollY || document.documentElement.scrollTop || 0) -
                88;
            if (typeof window.__cyScrollTo === 'function') {
                window.__cyScrollTo(Math.max(0, top));
                return;
            }
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
            });
        });
    });

    const navbar = document.querySelector('.navbar');
    const navbarMenu = document.getElementById('navbarMenu');
    const navbarToggle = document.getElementById('navbarToggle');
    let ticking = false;
    const SCROLL_ENTER = 52;
    const SCROLL_EXIT = 22;

    const updateNavbarState = () => {
        if (!navbar) return;

        // Original behavior: pill compact only on desktop
        if (window.innerWidth <= 768) {
            navbar.classList.remove('scrolled');
            navbar.classList.remove('is-compact');
            ticking = false;
            return;
        }

        const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
        const isScrolled = navbar.classList.contains('scrolled');

        if (!isScrolled && currentScrollY > SCROLL_ENTER) {
            navbar.classList.add('scrolled');
            navbar.classList.add('is-compact');
        } else if (isScrolled && currentScrollY < SCROLL_EXIT) {
            navbar.classList.remove('scrolled');
            navbar.classList.remove('is-compact');
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

    // Mark current page
    const path = window.location.pathname.replace(/\/$/, '') || '/';
    document.querySelectorAll('.navbar-link').forEach((link) => {
        try {
            const url = new URL(link.href, window.location.origin);
            const linkPath = url.pathname.replace(/\/$/, '') || '/';
            if (linkPath === path) link.setAttribute('aria-current', 'page');
        } catch {
            /* ignore */
        }
    });
}