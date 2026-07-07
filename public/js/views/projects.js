import { api } from '../api.js';
import { esc, fmtShort, toast, modal, closeModal, confirmModal, guard } from '../ui.js';
import { isAdmin } from '../state.js';

export const renderProjects = guard(async (root, ctx) => {
  ctx.setHead('Projects', 'Workspaces, access and pilot teams');
  root.innerHTML = '<div class="muted">Loading…</div>';
  let projects = await api.projects();
  const q = ctx.search;
  if (q) projects = projects.filter(p => (p.name + ' ' + p.org_name + ' ' + (p.description || '')).toLowerCase().includes(q));

  root.innerHTML = `
    <div class="between" style="margin-bottom:14px">
      <span class="pill">${projects.length} project${projects.length !== 1 ? 's' : ''}</span>
      ${isAdmin() ? '<button class="btn" data-new-project>+ New project</button>' : ''}
    </div>
    <div class="grid cardlist">${projects.map(projectCard).join('') || '<div class="empty">No projects.</div>'}</div>
    <div id="projectDetail" style="margin-top:16px"></div>`;

  const newBtn = root.querySelector('[data-new-project]');
  if (newBtn) newBtn.onclick = () => newProjectModal(ctx);
  root.querySelectorAll('[data-project]').forEach(el => el.onclick = () => showProject(root, el.dataset.project));
});

function projectCard(p) {
  return `<div class="card hover" data-project="${p.id}">
    <div class="between"><h3>${esc(p.name)}</h3><span class="pill">${esc(p.org_name || 'Workspace')}</span></div>
    <div class="muted" style="font-size:13px">${esc(p.description || 'No description')}</div>
    <div class="meta"><span>${p.experiment_count || 0} experiments</span><span>· ${p.member_count || 0} members</span><span>· ${fmtShort(p.created_at)}</span></div>
  </div>`;
}

async function showProject(root, projectId) {
  const mount = root.querySelector('#projectDetail');
  mount.innerHTML = '<div class="muted">Loading members…</div>';
  const members = await api.projectMembers(projectId);
  mount.innerHTML = `
    <div class="card">
      <div class="between"><h2 class="sec-t" style="margin:0">Project members</h2>
      ${isAdmin() ? '<button class="btn sm" data-add-member>+ Member</button>' : ''}</div>
      <div style="overflow:auto;margin-top:10px">
        <table class="tbl">
          <thead><tr><th>User</th><th>Email</th><th>Role</th><th></th></tr></thead>
          <tbody>${members.map(m => memberRow(m)).join('') || '<tr><td colspan="4" class="muted" style="padding:16px">No members.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="hint">Project roles: viewer can read, scientist can write/sign, reviewer can lock, owner can manage membership.</div>
    </div>`;
  const add = mount.querySelector('[data-add-member]');
  if (add) add.onclick = () => memberModal(projectId, () => showProject(root, projectId));
  mount.querySelectorAll('[data-remove-member]').forEach(b => b.onclick = () => confirmModal('Remove member?',
    'This user will lose access to this project.',
    guard(async () => { await api.setProjectMember(projectId, { userId: b.dataset.removeMember, role: 'remove' }); toast('Member removed'); showProject(root, projectId); }), 'Remove'));
}

function memberRow(m) {
  const archived = m.archived_at ? ' <span class="pill danger">Archived</span>' : '';
  return `<tr>
    <td><b>${esc(m.name || '—')}</b>${archived}</td>
    <td class="muted">${esc(m.email || '—')}</td>
    <td><span class="pill">${esc(m.role)}</span></td>
    <td>${isAdmin() ? `<button class="btn danger sm" data-remove-member="${m.id}">Remove</button>` : ''}</td>
  </tr>`;
}

async function newProjectModal(ctx) {
  const orgs = await api.orgs();
  modal(`<h3>New project</h3>
    <label class="fld">Workspace</label>
    <select class="txt" id="pOrg">${orgs.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select>
    <label class="fld">Project name</label><input class="txt" id="pName" placeholder="e.g. Cell line development"/>
    <label class="fld">Description</label><textarea class="txt" id="pDesc" placeholder="Pilot scope, team or programme"></textarea>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Create</button></div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-ok]').onclick = guard(async () => {
    const name = m.querySelector('#pName').value.trim();
    if (!name) return toast('Project name required', true);
    await api.createProject({ org_id: m.querySelector('#pOrg').value, name, description: m.querySelector('#pDesc').value.trim() });
    closeModal(); toast('Project created'); ctx.refresh();
  });
}

function memberModal(projectId, refresh) {
  modal(`<h3>Add or update member</h3>
    <label class="fld">User email</label><input class="txt" id="mEmail" placeholder="scientist@company.com"/>
    <label class="fld">Project role</label>
    <select class="txt" id="mRole">
      ${['viewer', 'scientist', 'reviewer', 'owner'].map(r => `<option>${r}</option>`).join('')}
    </select>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Save</button></div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-ok]').onclick = guard(async () => {
    const email = m.querySelector('#mEmail').value.trim();
    if (!email) return toast('Email required', true);
    await api.setProjectMember(projectId, { email, role: m.querySelector('#mRole').value });
    closeModal(); toast('Member updated'); refresh();
  });
}
