// Animation effects
export function initAnimations() {
    // Glitch effect enhancement - smooth animation
    const glitchElement = document.querySelector('.glitch');
    if (glitchElement) {
        let glitchTimeout;
        const animateGlitch = () => {
            if (Math.random() > 0.95) {
                glitchElement.style.textShadow = '2px 2px var(--primary-color), -2px -2px var(--secondary-color)';
                glitchTimeout = setTimeout(() => {
                    glitchElement.style.textShadow = 'none';
                    glitchTimeout = setTimeout(animateGlitch, 100);
                }, 50);
            } else {
                glitchTimeout = setTimeout(animateGlitch, 100);
            }
        };
        animateGlitch();
    }

    // Add typing effect to hero subtitle (optional)
    const subtitle = document.querySelector('.hero-subtitle');
    if (subtitle) {
        const text = subtitle.textContent;
        subtitle.textContent = '';
        let i = 0;
        
        const typeWriter = () => {
            if (i < text.length) {
                subtitle.textContent += text.charAt(i);
                i++;
                setTimeout(typeWriter, 100);
            }
        };
        
        setTimeout(typeWriter, 1000);
    }

    // Rolling binary effect for footer section titles (scramble → settle effect)
    const binaryTargets = document.querySelectorAll('.binary-roll');
    binaryTargets.forEach((el) => {
        const original = el.textContent.trim();
        const chars = original.split('');
        const spans = [];

        el.textContent = '';

        chars.forEach((ch) => {
            const span = document.createElement('span');
            span.className = 'binary-char';

            if (ch === ' ') {
                span.classList.add('is-space');
                span.textContent = '\u00A0';
            } else {
                span.dataset.final = ch;
                span.textContent = Math.random() > 0.5 ? '0' : '1';
            }

            spans.push(span);
            el.appendChild(span);
        });

        const roll = () => {
            spans.forEach((span, idx) => {
                if (span.classList.contains('is-space')) return;

                span.classList.remove('locked');
                let cycles = 10 + Math.floor(Math.random() * 6);

                const shuffle = () => {
                    if (cycles > 0) {
                        span.textContent = Math.random() > 0.5 ? '0' : '1';
                        cycles--;
                        setTimeout(shuffle, 32 + Math.random() * 24);
                    } else {
                        span.textContent = span.dataset.final || '';
                        span.classList.add('locked');
                    }
                };

                setTimeout(shuffle, idx * 50);
            });
        };

        roll();
        el.addEventListener('mouseenter', roll);
        setInterval(roll, 9000);
    });
}