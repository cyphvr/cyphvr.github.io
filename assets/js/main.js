import { initNavigation } from './navigation.js';
import { initAnimations } from './animations.js';
import { initCards } from './cards.js';
import { initButtons } from './buttons.js';
import { initCapabilityPuzzle } from './capabilities.js';

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initAnimations();
    initCards();
    initButtons();
    initCapabilityPuzzle();
});