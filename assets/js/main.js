// Main initialization script
import { initNavigation } from './navigation.js';
import { initAnimations } from './animations.js';
import { initCards } from './cards.js';
import { initButtons } from './buttons.js';

// Initialize all modules when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initAnimations();
    initCards();
    initButtons();
});
