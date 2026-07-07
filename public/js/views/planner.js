import { api } from '../api.js';
import { esc, toast, confirmModal, guard } from '../ui.js';

let openId = null; // currently-edited plan id (module-local sub-state)

export const renderPlanner = guard(async (root, ctx) => {
  ctx.setHead('Experiment Planner', 'Design protocols before you run them');
  root.innerHTML = '<div class="muted">Loading…</div>';
  const [plans, inv] = await Promise.all([api.plans(), api.inventory()]);

  if (openId) {
    const plan = plans.find(p => p.id === openId);
    if (plan) return editor(root, ctx, plan, inv);
    openId = null;
  }

  let list = plans;
  const q = ctx.search;
  if (q) list = list.filter(p => (p.title + ' ' + p.hypothesis).toLowerCase().includes(q));

  root.innerHTML = `
    <div class="between" style="margin-bottom:16px">
      <span class="pill">${list.length} plan${list.length !== 1 ? 's' : ''}</span>
      <button class="btn" data-new>+ New plan</button>
    </div>
    ${list.length ? `<div class="grid cardlist">${list.map(card).join('')}</div>`
      : `<div class="empty"><div class="big">🧪</div>${q ? 'No matches.' : 'No plans yet. Design your first experiment.'}</div>`}`;

  root.querySelector('[data-new]').onclick = guard(async () => {
    const p = await api.createPlan({ title: 'Untitled plan', steps: [], variables: [], materials: [] });
    openId = p.id; ctx.go('planner');
  });
  root.querySelectorAll('[data-open]').forEach(el => el.onclick = () => { openId = el.dataset.open; ctx.go('planner'); });
});

function card(p) {
  const done = p.steps.filter(s => s.done).length;
  return `<div class="card hover" data-open="${p.id}">
    <div class="between"><h3>${esc(p.title)}</h3><span class="status s-${p.status}">${p.status}</span></div>
    <div class="muted" style="font-size:13px">${esc(p.hypothesis || 'No hypothesis set')}</div>
    <div class="meta"><span class="tag">${p.variables.length} variables</span>
      <span>✓ ${done}/${p.steps.length} steps</span>${p.experiment_id ? '<span>· linked ⚗</span>' : ''}</div>
  </div>`;
}

/* --------------------------- Editor --------------------------- */
function editor(root, ctx, plan, inv) {
  // local editable copy
  const d = JSON.parse(JSON.stringify(plan));
  d.variables ||= []; d.steps ||= []; d.materials ||= [];

  const draw = () => {
    root.innerHTML = `
      <button class="btn ghost sm" data-back>← Back to plans</button>
      <div class="split" style="margin-top:14px">
        <div>
          <div class="card">
            <label class="fld">Title</label><input class="txt" id="pTitle" value="${esc(d.title)}"/>
            <label class="fld">Hypothesis</label><textarea class="txt" id="pHyp" placeholder="What do you expect and why?">${esc(d.hypothesis)}</textarea>
            <label class="fld">Expected outcome</label><textarea class="txt" id="pOut">${esc(d.expected_outcome)}</textarea>

            <h2 class="sec-t" style="margin-top:18px">Variables</h2>
            <div id="vars">${d.variables.map((v, i) => varRow(v, i)).join('') || '<div class="muted" style="font-size:12px">No variables.</div>'}</div>
            <button class="btn ghost sm" id="addVar" style="margin-top:8px">+ Add variable</button>

            <h2 class="sec-t" style="margin-top:18px">Protocol steps</h2>
            <div id="steps">${d.steps.map((s, i) => stepRow(s, i)).join('') || '<div class="muted" style="font-size:12px">No steps.</div>'}</div>
            <button class="btn ghost sm" id="addStep" style="margin-top:8px">+ Add step</button>

            <h2 class="sec-t" style="margin-top:18px">Materials</h2>
            <div id="mats">${d.materials.map((m, i) => matRow(m, i, inv)).join('') || '<div class="muted" style="font-size:12px">No materials.</div>'}</div>
            <button class="btn ghost sm" id="addMat" style="margin-top:8px">+ Add material</button>
          </div>
        </div>
        <div class="card">
          <h2 class="sec-t">Plan</h2>
          <label class="fld">Status</label>
          <select class="txt" id="pStatus">${['draft', 'ready', 'started', 'archived'].map(s => `<option ${d.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <div class="row" style="margin-top:14px"><button class="btn" id="save">Save plan</button></div>
          <div class="row" style="margin-top:10px">
            <button class="btn ok sm" id="start">${d.experiment_id ? 'Open linked experiment' : '▶ Start as experiment'}</button>
          </div>
          <div class="row" style="margin-top:10px"><button class="btn danger sm" id="del">Delete plan</button></div>
          <div class="hint">Starting a plan creates (or opens) a linked experiment so your notebook entries trace back to the design.</div>
        </div>
      </div>`;

    root.querySelector('[data-back]').onclick = () => { openId = null; ctx.go('planner'); };
    // collect simple fields on change
    const g = id => root.querySelector(id);
    g('#pTitle').oninput = e => d.title = e.target.value;
    g('#pHyp').oninput = e => d.hypothesis = e.target.value;
    g('#pOut').oninput = e => d.expected_outcome = e.target.value;
    g('#pStatus').onchange = e => d.status = e.target.value;

    g('#addVar').onclick = () => { d.variables.push({ name: '', type: 'independent', values: '' }); draw(); };
    g('#addStep').onclick = () => { d.steps.push({ text: '', done: false }); draw(); };
    g('#addMat').onclick = () => { d.materials.push({ name: '', amount: '', unit: '' }); draw(); };

    root.querySelectorAll('[data-vari]').forEach(el => bindVar(el, d, draw));
    root.querySelectorAll('[data-stepi]').forEach(el => bindStep(el, d, draw));
    root.querySelectorAll('[data-mati]').forEach(el => bindMat(el, d, draw, inv));

    g('#save').onclick = guard(async () => { await api.updatePlan(d.id, d); toast('Plan saved'); });
    g('#del').onclick = () => confirmModal('Delete plan?', 'This cannot be undone.',
      guard(async () => { await api.deletePlan(d.id); openId = null; toast('Plan deleted'); ctx.go('planner'); }), 'Delete');
    g('#start').onclick = guard(async () => {
      await api.updatePlan(d.id, d);
      const res = await api.startPlan(d.id);
      toast('Experiment ready'); ctx.go('experiments', { id: res.experiment.id });
    });
  };
  draw();
}

/* row templates */
function varRow(v, i) {
  return `<div class="row" data-vari="${i}" style="margin-bottom:6px">
    <input class="txt" data-f="name" placeholder="Name" value="${esc(v.name)}" style="flex:1"/>
    <select class="txt" data-f="type" style="width:140px">
      ${['independent', 'dependent', 'controlled'].map(t => `<option ${v.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <input class="txt" data-f="values" placeholder="Levels / units" value="${esc(v.values || '')}" style="flex:1"/>
    <button class="btn ghost sm" data-del>✕</button></div>`;
}
function stepRow(s, i) {
  return `<div class="step" data-stepi="${i}">
    <input type="checkbox" data-f="done" ${s.done ? 'checked' : ''}/>
    <input class="txt" data-f="text" placeholder="Describe the step" value="${esc(s.text)}" style="flex:1"/>
    <button class="btn ghost sm" data-del>✕</button></div>`;
}
function matRow(m, i, inv) {
  const selectedId = m.inventory_id || inv.find(it => it.name === m.name)?.id || '';
  const opts = ['<option value="">— free text —</option>'].concat(inv.map(it => {
    const status = inventoryStatus(it);
    const label = [
      it.name,
      it.lot_number ? `lot ${it.lot_number}` : '',
      `${it.quantity} ${it.unit || ''}`.trim(),
      status !== 'ok' ? status : ''
    ].filter(Boolean).join(' · ');
    return `<option value="${esc(it.id)}" ${selectedId === it.id ? 'selected' : ''}>${esc(label)}</option>`;
  })).join('');
  return `<div data-mati="${i}" style="margin-bottom:8px">
    <div class="row">
    <select class="txt" data-f="pick" style="flex:1">${opts}</select>
    <input class="txt" data-f="name" placeholder="Material" value="${esc(m.name)}" style="flex:1"/>
    <input class="txt" data-f="amount" placeholder="Amt" value="${esc(m.amount)}" style="width:80px"/>
    <input class="txt" data-f="unit" placeholder="Unit" value="${esc(m.unit || '')}" style="width:70px"/>
    <button class="btn ghost sm" data-del>✕</button>
    </div>
    ${inventoryEvidence(m, inv)}
  </div>`;
}

function bindVar(el, d, draw) {
  const i = +el.dataset.vari;
  el.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => { d.variables[i][inp.dataset.f] = inp.value; });
  el.querySelector('[data-del]').onclick = () => { d.variables.splice(i, 1); draw(); };
}
function bindStep(el, d, draw) {
  const i = +el.dataset.stepi;
  el.querySelector('[data-f="text"]').onchange = e => d.steps[i].text = e.target.value;
  el.querySelector('[data-f="done"]').onchange = e => d.steps[i].done = e.target.checked;
  el.querySelector('[data-del]').onclick = () => { d.steps.splice(i, 1); draw(); };
}
function bindMat(el, d, draw, inv) {
  const i = +el.dataset.mati;
  const pick = el.querySelector('[data-f="pick"]');
  const name = el.querySelector('[data-f="name"]');
  pick.onchange = () => {
    const item = inv.find(it => it.id === pick.value);
    if (item) {
      d.materials[i] = { ...d.materials[i], ...inventorySnapshot(item) };
      draw();
    } else {
      d.materials[i] = clearInventorySnapshot({ ...d.materials[i], name: name.value });
      draw();
    }
  };
  name.onchange = () => {
    const previousName = d.materials[i].name;
    const hadInventory = !!d.materials[i].inventory_id;
    d.materials[i].name = name.value;
    if (hadInventory && name.value !== previousName) d.materials[i] = clearInventorySnapshot(d.materials[i]);
  };
  el.querySelector('[data-f="amount"]').onchange = e => d.materials[i].amount = e.target.value;
  el.querySelector('[data-f="unit"]').onchange = e => d.materials[i].unit = e.target.value;
  el.querySelector('[data-del]').onclick = () => { d.materials.splice(i, 1); draw(); };
}

function inventorySnapshot(item) {
  return {
    inventory_id: item.id,
    name: item.name,
    unit: item.unit || '',
    lot_number: item.lot_number || '',
    catalog_number: item.catalog_number || '',
    location: item.location || '',
    available_quantity: item.quantity,
    available_unit: item.unit || '',
    reorder_level: item.reorder_level,
    expiry_date: item.expiry_date || '',
    inventory_status: inventoryStatus(item)
  };
}

function clearInventorySnapshot(material) {
  const copy = { ...material };
  delete copy.inventory_id;
  delete copy.lot_number;
  delete copy.catalog_number;
  delete copy.location;
  delete copy.available_quantity;
  delete copy.available_unit;
  delete copy.reorder_level;
  delete copy.expiry_date;
  delete copy.inventory_status;
  return copy;
}

function inventoryEvidence(material, inv) {
  const fromInventory = inv.find(it => it.id === material.inventory_id);
  const data = fromInventory ? { ...inventorySnapshot(fromInventory), amount: material.amount, unit: material.unit || fromInventory.unit } : material;
  if (!data.inventory_id && !data.lot_number && !data.location && data.available_quantity == null && !data.expiry_date) return '';
  const status = inventoryStatus(data);
  const details = [
    data.lot_number ? `lot ${data.lot_number}` : '',
    data.catalog_number ? `cat ${data.catalog_number}` : '',
    data.location || '',
    data.available_quantity != null ? `available ${data.available_quantity} ${data.available_unit || data.unit || ''}`.trim() : '',
    data.expiry_date ? `expires ${data.expiry_date}` : ''
  ].filter(Boolean);
  return `<div class="hint" data-inventory-evidence style="margin:6px 0 0 0">
    <span class="pill ${status === 'expired' ? 'danger' : status === 'ok' ? '' : 'warn'}">${esc(status)}</span>
    ${esc(details.join(' · ') || 'Inventory item selected')}
  </div>`;
}

function inventoryStatus(item) {
  if (item.inventory_status) return item.inventory_status;
  if (item.expired) return 'expired';
  if (item.low) return 'low';
  if (item.expiring) return 'expiring';
  const low = Number(item.available_quantity ?? item.quantity) <= Number(item.reorder_level);
  if (Number.isFinite(Number(item.reorder_level)) && low) return 'low';
  if (item.expiry_date) {
    const days = (new Date(item.expiry_date) - new Date()) / 86400000;
    if (days < 0) return 'expired';
    if (days <= 30) return 'expiring';
  }
  return 'ok';
}
