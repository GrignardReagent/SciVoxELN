import { api } from '../api.js';
import { esc, guard } from '../ui.js';

export const renderAudit = guard(async (root, ctx) => {
  ctx.setHead('Audit Trail', 'Immutable, time-stamped record of every action');
  root.innerHTML = '<div class="muted">Loading…</div>';
  let rows = await api.audit();
  const q = ctx.search;
  if (q) rows = rows.filter(a => (a.action + ' ' + a.detail + ' ' + a.user).toLowerCase().includes(q));

  root.innerHTML = `
    <div class="between" style="margin-bottom:14px">
      <span class="pill">${rows.length} events</span>
      <a class="btn ghost sm" href="/api/audit/export.csv" download>⬇ Export CSV</a>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <table class="tbl">
        <thead><tr><th>Timestamp (ISO)</th><th>User</th><th>Action</th><th>Project</th><th>Detail</th><th>Hash chain</th></tr></thead>
        <tbody>${rows.map(a => `<tr>
          <td class="mono">${esc(a.ts)}</td>
          <td>${esc(a.user)}<div class="muted" style="font-size:11px">${esc(a.role || '')}</div></td>
          <td><b>${esc(a.action)}</b></td>
          <td class="muted mono">${esc(a.project_id || '—')}</td>
          <td class="muted audit-detail">${esc(a.detail || '')}</td>
          <td class="mono muted" style="font-size:11px">${esc((a.hash || '').slice(0, 16))}${a.previous_hash ? `<div>prev ${esc(a.previous_hash.slice(0, 16))}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted" style="padding:20px">No events.</td></tr>'}</tbody>
      </table>
    </div>`;
});
