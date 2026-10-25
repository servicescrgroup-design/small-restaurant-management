/**
 * On phones, wide tables are shown as stacked cards (see `.table` in styles.css), with each value
 * labelled by its column name. This copies every header's text onto the cells below it as
 * `data-label`, and keeps doing so as pages change, so no table needs to do it by hand.
 */
function labelTable(table: HTMLTableElement) {
  const head = table.tHead?.rows[0];
  if (!head) return;
  const names: string[] = [];
  for (const th of Array.from(head.cells)) for (let i = 0; i < th.colSpan; i++) names.push(th.textContent?.trim() ?? '');
  for (const body of [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])]) {
    for (const row of Array.from(body.rows)) {
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        const label = cell.colSpan > 1 ? '' : names[col] ?? '';
        if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
        col += cell.colSpan;
      }
    }
  }
}

export function watchTableLabels(root: HTMLElement = document.body) {
  let queued = false;
  const run = () => { queued = false; root.querySelectorAll<HTMLTableElement>('table.table').forEach(labelTable); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
    .observe(root, { childList: true, subtree: true, characterData: true });
  run();
}
