import { API_BASE } from './api-config.js?v=20260803v1';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let cmdAnimTimer = 0;
function animateCommandRows() {
    if (reduced()) return;
    window.clearTimeout(cmdAnimTimer);
    cmdAnimTimer = window.setTimeout(() => {
        const visibleRows = document.querySelectorAll('.cmd-row:not(.is-hidden)');
        visibleRows.forEach((row, i) => {
            if (i > 11) return;
            row.classList.remove('cmd-enter');
            void row.offsetWidth;
            row.style.animationDelay = `${i * 0.025}s`;
            row.classList.add('cmd-enter');
        });
    }, 40);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setStatus(listEl, message, kind = 'loading') {
    if (!listEl) return;
    listEl.innerHTML = `<div class="cmd-status cmd-status--${kind}" role="status">${escapeHtml(message)}</div>`;
}

function buildRail(railEl, categories) {
    if (!railEl) return;
    const buttons = [
        `<button type="button" class="is-active" data-cmd-filter="all">All</button>`,
        ...categories.map(
            (cat) =>
                `<button type="button" data-cmd-filter="${escapeHtml(cat.id)}">${escapeHtml(cat.label)}</button>`
        ),
    ];
    railEl.innerHTML = buttons.join('');
}

function buildList(listEl, commands) {
    if (!listEl) return;

    if (!commands.length) {
        setStatus(listEl, 'No public commands are registered right now.', 'empty');
        return;
    }

    const byCategory = new Map();
    for (const cmd of commands) {
        const key = cmd.category || 'general';
        if (!byCategory.has(key)) {
            byCategory.set(key, {
                id: key,
                label: cmd.categoryLabel || key,
                items: [],
            });
        }
        byCategory.get(key).items.push(cmd);
    }

    const fragments = [];
    for (const group of byCategory.values()) {
        fragments.push(
            `<div class="cmd-group-label" data-cmd-group="${escapeHtml(group.id)}">${escapeHtml(group.label)}</div>`
        );
        for (const cmd of group.items) {
            const name = cmd.name || '';
            const desc = cmd.description || '';
            const cat = cmd.category || 'general';
            const badge = cmd.categoryLabel || cat;
            fragments.push(
                `<div class="cmd-row" data-category="${escapeHtml(cat)}" data-name="${escapeHtml(name)}" data-desc="${escapeHtml(desc)}">` +
                    `<span class="cmd-row__name">${escapeHtml(name)}</span>` +
                    `<span class="cmd-row__desc">${escapeHtml(desc)}</span>` +
                    `<span class="cmd-row__badge">${escapeHtml(badge)}</span>` +
                `</div>`
            );
        }
    }

    listEl.innerHTML = fragments.join('');
}

function wireFilters(root) {
    const search = document.getElementById('commandSearch');
    const countEl = document.getElementById('commandCount');
    const railButtons = Array.from(root.querySelectorAll('[data-cmd-filter]'));
    const rows = Array.from(root.querySelectorAll('.cmd-row'));
    const groups = Array.from(root.querySelectorAll('[data-cmd-group]'));

    if (!rows.length) {
        if (countEl) countEl.textContent = '0 commands';
        return;
    }

    let activeFilter = 'all';
    let query = '';
    let firstRun = true;

    const update = () => {
        const q = query.trim().toLowerCase();
        let visible = 0;

        rows.forEach((row) => {
            const cat = row.dataset.category || '';
            const name = (row.dataset.name || row.textContent || '').toLowerCase();
            const desc = (row.dataset.desc || '').toLowerCase();
            const matchFilter = activeFilter === 'all' || cat === activeFilter;
            const matchQuery = !q || name.includes(q) || desc.includes(q) || cat.includes(q);
            const show = matchFilter && matchQuery;
            row.classList.toggle('is-hidden', !show);
            if (show) visible += 1;
        });

        groups.forEach((group) => {
            const cat = group.dataset.cmdGroup;
            const any = rows.some(
                (row) =>
                    row.dataset.category === cat &&
                    !row.classList.contains('is-hidden')
            );
            group.classList.toggle('is-hidden', !any);
        });

        if (countEl) {
            countEl.textContent = `${visible} command${visible === 1 ? '' : 's'}`;
        }

        if (!firstRun) animateCommandRows();
        firstRun = false;
    };

    if (search) {
        const next = search.cloneNode(true);
        search.parentNode.replaceChild(next, search);
        next.addEventListener('input', () => {
            query = next.value;
            update();
        });
    }

    railButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            activeFilter = btn.dataset.cmdFilter || 'all';
            railButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
            update();
        });
    });

    update();
}

async function loadCommands() {
    const listEl = document.getElementById('commandList');
    const railEl = document.querySelector('.cmd-rail');
    const countEl = document.getElementById('commandCount');
    const appEl = document.querySelector('.cmd-app');

    if (!listEl) return;

    setStatus(listEl, 'Loading commands from Discord…', 'loading');
    if (countEl) countEl.textContent = '…';
    if (railEl) {
        railEl.innerHTML = `<button type="button" class="is-active" data-cmd-filter="all" disabled>All</button>`;
    }

    try {
        const res = await fetch(`${API_BASE}/api/commands`, {
            method: 'GET',
            mode: 'cors',
            cache: 'default',
        });

        if (!res.ok) {
            throw new Error(`Commands API returned ${res.status}`);
        }

        const data = await res.json();
        const commands = Array.isArray(data.commands) ? data.commands : [];
        const categories = Array.isArray(data.categories) ? data.categories : [];

        buildRail(railEl, categories);
        buildList(listEl, commands);
        if (appEl) wireFilters(appEl);
    } catch (err) {
        console.error('Failed to load commands:', err);
        setStatus(
            listEl,
            'Could not load the live command list. Try again in a moment.',
            'error'
        );
        if (countEl) countEl.textContent = '—';
        if (railEl) {
            railEl.innerHTML = `<button type="button" class="is-active" data-cmd-filter="all" disabled>All</button>`;
        }
    }
}

export function initCommands() {
    if (!document.getElementById('commandList')) return;
    loadCommands();
}