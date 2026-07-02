import { api } from '../api.js';
import { esc, fmtShort, toast, modal, closeModal, confirmModal, guard } from '../ui.js';

export const renderInventory = guard(async (root, ctx) => {
  ctx.setHead('Inventory', 'Reagents, samples and consumables');
  root.innerHTML = '<div class="muted">Loading…</div>';
  let items = await api.inventory();
  const q = ctx.search;
  if (q) items = items.filter(i => (i.name + ' ' + i.category + ' ' + i.location + ' ' + i.catalog_number).toLowerCase().includes(q));

  const alerts = items.filter(i => i.low || i.expired || i.expiring).length;
  root.innerHTML = `
    <div class="between" style="margin-bottom:16px">
      <div class="row"><span class="pill">${items.length} items</span>${alerts ? `<span class="pill warn">${alerts} alert${alerts !== 1 ? 's' : ''}</span>` : ''}</div>
      <button class="btn" data-new>+ Add item</button>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <table class="tbl">
        <thead><tr><th>Item</th><th>Qty</th><th>Location</th><th>Lot</th><th>Expiry</th><th>Status</th><th></th></tr></thead>
        <tbody>${items.map(rowHTML).join('') || '<tr><td colspan="7" class="muted" style="padding:20px">No items.</td></tr>'}</tbody>
      </table>
    </div>`;

  root.querySelector('[data-new]').onclick = () => itemModal(ctx, null);
  root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => itemModal(ctx, items.find(i => i.id === b.dataset.edit)));
  root.querySelectorAll('[data-adj]').forEach(b => b.onclick = () => adjustModal(ctx, items.find(i => i.id === b.dataset.adj)));
});

function rowHTML(i) {
  const cls = i.expired ? 'flag-expired' : (i.low ? 'flag-low' : '');
  const status = i.expired ? '<span class="pill danger">expired</span>'
    : i.low ? '<span class="pill warn">low</span>'
    : i.expiring ? '<span class="pill warn">expiring</span>'
    : '<span class="pill">ok</span>';
  return `<tr class="${cls}">
    <td><b>${esc(i.name)}</b><div class="muted" style="font-size:11px">${esc(i.category || '')}${i.catalog_number ? ' · ' + esc(i.catalog_number) : ''}</div></td>
    <td>${i.quantity} ${esc(i.unit || '')}<div class="muted" style="font-size:11px">reorder ≤ ${i.reorder_level}</div></td>
    <td>${esc(i.location || '—')}</td>
    <td class="mono">${esc(i.lot_number || '—')}</td>
    <td>${i.expiry_date ? fmtShort(i.expiry_date) : '—'}</td>
    <td>${status}</td>
    <td><div class="row"><button class="btn ghost sm" data-adj="${i.id}">± Stock</button><button class="btn sec sm" data-edit="${i.id}">Edit</button></div></td>
  </tr>`;
}

function field(id, label, val = '', ph = '', type = 'text') {
  return `<label class="fld">${label}</label><input class="txt" id="${id}" type="${type}" value="${esc(val)}" placeholder="${esc(ph)}"/>`;
}

function itemModal(ctx, item) {
  const it = item || {};
  modal(`<h3>${item ? 'Edit' : 'Add'} item</h3>
    ${field('iName', 'Name', it.name, 'e.g. Tris base')}
    <div class="row"><div style="flex:1">${field('iCat', 'Category', it.category, 'Buffer / Solvent / Compound')}</div>
      <div style="flex:1">${field('iCat2', 'Catalogue #', it.catalog_number, '')}</div></div>
    <div class="row"><div style="flex:1">${field('iQty', 'Quantity', it.quantity ?? '', '0', 'number')}</div>
      <div style="flex:1">${field('iUnit', 'Unit', it.unit, 'g / mL / mg')}</div>
      <div style="flex:1">${field('iReorder', 'Reorder level', it.reorder_level ?? '', '0', 'number')}</div></div>
    <div class="row"><div style="flex:1">${field('iLoc', 'Location', it.location, 'Freezer / Shelf')}</div>
      <div style="flex:1">${field('iLot', 'Lot #', it.lot_number, '')}</div>
      <div style="flex:1">${field('iExp', 'Expiry', it.expiry_date || '', '', 'date')}</div></div>
    ${field('iNotes', 'Notes', it.notes, '')}
    <div class="row" style="margin-top:16px;justify-content:space-between">
      ${item ? '<button class="btn danger sm" data-del>Delete</button>' : '<span></span>'}
      <div class="row"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Save</button></div></div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  const del = m.querySelector('[data-del]');
  if (del) del.onclick = () => confirmModal('Delete item?', 'This cannot be undone.',
    guard(async () => { await api.deleteItem(item.id); closeModal(); toast('Item deleted'); ctx.refresh(); }), 'Delete');
  m.querySelector('[data-ok]').onclick = guard(async () => {
    const body = {
      name: m.querySelector('#iName').value.trim(),
      category: m.querySelector('#iCat').value.trim(),
      catalog_number: m.querySelector('#iCat2').value.trim(),
      quantity: m.querySelector('#iQty').value, unit: m.querySelector('#iUnit').value.trim(),
      reorder_level: m.querySelector('#iReorder').value,
      location: m.querySelector('#iLoc').value.trim(), lot_number: m.querySelector('#iLot').value.trim(),
      expiry_date: m.querySelector('#iExp').value || null, notes: m.querySelector('#iNotes').value.trim()
    };
    if (!body.name) return toast('Name required', true);
    if (item) await api.updateItem(item.id, body); else await api.createItem(body);
    closeModal(); toast('Saved'); ctx.refresh();
  });
}

function adjustModal(ctx, it) {
  modal(`<h3>Adjust stock — ${esc(it.name)}</h3>
    <p class="muted" style="font-size:13px">Current: <b>${it.quantity} ${esc(it.unit || '')}</b></p>
    <label class="fld">Change (negative to consume)</label>
    <input class="txt" id="aDelta" type="number" placeholder="e.g. -5"/>
    <label class="fld">Reason (optional)</label><input class="txt" id="aReason" placeholder="e.g. used in EXP-12"/>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Apply</button></div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-ok]').onclick = guard(async () => {
    const delta = Number(m.querySelector('#aDelta').value);
    if (!Number.isFinite(delta) || delta === 0) return toast('Enter a non-zero number', true);
    await api.adjustItem(it.id, { delta, reason: m.querySelector('#aReason').value.trim() });
    closeModal(); toast('Stock updated'); ctx.refresh();
  });
  setTimeout(() => m.querySelector('#aDelta').focus(), 40);
}
