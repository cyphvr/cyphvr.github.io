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
}
