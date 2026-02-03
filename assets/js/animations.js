export function initAnimations() {
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

    const subtitle = document.querySelector('.hero-subtitle');
    if (subtitle) {
        const text = subtitle.textContent;
        subtitle.textContent = '';
        let i = 0;
        let textNode = document.createTextNode('');
        let cursorSpan = document.createElement('span');
        cursorSpan.className = 'typing-cursor';
        cursorSpan.textContent = '_';
        subtitle.appendChild(textNode);
        subtitle.appendChild(cursorSpan);

        const typeWriter = () => {
            if (i < text.length) {
                textNode.textContent = text.substring(0, i + 1);
                i++;
                setTimeout(typeWriter, 100);
            }
        };

        setTimeout(typeWriter, 1000);
    }

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
                let cycles = 4 + Math.floor(Math.random() * 3);

                const shuffle = () => {
                    if (cycles > 0) {
                        span.textContent = Math.random() > 0.5 ? '0' : '1';
                        cycles--;
                        setTimeout(shuffle, 48 + Math.random() * 32);
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