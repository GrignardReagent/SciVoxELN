import { api } from '../api.js';
import { esc, fmtShort, guard } from '../ui.js';

export const renderDashboard = guard(async (root, ctx) => {
  ctx.setHead('Dashboard', 'Overview of your lab notebook');
  root.innerHTML = '<div class="muted">Loading…</div>';
  const [exps, inv, plans] = await Promise.all([api.experiments(), api.inventory(), api.plans()]);

  const totalEntries = exps.reduce((n, e) => n + (e.entryCount || 0), 0);
  const lowStock = inv.filter(i => i.low || i.expired || i.expiring);
  const recent = exps.slice(0, 5);

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

  function _unused() {}
});

function row(e) {
  return `<div class="between" data-exp="${e.id}" style="padding:10px 0;border-bottom:1px solid var(--line);cursor:pointer">
    <div><div style="font-weight:600">${esc(e.title)}</div>
      <div class="muted" style="font-size:12px">${e.entryCount || 0} entries · ${fmtShort(e.updated_at)}</div></div>
    <span class="status s-${e.status}">${e.status}</span></div>`;
}
