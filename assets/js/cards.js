export function initCards() {
    // Feature page: highlight TOC item while scrolling chapters
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
