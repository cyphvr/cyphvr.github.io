export function initCards() {
    const featureCards = document.querySelectorAll('.feature-card');

    const featuresSection = document.querySelector('.features');
    if (featureCards.length && featuresSection) {
        let pointerX = -1000;
        let pointerY = -1000;
        let frameId = null;

        const resetGlow = () => {
            featureCards.forEach((card) => {
                card.style.setProperty('--feature-x', '-150px');
                card.style.setProperty('--feature-y', '-150px');
                card.style.setProperty('--feature-proximity', '0');
            });
        };

        const updateGlow = () => {
            featureCards.forEach((card) => {
                const bounds = card.getBoundingClientRect();
                const localX = pointerX - bounds.left;
                const localY = pointerY - bounds.top;
                const deltaX = Math.max(bounds.left - pointerX, 0, pointerX - bounds.right);
                const deltaY = Math.max(bounds.top - pointerY, 0, pointerY - bounds.bottom);
                const distance = Math.hypot(deltaX, deltaY);
                const maxDistance = 120;
                const proximityRaw = Math.max(0, 1 - distance / maxDistance);
                const proximity = Math.pow(proximityRaw, 1.45);

                card.style.setProperty('--feature-x', `${localX.toFixed(1)}px`);
                card.style.setProperty('--feature-y', `${localY.toFixed(1)}px`);
                card.style.setProperty('--feature-proximity', proximity.toFixed(3));
            });

            frameId = null;
        };

        const queueGlowUpdate = (event) => {
            pointerX = event.clientX;
            pointerY = event.clientY;

            if (frameId !== null) {
                return;
            }

            frameId = requestAnimationFrame(updateGlow);
        };

        featuresSection.addEventListener('pointerenter', queueGlowUpdate);
        featuresSection.addEventListener('pointermove', queueGlowUpdate);
        featuresSection.addEventListener('pointerleave', () => {
            pointerX = -1000;
            pointerY = -1000;

            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
                frameId = null;
            }

            resetGlow();
        });

        resetGlow();
    }

    const commandObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateX(0)';
                }, index * 100);
            }
        });
    }, { threshold: 0.1 });

    const commandCards = document.querySelectorAll('.command-card');
    commandCards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateX(-20px)';
        card.style.transition = 'opacity 0.55s ease, transform 0.55s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.38s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.38s cubic-bezier(0.22, 1, 0.36, 1), background 0.38s cubic-bezier(0.22, 1, 0.36, 1)';

        const updateCardGlowPosition = (event) => {
            const bounds = card.getBoundingClientRect();
            const x = ((event.clientX - bounds.left) / bounds.width) * 100;
            const y = ((event.clientY - bounds.top) / bounds.height) * 100;
            card.style.setProperty('--hover-x', `${Math.max(0, Math.min(100, x))}%`);
            card.style.setProperty('--hover-y', `${Math.max(0, Math.min(100, y))}%`);
        };

        card.addEventListener('pointermove', updateCardGlowPosition);
        card.addEventListener('pointerenter', updateCardGlowPosition);
        card.addEventListener('pointerleave', () => {
            card.style.setProperty('--hover-x', '50%');
            card.style.setProperty('--hover-y', '50%');
        });

        commandObserver.observe(card);
    });

    const markFeatureVisible = (entry, index) => {
        if (!entry.isIntersecting) {
            return;
        }

        setTimeout(() => {
            entry.target.classList.add('is-visible');
        }, index * 120);
    };

    const featureVisibilityObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            markFeatureVisible(entry, index);
            if (entry.isIntersecting) {
                featureVisibilityObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    featureCards.forEach((card) => {
        featureVisibilityObserver.observe(card);
    });
}