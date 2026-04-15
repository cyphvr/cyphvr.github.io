export function initNavigation() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
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

        if (window.innerWidth <= 768) {
            navbar.classList.remove('scrolled');
            navbar.classList.remove('is-compact');
            navbar.classList.remove('is-hidden');
            ticking = false;
            return;
        }

        const currentScrollY = window.scrollY;

        const isScrolled = navbar.classList.contains('scrolled');

        if (!isScrolled && currentScrollY > SCROLL_ENTER) {
            navbar.classList.add('scrolled');
            navbar.classList.add('is-compact');
        } else if (isScrolled && currentScrollY < SCROLL_EXIT) {
            navbar.classList.remove('scrolled');
            navbar.classList.remove('is-compact');
        }

        navbar.classList.remove('is-hidden');

        ticking = false;
    };

    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(updateNavbarState);
            ticking = true;
        }
    });

    window.addEventListener('resize', updateNavbarState);

    updateNavbarState();

    if (navbar && navbarMenu && navbarToggle) {
        navbarToggle.addEventListener('click', () => {
            const isOpen = navbarMenu.classList.toggle('open');
            navbar.classList.toggle('menu-open', isOpen);
            if (isOpen) {
                navbar.classList.remove('is-hidden');
            }
            navbarToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        navbarMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navbarMenu.classList.remove('open');
                navbar.classList.remove('menu-open');
                navbarToggle.setAttribute('aria-expanded', 'false');
            });
        });
    }

        function setMenuTop() {
            const navbar = document.querySelector('.navbar');
            const navbarMenu = document.getElementById('navbarMenu');
            if (!navbar || !navbarMenu) return;
            if (window.innerWidth <= 768) {
                const navbarHeight = navbar.offsetHeight;
                navbarMenu.style.top = navbarHeight + 'px';
            } else {
                navbarMenu.style.top = '';
            }
        }
        window.addEventListener('resize', setMenuTop);
        window.addEventListener('DOMContentLoaded', setMenuTop);
        setMenuTop();
}