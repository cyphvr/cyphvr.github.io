export function initCards() {
    const supportsHoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const featureCards = document.querySelectorAll('.feature-card');

    const featuresSection = document.querySelector('.features');
    if (featureCards.length && featuresSection) {
        const resetFeatureGlow = (card) => {
            card.style.setProperty('--pointer-x', '-10');
            card.style.setProperty('--pointer-y', '-10');
        };

        const resetFeatureTilt = (card) => {
            card.style.setProperty('--feature-rotate-x', '0deg');
            card.style.setProperty('--feature-rotate-y', '0deg');
        };

        const resetFeatureCard = (card) => {
            resetFeatureGlow(card);
            resetFeatureTilt(card);
        };

        let glowFrameId = null;
        let latestGlowEvent = null;

        const updateFeatureGlow = () => {
            if (!latestGlowEvent) {
                glowFrameId = null;
                return;
            }

            featureCards.forEach((card) => {
                const rect = card.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const relativeX = (latestGlowEvent.clientX - centerX) / (rect.width / 2);
                const relativeY = (latestGlowEvent.clientY - centerY) / (rect.height / 2);

                card.style.setProperty('--pointer-x', relativeX.toFixed(3));
                card.style.setProperty('--pointer-y', relativeY.toFixed(3));
            });

            glowFrameId = null;
        };

        const queueFeatureGlowUpdate = (event) => {
            latestGlowEvent = event;
            if (glowFrameId !== null) {
                return;
            }

            glowFrameId = requestAnimationFrame(updateFeatureGlow);
        };

        featureCards.forEach((card) => {
            resetFeatureCard(card);

            if (!supportsHoverPointer) {
                return;
            }

            let rafId = null;
            let latestEvent = null;

            const updateFeatureCard = () => {
                if (!latestEvent) {
                    rafId = null;
                    return;
                }

                const rect = card.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const relativeX = (latestEvent.clientX - centerX) / (rect.width / 2);
                const relativeY = (latestEvent.clientY - centerY) / (rect.height / 2);
                const clampedX = Math.max(-1, Math.min(1, relativeX));
                const clampedY = Math.max(-1, Math.min(1, relativeY));

                card.style.setProperty('--pointer-x', clampedX.toFixed(3));
                card.style.setProperty('--pointer-y', clampedY.toFixed(3));
                card.style.setProperty('--feature-rotate-x', `${(clampedY * -5.5).toFixed(2)}deg`);
                card.style.setProperty('--feature-rotate-y', `${(clampedX * 6.5).toFixed(2)}deg`);

                rafId = null;
            };

            const queueFeatureUpdate = (event) => {
                latestEvent = event;
                if (rafId !== null) {
                    return;
                }

                rafId = requestAnimationFrame(updateFeatureCard);
            };

            card.addEventListener('pointerenter', queueFeatureUpdate);
            card.addEventListener('pointermove', queueFeatureUpdate);
            card.addEventListener('pointerleave', () => {
                if (rafId !== null) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }

                latestEvent = null;
                resetFeatureTilt(card);
            });
        });

        if (supportsHoverPointer) {
            document.addEventListener('pointermove', queueFeatureGlowUpdate);
        }
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
    commandCards.forEach((card) => {
        card.style.opacity = '0';
        card.style.transform = 'translateX(-20px)';
        card.style.transition = 'opacity 0.55s ease, transform 0.55s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.38s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.38s cubic-bezier(0.22, 1, 0.36, 1), background 0.38s cubic-bezier(0.22, 1, 0.36, 1)';

        let rafId = null;
        let latestEvent = null;

        const updateCardGlowPosition = (event) => {
            latestEvent = event;
            if (rafId !== null) {
                return;
            }

            rafId = requestAnimationFrame(() => {
                if (!latestEvent) {
                    rafId = null;
                    return;
                }

                const bounds = card.getBoundingClientRect();
                const x = ((latestEvent.clientX - bounds.left) / bounds.width) * 100;
                const y = ((latestEvent.clientY - bounds.top) / bounds.height) * 100;
                card.style.setProperty('--hover-x', `${Math.max(0, Math.min(100, x))}%`);
                card.style.setProperty('--hover-y', `${Math.max(0, Math.min(100, y))}%`);

                rafId = null;
            });
        };

        if (supportsHoverPointer) {
            card.addEventListener('pointermove', updateCardGlowPosition);
            card.addEventListener('pointerenter', updateCardGlowPosition);
            card.addEventListener('pointerleave', () => {
                if (rafId !== null) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
                latestEvent = null;
                card.style.setProperty('--hover-x', '50%');
                card.style.setProperty('--hover-y', '50%');
            });
        } else {
            card.style.setProperty('--hover-x', '50%');
            card.style.setProperty('--hover-y', '50%');
        }

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