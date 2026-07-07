import { api } from '../api.js';
import { esc, fmtShort, toast, confirmModal, guard } from '../ui.js';
import { getUser } from '../state.js';

let showArchivedUsers = false;

export const renderUsers = guard(async (root, ctx) => {
  ctx.setHead('Users', 'Manage accounts and roles (admin)');
  root.innerHTML = '<div class="muted">Loading…</div>';
  let users = await api.users(showArchivedUsers);
  const q = ctx.search;
  if (q) users = users.filter(u => ((u.name || '') + ' ' + (u.email || '')).toLowerCase().includes(q));
  const me = getUser();

  root.innerHTML = `
    <div class="between" style="margin-bottom:14px">
      <span class="pill">${users.length} user${users.length !== 1 ? 's' : ''}</span>
      <label class="row" style="gap:7px;font-size:12px;color:var(--muted)">
        <input id="showArchivedUsers" type="checkbox" ${showArchivedUsers ? 'checked' : ''}/>
        Show archived
      </label>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <table class="tbl">
        <thead><tr><th>User</th><th>Email</th><th>Sign-in</th><th>Joined</th><th>Status</th><th>Role</th><th></th></tr></thead>
        <tbody>${users.map(u => rowHTML(u, me)).join('')}</tbody>
      </table>
    </div>
    <div class="hint">Account roles set broad privileges; project memberships decide which notebooks a user can see or edit. Archived users cannot sign in until restored. The last remaining admin cannot be demoted or archived.</div>`;

  root.querySelector('#showArchivedUsers').onchange = () => {
    showArchivedUsers = root.querySelector('#showArchivedUsers').checked;
    ctx.refresh();
  };

  root.querySelectorAll('select[data-role]').forEach(sel => sel.onchange = guard(async () => {
    const id = sel.dataset.role, role = sel.value;
    confirmModal('Change role?', `Set this account to <b>${role}</b>?`, guard(async () => {
      await api.setUserRole(id, role); toast('Role updated'); ctx.refresh();
    }), 'Change');
    sel.value = sel.dataset.currentRole;
  }));

  root.querySelectorAll('[data-archive-user]').forEach(btn => btn.onclick = () => {
    const name = btn.dataset.userName || 'this account';
    confirmModal('Archive user?', `<b>${esc(name)}</b> will be hidden by default and their active sessions will be revoked. Historical records remain unchanged.`, guard(async () => {
      await api.archiveUser(btn.dataset.archiveUser); toast('User archived'); ctx.refresh();
    }), 'Archive');
  });

  root.querySelectorAll('[data-restore-user]').forEach(btn => btn.onclick = () => {
    const name = btn.dataset.userName || 'this account';
    confirmModal('Restore user?', `<b>${esc(name)}</b> will be able to sign in again. Existing sessions are not recreated.`, guard(async () => {
      await api.restoreUser(btn.dataset.restoreUser); toast('User restored'); ctx.refresh();
    }), 'Restore');
  });
});

function rowHTML(u, me) {
  const isSelf = me && me.id === u.id;
  const archived = !!u.archived_at;
  const currentRole = u.role === 'user' ? 'scientist' : u.role;
  const roleDisabled = archived ? 'disabled aria-disabled="true" title="Restore before changing role"' : '';
  const name = u.name || u.email || u.id;
  const status = archived
    ? `<span class="pill danger" title="Archived ${esc(fmtShort(u.archived_at))}">Archived</span>`
    : '<span class="pill">Active</span>';
  const action = archived
    ? `<button class="btn ok sm" data-restore-user="${esc(u.id)}" data-user-name="${esc(name)}">Restore</button>`
    : isSelf
      ? '<button class="btn danger sm" disabled aria-disabled="true" title="You cannot archive your own account">Archive</button>'
      : `<button class="btn danger sm" data-archive-user="${esc(u.id)}" data-user-name="${esc(name)}">Archive</button>`;
  return `<tr>
    <td><b>${esc(u.name || '—')}</b>${isSelf ? ' <span class="pill">you</span>' : ''}</td>
    <td class="muted">${esc(u.email || '—')}</td>
    <td><span class="pill">${esc(u.provider)}</span></td>
    <td class="muted">${fmtShort(u.created_at)}</td>
    <td>${status}</td>
    <td>
      <select class="txt" data-role="${esc(u.id)}" data-current-role="${esc(currentRole)}" style="width:120px;padding:6px 8px" ${roleDisabled}>
        <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>viewer</option>
        <option value="scientist" ${u.role === 'scientist' || u.role === 'user' ? 'selected' : ''}>scientist</option>
        <option value="reviewer" ${u.role === 'reviewer' ? 'selected' : ''}>reviewer</option>
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
      </select>
    </td>
    <td>${action}</td>
  </tr>`;
}
