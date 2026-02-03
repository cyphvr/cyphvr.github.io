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

    window.addEventListener('scroll', () => {
        if (!navbar) return;
        if (window.scrollY > 30) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    if (navbar && navbarMenu && navbarToggle) {
        navbarToggle.addEventListener('click', () => {
            const isOpen = navbarMenu.classList.toggle('open');
            navbar.classList.toggle('menu-open', isOpen);
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

    const navLinks = document.querySelectorAll('.navbar-link');
    navLinks.forEach((link, index) => {
        link.style.animation = `navFloat 3s ease-in-out ${index * 0.1}s infinite`;
    });

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