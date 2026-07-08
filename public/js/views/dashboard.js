import { api } from '../api.js';
import { esc, fmtShort, guard } from '../ui.js';

export const renderDashboard = guard(async (root, ctx) => {
  ctx.setHead('Dashboard', 'Overview of your lab notebook');
  root.innerHTML = '<div class="muted">Loading…</div>';
  const [exps, inv, plans] = await Promise.all([api.experiments(), api.inventory(), api.plans()]);

  const totalEntries = exps.reduce((n, e) => n + (e.entryCount || 0), 0);
  const lowStock = inv.filter(i => i.low || i.expired || i.expiring);
  const recent = exps.slice(0, 5);
  const nextActionRows = openProcedureStepItems(exps).slice(0, 6);

  root.innerHTML = `
    <div class="grid kpis" style="margin-bottom:16px">
      <div class="card kpi"><b>${exps.length}</b><span>Experiments</span></div>
      <div class="card kpi"><b>${totalEntries}</b><span>Notebook entries</span></div>
      <div class="card kpi"><b>${plans.length}</b><span>🧪 Plans</span></div>
      <div class="card kpi"><b>${lowStock.length}</b><span>📦 Stock alerts</span></div>
    </div>
    <div class="split">
      <div class="card">
        <div class="between"><h2 class="sec-t">Recent experiments</h2>
          <button class="btn sm" data-new>+ New experiment</button></div>
        ${recent.length ? recent.map(row).join('') : '<div class="empty"><div class="big">⚗</div>No experiments yet.</div>'}
      </div>
      <div class="card">
        <h2 class="sec-t">Attention</h2>
        <h3 class="sub-t">Open procedure steps</h3>
        ${nextActionRows.length ? `<div class="next-action-list">
          ${nextActionRows.map(nextActionItem).join('')}
        </div>` : '<p class="muted" style="font-size:13px">No open procedure steps.</p>'}
        <h3 class="sub-t">Stock alerts</h3>
        ${lowStock.length ? lowStock.slice(0, 8).map(i => `
          <div class="between" style="padding:7px 0;border-bottom:1px solid var(--line)">
            <div>${esc(i.name)}<div class="muted" style="font-size:11px">${i.quantity} ${esc(i.unit || '')}</div></div>
            ${i.expired ? '<span class="pill danger">expired</span>' : i.low ? '<span class="pill warn">low stock</span>' : '<span class="pill warn">expiring</span>'}
          </div>`).join('') : '<p class="muted" style="font-size:13px">No stock alerts. 👍</p>'}
        <div class="hint" style="margin-top:14px">🎙 Voice &amp; 📷 OCR capture live inside each experiment. 🔒 Sign entries to lock them into the audit trail.</div>
      </div>
    </div>`;

  root.querySelector('[data-new]').onclick = () => ctx.go('experiments');
  root.querySelectorAll('[data-exp]').forEach(el => el.onclick = () => ctx.go('experiments', { id: el.dataset.exp }));
  root.querySelectorAll('[data-next-action-exp]').forEach(el => el.onclick = () => ctx.go('experiments', { id: el.dataset.nextActionExp }));

  function _unused() {}
});

function openProcedureStepItems(exps) {
  return (exps || [])
    .filter(e => e.next_step)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
}

function nextActionItem(e) {
  const completed = Number(e.completedStepCount) || 0;
  const total = Number(e.stepCount) || 0;
  const open = Number(e.openStepCount) || 0;
  return `<button class="next-action-item" type="button" data-next-action-exp="${esc(e.id)}">
    <span>
      <b>${esc(e.title)}</b>
      <small>${esc(e.next_step)}</small>
    </span>
    <em>${open} open · ${completed}/${total} done</em>
  </button>`;
}

function row(e) {
  return `<div class="between" data-exp="${e.id}" style="padding:10px 0;border-bottom:1px solid var(--line);cursor:pointer">
    <div><div style="font-weight:600">${esc(e.title)}</div>
      <div class="muted" style="font-size:12px">${e.entryCount || 0} entries · ${fmtShort(e.updated_at)}</div>
      ${experimentNextStepSummary(e)}</div>
    <span class="status s-${e.status}">${e.status}</span></div>`;
}

function experimentNextStepSummary(e) {
  const total = Number(e.stepCount) || 0;
  if (!total) return '';
  const completed = Number(e.completedStepCount) || 0;
  const open = Number(e.openStepCount) || 0;
  if (e.next_step) {
    return `<div class="next-step-preview compact" data-next-experiment-step="${esc(e.next_step_id || '')}">
      <b>Next step</b><span>${esc(e.next_step)}</span><em>${open} open · ${completed}/${total} done</em>
    </div>`;
  }
  return `<div class="next-step-preview compact done" data-next-experiment-step="">
    <b>Steps</b><span>All procedure steps complete.</span><em>${open} open · ${completed}/${total} done</em>
  </div>`;
}
