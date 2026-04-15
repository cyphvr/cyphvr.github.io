function initCapabilityPuzzle() {
    const grid = document.querySelector('.capabilities-grid');
    if (!grid) {
        return;
    }

    const cards = Array.from(grid.querySelectorAll('.capability-card'));
    if (cards.length < 4) {
        return;
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const desktopOnly = window.matchMedia('(min-width: 1101px)');
    let timerId = null;
    let slotOrder = cards.map((_, index) => index + 1);

    const applySlots = () => {
        cards.forEach((card, index) => {
            for (let slot = 1; slot <= cards.length; slot += 1) {
                card.classList.remove(`cap-slot-${slot}`);
            }
            card.classList.add(`cap-slot-${slotOrder[index]}`);
        });
    };

    const animateToNextArrangement = () => {
        const firstRects = new Map();
        cards.forEach((card) => {
            firstRects.set(card, card.getBoundingClientRect());
        });

        const step = Math.random() > 0.66 ? 2 : 1;
        slotOrder = slotOrder.map((_, index, arr) => arr[(index + step) % arr.length]);
        applySlots();

        cards.forEach((card) => {
            const first = firstRects.get(card);
            const last = card.getBoundingClientRect();

            const dx = first.left - last.left;
            const dy = first.top - last.top;
            const sx = first.width / last.width;
            const sy = first.height / last.height;

            card.animate(
                [
                    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, offset: 0 },
                    { transform: `translate(0, 0) scale(1, 1)`, offset: 1 }
                ],
                {
                    duration: 1220,
                    easing: 'cubic-bezier(0.25, 0.92, 0.22, 1)',
                    fill: 'both'
                }
            );
        });
    };

    const stop = () => {
        if (timerId !== null) {
            window.clearInterval(timerId);
            timerId = null;
        }

        cards.forEach((card) => {
            for (let slot = 1; slot <= cards.length; slot += 1) {
                card.classList.remove(`cap-slot-${slot}`);
            }
        });
    };

    const start = () => {
        if (!desktopOnly.matches || reducedMotion.matches) {
            stop();
            return;
        }

        if (timerId !== null) {
            return;
        }

        applySlots();
        timerId = window.setInterval(animateToNextArrangement, 4300);
    };

    start();
    desktopOnly.addEventListener('change', start);
    reducedMotion.addEventListener('change', start);
}

export { initCapabilityPuzzle };
