/**
 * Live Discord-style ops deck:
 * typing bubble (3 bouncing dots) + label + command typewriter + reply loop.
 */

const CMD = '/channel lock #general';
const LOGO = 'images/cypher rebrand logo round (No BG).png';

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function show(el) {
    if (!el) return;
    el.hidden = false;
    el.classList.remove('is-enter');
    // reflow for re-triggering entrance
    void el.offsetWidth;
    el.classList.add('is-enter');
}

function hide(el) {
    if (!el) return;
    el.hidden = true;
    el.classList.remove('is-enter');
}

export function initDeckDemo() {
    const deck = document.getElementById('opsDeck');
    if (!deck) return;

    const step = (name) => deck.querySelector(`[data-deck-step="${name}"]`);
    const typing = document.getElementById('deckTyping');
    const typingName = document.getElementById('deckTypingName');
    const avatarBot = document.getElementById('deckTypingAvatarBot');
    const avatarUser = document.getElementById('deckTypingAvatarUser');
    const cmdTyped = document.getElementById('deckCmdTyped');
    const cmdCaret = document.getElementById('deckCmdCaret');

    const botReady = step('bot-ready');
    const adminCmd = step('admin-cmd');
    const botReply = step('bot-reply');

    if (!typing || !botReady || !adminCmd || !botReply) return;

    let runId = 0;
    const reduced = prefersReducedMotion();

    const setTyping = (who) => {
        // who: 'admin' | 'cypher' | null
        if (!who) {
            hide(typing);
            return;
        }

        if (typingName) typingName.textContent = who === 'admin' ? 'admin' : 'Cypher';
        if (avatarBot) avatarBot.hidden = who !== 'cypher';
        if (avatarUser) avatarUser.hidden = who !== 'admin';

        show(typing);
    };

    const typeCommand = async (token) => {
        if (!cmdTyped) return;
        cmdTyped.textContent = '';
        if (cmdCaret) cmdCaret.hidden = false;

        if (reduced) {
            cmdTyped.textContent = CMD;
            if (cmdCaret) cmdCaret.hidden = true;
            return;
        }

        for (let i = 0; i < CMD.length; i += 1) {
            if (token !== runId) return;
            cmdTyped.textContent = CMD.slice(0, i + 1);
            const ch = CMD[i];
            const delay = ch === ' ' ? 50 : ch === '/' ? 85 : 26 + Math.random() * 40;
            await wait(delay);
        }
        await wait(160);
        if (token === runId && cmdCaret) cmdCaret.hidden = true;
    };

    const reset = () => {
        hide(botReady);
        hide(adminCmd);
        hide(botReply);
        hide(typing);
        if (cmdTyped) cmdTyped.textContent = '';
        if (cmdCaret) cmdCaret.hidden = true;
    };

    const cycle = async (token) => {
        while (token === runId) {
            reset();
            await wait(reduced ? 200 : 420);
            if (token !== runId) return;

            // 1) Cypher status
            show(botReady);
            await wait(reduced ? 500 : 1300);
            if (token !== runId) return;

            // 2) admin typing indicator
            setTyping('admin');
            await wait(reduced ? 450 : 1150);
            if (token !== runId) return;

            // 3) slash command with typewriter
            hide(typing);
            show(adminCmd);
            await typeCommand(token);
            if (token !== runId) return;
            await wait(reduced ? 280 : 650);
            if (token !== runId) return;

            // 4) Cypher typing (Discord bubble + label)
            setTyping('cypher');
            await wait(reduced ? 650 : 1550);
            if (token !== runId) return;

            // 5) reply embed
            hide(typing);
            show(botReply);
            await wait(reduced ? 1400 : 3000);
        }
    };

    const start = () => {
        runId += 1;
        const token = runId;
        if (reduced) {
            show(botReady);
            show(adminCmd);
            if (cmdTyped) cmdTyped.textContent = CMD;
            show(botReply);
            hide(typing);
            return;
        }
        wait(650).then(() => cycle(token));
    };

    start();

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            runId += 1; // cancel loop
        } else {
            start();
        }
    });
}