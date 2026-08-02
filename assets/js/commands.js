import { animateCommandRows } from './animations.js';

export function initCommands() {
    const search = document.getElementById('commandSearch');
    const rows = Array.from(document.querySelectorAll('.cmd-row'));
    const countEl = document.getElementById('commandCount');
    const railButtons = Array.from(document.querySelectorAll('[data-cmd-filter]'));
    const groups = Array.from(document.querySelectorAll('[data-cmd-group]'));

    if (!rows.length) return;

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
        search.addEventListener('input', () => {
            query = search.value;
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
