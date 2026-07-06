import { api } from '../api.js';
import { esc, fmtShort, toast, confirmModal, guard } from '../ui.js';
import { getUser } from '../state.js';

export const renderUsers = guard(async (root, ctx) => {
  ctx.setHead('Users', 'Manage accounts and roles (admin)');
  root.innerHTML = '<div class="muted">Loading…</div>';
  let users = await api.users();
  const q = ctx.search;
  if (q) users = users.filter(u => ((u.name || '') + ' ' + (u.email || '')).toLowerCase().includes(q));
  const me = getUser();

  root.innerHTML = `
    <div class="between" style="margin-bottom:14px">
      <span class="pill">${users.length} user${users.length !== 1 ? 's' : ''}</span>
      <span class="muted" style="font-size:12px">Roles: <b>admin</b> &gt; <b>reviewer</b> &gt; <b>scientist</b> &gt; <b>viewer</b></span>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <table class="tbl">
        <thead><tr><th>User</th><th>Email</th><th>Sign-in</th><th>Joined</th><th>Role</th></tr></thead>
        <tbody>${users.map(u => rowHTML(u, me)).join('')}</tbody>
      </table>
    </div>
    <div class="hint">Account roles set broad privileges; project memberships decide which notebooks a user can see or edit. The last remaining admin cannot be demoted.</div>`;

  root.querySelectorAll('select[data-role]').forEach(sel => sel.onchange = guard(async () => {
    const id = sel.dataset.role, role = sel.value;
    confirmModal('Change role?', `Set this account to <b>${role}</b>?`, guard(async () => {
      await api.setUserRole(id, role); toast('Role updated'); ctx.refresh();
    }), 'Change');
    // revert visual until confirmed; refresh will redraw
  }));
});

function rowHTML(u, me) {
  const isSelf = me && me.id === u.id;
  return `<tr>
    <td><b>${esc(u.name || '—')}</b>${isSelf ? ' <span class="pill">you</span>' : ''}</td>
    <td class="muted">${esc(u.email || '—')}</td>
    <td><span class="pill">${esc(u.provider)}</span></td>
    <td class="muted">${fmtShort(u.created_at)}</td>
    <td>
      <select class="txt" data-role="${u.id}" style="width:120px;padding:6px 8px">
        <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>viewer</option>
        <option value="scientist" ${u.role === 'scientist' || u.role === 'user' ? 'selected' : ''}>scientist</option>
        <option value="reviewer" ${u.role === 'reviewer' ? 'selected' : ''}>reviewer</option>
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
      </select>
    </td>
  </tr>`;
}
