import { api } from '../api.js';
import { esc, fmt, fmtShort, toast, modal, closeModal, confirmModal, guard } from '../ui.js';
import { getUser } from '../state.js';

export const renderInventory = guard(async (root, ctx) => {
  ctx.setHead('Inventory', 'Reagents, samples and consumables');
  root.innerHTML = '<div class="muted">Loading…</div>';
  let items = await api.inventory();
  const q = ctx.search;
  if (q) items = items.filter(i => (i.name + ' ' + i.category + ' ' + i.location + ' ' + i.catalog_number).toLowerCase().includes(q));

  const canWrite = canWriteInventory();
  const alerts = items.filter(i => i.low || i.expired || i.expiring).length;
  root.innerHTML = `
    <div class="between" style="margin-bottom:16px">
      <div class="row"><span class="pill">${items.length} items</span>${alerts ? `<span class="pill warn">${alerts} alert${alerts !== 1 ? 's' : ''}</span>` : ''}</div>
      ${canWrite
        ? '<button class="btn" data-new>+ Add item</button>'
        : '<button class="btn" data-new-disabled disabled title="Inventory edits require scientist access">+ Add item</button>'}
    </div>
    ${!canWrite ? '<div class="hint">Read-only account role — inventory edits require scientist access.</div>' : ''}
    <div class="card inventory-table-card" style="padding:0;overflow:auto">
      <table class="tbl">
        <thead><tr><th>Item</th><th>Qty</th><th>Location</th><th>Lot</th><th>Expiry</th><th>Next booking</th><th>Status</th><th></th></tr></thead>
        <tbody>${items.map(i => rowHTML(i, canWrite)).join('') || '<tr><td colspan="8" class="muted" style="padding:20px">No items.</td></tr>'}</tbody>
      </table>
    </div>
    <div class="inventory-mobile-list">
      ${items.map(i => inventoryMobileCardHTML(i, canWrite)).join('') || '<div class="empty">No items.</div>'}
    </div>`;

  if (canWrite) {
    root.querySelector('[data-new]').onclick = () => itemModal(ctx, null);
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => itemModal(ctx, items.find(i => i.id === b.dataset.edit)));
    root.querySelectorAll('[data-adj]').forEach(b => b.onclick = () => adjustModal(ctx, items.find(i => i.id === b.dataset.adj)));
    root.querySelectorAll('[data-reserve]').forEach(b => b.onclick = () => reserveModal(ctx, items.find(i => i.id === b.dataset.reserve)));
    root.querySelectorAll('[data-cancel-reservation]').forEach(b => b.onclick = () => cancelReservation(ctx, b.dataset.reservationItem, b.dataset.cancelReservation));
  }
  root.querySelectorAll('[data-calendar]').forEach(b => b.onclick = () => calendarModal(ctx, items.find(i => i.id === b.dataset.calendar)));
});

function canWriteInventory(user = getUser()) {
  return ['user', 'scientist', 'reviewer', 'admin'].includes(user?.role);
}

function rowHTML(i, canWrite = true) {
  const cls = i.expired ? 'flag-expired' : (i.low ? 'flag-low' : '');
  return `<tr class="${cls}">
    <td><b>${esc(i.name)}</b><div class="muted" style="font-size:11px">${esc(i.category || '')}${i.catalog_number ? ' · ' + esc(i.catalog_number) : ''}</div></td>
    <td>${i.quantity} ${esc(i.unit || '')}<div class="muted" style="font-size:11px">reorder ≤ ${i.reorder_level}</div></td>
    <td>${esc(i.location || '—')}</td>
    <td class="mono">${esc(i.lot_number || '—')}</td>
    <td>${i.expiry_date ? fmtShort(i.expiry_date) : '—'}</td>
    <td>${inventoryReservationHTML(i, canWrite)}</td>
    <td>${inventoryStatusHTML(i)}</td>
    <td><div class="row">${inventoryActionsHTML(i, canWrite)}</div></td>
  </tr>`;
}

function inventoryMobileCardHTML(i, canWrite = true) {
  const cls = i.expired ? ' flag-expired' : (i.low ? ' flag-low' : '');
  const meta = [i.category, i.catalog_number].filter(Boolean).map(esc).join(' · ');
  return `<div class="inventory-mobile-card${cls}" data-inventory-mobile-card="${i.id}">
    <div class="inventory-mobile-head">
      <div>
        <b>${esc(i.name)}</b>
        ${meta ? `<div class="muted">${meta}</div>` : ''}
      </div>
      ${inventoryStatusHTML(i)}
    </div>
    <div class="inventory-mobile-facts">
      <div><span>Qty</span><b>${i.quantity} ${esc(i.unit || '')}</b><small>reorder ≤ ${i.reorder_level}</small></div>
      <div><span>Location</span><b>${esc(i.location || '—')}</b></div>
      <div><span>Lot</span><b class="mono">${esc(i.lot_number || '—')}</b></div>
      <div><span>Expiry</span><b>${i.expiry_date ? fmtShort(i.expiry_date) : '—'}</b></div>
      <div><span>Next booking</span>${inventoryReservationHTML(i, canWrite)}</div>
    </div>
    <div class="inventory-mobile-actions">${inventoryActionsHTML(i, canWrite)}</div>
  </div>`;
}

function inventoryReservationHTML(i, canWrite = true) {
  const r = i.next_reservation;
  if (!r) return '<span class="muted">No bookings</span>';
  const user = getUser();
  const canCancel = canWrite && (user?.role === 'admin' || r.user_id === user?.id);
  return `<div class="inventory-reservation">
    <b>${esc(reservationWindowLabel(r))}</b>
    <div class="muted" style="font-size:11px">Reserved by ${esc(r.reserved_by || 'Unknown')}${r.purpose ? ' · ' + esc(r.purpose) : ''}</div>
    ${canCancel ? `<button class="btn ghost sm" data-reservation-item="${i.id}" data-cancel-reservation="${r.id}">Cancel booking</button>` : ''}
  </div>`;
}

function inventoryStatusHTML(i) {
  return i.expired ? '<span class="pill danger">expired</span>'
    : i.low ? '<span class="pill warn">low</span>'
    : i.expiring ? '<span class="pill warn">expiring</span>'
    : '<span class="pill">ok</span>';
}

function inventoryActionsHTML(i, canWrite = true) {
  return canWrite
    ? `<button class="btn ghost sm" data-adj="${i.id}">± Stock</button><button class="btn sec sm" data-reserve="${i.id}">Reserve</button><button class="btn sec sm" data-calendar="${i.id}">Calendar</button><button class="btn sec sm" data-edit="${i.id}">Edit</button>`
    : `<button class="btn ghost sm" disabled title="Inventory edits require scientist access">± Stock</button><button class="btn sec sm" disabled title="Resource booking requires scientist access">Reserve</button><button class="btn sec sm" data-calendar="${i.id}">Calendar</button><button class="btn sec sm" disabled title="Inventory edits require scientist access">Edit</button>`;
}

function field(id, label, val = '', ph = '', type = 'text') {
  const numberAttrs = type === 'number' ? ' min="0" step="any"' : '';
  return `<label class="fld">${label}</label><input class="txt" id="${id}" type="${type}" value="${esc(val)}" placeholder="${esc(ph)}"${numberAttrs}/>`;
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
    <div class="auth-err" id="iErr"></div>
    <div class="row" style="margin-top:16px;justify-content:space-between">
      ${item ? '<button class="btn danger sm" data-del>Delete</button>' : '<span></span>'}
      <div class="row"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Save</button></div></div>`);
  const m = document.getElementById('modal');
  const qtyEl = m.querySelector('#iQty');
  const reorderEl = m.querySelector('#iReorder');
  const errEl = m.querySelector('#iErr');
  const updateError = () => { errEl.textContent = inventoryFieldMessage(qtyEl.value, reorderEl.value); };
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
    const msg = inventoryFieldMessage(body.quantity, body.reorder_level);
    if (msg) { errEl.textContent = msg; return; }
    if (item) await api.updateItem(item.id, body); else await api.createItem(body);
    closeModal(); toast('Saved'); ctx.refresh();
  });
  qtyEl.oninput = updateError;
  reorderEl.oninput = updateError;
}

function adjustModal(ctx, it) {
  modal(`<h3>Adjust stock — ${esc(it.name)}</h3>
    <p class="muted" style="font-size:13px">Current: <b>${it.quantity} ${esc(it.unit || '')}</b></p>
    <label class="fld">Change (negative to consume)</label>
    <input class="txt" id="aDelta" type="number" placeholder="e.g. -5"/>
    <div class="auth-err" id="aErr"></div>
    <label class="fld">Reason (optional)</label><input class="txt" id="aReason" placeholder="e.g. used in EXP-12"/>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Apply</button></div>`);
  const m = document.getElementById('modal');
  const deltaEl = m.querySelector('#aDelta');
  const errEl = m.querySelector('#aErr');
  const updateError = () => { errEl.textContent = stockDeltaMessage(it, Number(deltaEl.value)); };
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-ok]').onclick = guard(async () => {
    const delta = Number(deltaEl.value);
    if (!Number.isFinite(delta) || delta === 0) return toast('Enter a non-zero number', true);
    const msg = stockDeltaMessage(it, delta);
    if (msg) { errEl.textContent = msg; return; }
    await api.adjustItem(it.id, { delta, reason: m.querySelector('#aReason').value.trim() });
    closeModal(); toast('Stock updated'); ctx.refresh();
  });
  deltaEl.oninput = updateError;
  setTimeout(() => deltaEl.focus(), 40);
}

function reserveModal(ctx, it) {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  modal(`<h3>Reserve resource — ${esc(it.name)}</h3>
    <p class="muted" style="font-size:13px">Book shared equipment, rooms, instruments, or scarce resources so the lab can see who is using them next.</p>
    ${reservationListHTML(it)}
    <div class="row"><div style="flex:1">${field('rStart', 'Start', datetimeLocalValue(start), '', 'datetime-local')}</div>
      <div style="flex:1">${field('rEnd', 'End', datetimeLocalValue(end), '', 'datetime-local')}</div></div>
    <label class="fld">Purpose</label><input class="txt" id="rPurpose" placeholder="e.g. D4 endpoint imaging"/>
    <div class="auth-err" id="rErr"></div>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Reserve resource</button></div>`);
  const m = document.getElementById('modal');
  const startEl = m.querySelector('#rStart');
  const endEl = m.querySelector('#rEnd');
  const purposeEl = m.querySelector('#rPurpose');
  const errEl = m.querySelector('#rErr');
  const updateError = () => { errEl.textContent = reservationFieldMessage(startEl.value, endEl.value, purposeEl.value); };
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-ok]').onclick = guard(async () => {
    const msg = reservationFieldMessage(startEl.value, endEl.value, purposeEl.value);
    if (msg) { errEl.textContent = msg; return; }
    await api.reserveItem(it.id, {
      starts_at: new Date(startEl.value).toISOString(),
      ends_at: new Date(endEl.value).toISOString(),
      purpose: purposeEl.value.trim()
    });
    closeModal(); toast('Resource reserved'); ctx.refresh();
  });
  startEl.oninput = updateError;
  endEl.oninput = updateError;
  purposeEl.oninput = updateError;
  setTimeout(() => purposeEl.focus(), 40);
}

function reservationListHTML(it) {
  const reservations = it.reservations || [];
  if (!reservations.length) return '<div class="hint">No upcoming bookings for this resource.</div>';
  return `<div class="hint"><b>Upcoming bookings</b>
    ${reservations.slice(0, 4).map(r => `<div>${esc(reservationWindowLabel(r))} · ${esc(r.reserved_by || 'Unknown')}${r.purpose ? ' · ' + esc(r.purpose) : ''}</div>`).join('')}
  </div>`;
}

function cancelReservation(ctx, itemId, reservationId) {
  confirmModal('Cancel booking?', 'This removes the upcoming resource reservation from the shared schedule.',
    guard(async () => { await api.cancelItemReservation(itemId, reservationId); toast('Booking cancelled'); ctx.refresh(); }), 'Cancel booking');
}

function calendarModal(_ctx, it) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 86400000);
  modal(`<h3>Equipment calendar — ${esc(it.name)}</h3>
    <p class="muted" style="font-size:13px">Check availability for this resource, export bookings as calendar items, or subscribe from your own calendar app.</p>
    <div class="equipment-calendar">
      <div class="row equipment-calendar-controls">
        <div style="flex:1">${field('cFrom', 'From', dateInputValue(start), '', 'date')}</div>
        <div style="flex:1">${field('cTo', 'To', dateInputValue(end), '', 'date')}</div>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:10px">
        <button class="btn sec" data-refresh-cal>Show availability</button>
        <a class="btn ghost" id="cExport" href="/api/inventory/${encodeURIComponent(it.id)}/calendar.ics" download>Export .ics</a>
      </div>
      <div id="cAvailability" class="equipment-calendar-list"><div class="muted">Loading availability…</div></div>
      <div class="calendar-subscribe">
        <label class="fld">Subscribe URL</label>
        <div class="row">
          <input class="txt mono" id="cFeed" readonly placeholder="Create a sync link for Apple Calendar, Google Calendar, Outlook, or ICS-compatible tools"/>
          <button class="btn sec" data-cal-token>Create sync link</button>
          <button class="btn ghost" data-cal-copy disabled>Copy subscribe URL</button>
        </div>
        <div class="muted" style="font-size:12px;margin-top:6px">Calendar apps can import the exported file once, or subscribe to this URL for future booking updates.</div>
      </div>
      <div class="auth-err" id="cErr"></div>
    </div>
    <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn ghost" data-x>Close</button></div>`);
  const m = document.getElementById('modal');
  const fromEl = m.querySelector('#cFrom');
  const toEl = m.querySelector('#cTo');
  const listEl = m.querySelector('#cAvailability');
  const errEl = m.querySelector('#cErr');
  const exportEl = m.querySelector('#cExport');
  const feedEl = m.querySelector('#cFeed');
  const copyBtn = m.querySelector('[data-cal-copy]');
  const load = guard(async () => {
    errEl.textContent = '';
    const window = calendarWindowFromInputs(fromEl.value, toEl.value);
    if (window.error) { errEl.textContent = window.error; return; }
    exportEl.href = `/api/inventory/${encodeURIComponent(it.id)}/calendar.ics?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`;
    listEl.innerHTML = '<div class="muted">Loading availability…</div>';
    const availability = await api.inventoryAvailability(it.id, { from: window.from, to: window.to });
    listEl.innerHTML = calendarAvailabilityHTML(availability.reservations || []);
  });
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-refresh-cal]').onclick = load;
  m.querySelector('[data-cal-token]').onclick = guard(async () => {
    const feed = await api.inventoryCalendarToken(it.id);
    feedEl.value = feed.feed_url || '';
    copyBtn.disabled = !feedEl.value;
    toast('Calendar sync link created');
  });
  copyBtn.onclick = () => copySubscribeUrl(feedEl);
  fromEl.onchange = load;
  toEl.onchange = load;
  load();
}

function calendarAvailabilityHTML(reservations) {
  if (!reservations.length) return '<div class="hint">Available in this date range. No bookings found.</div>';
  return reservations.map(r => `<div class="equipment-calendar-slot">
    <div><b>${esc(reservationWindowLabel(r))}</b><span class="pill warn">booked</span></div>
    <div class="muted">Reserved by ${esc(r.reserved_by || 'Unknown')}${r.purpose ? ' · ' + esc(r.purpose) : ''}</div>
  </div>`).join('');
}

function copySubscribeUrl(input) {
  if (!input.value) return toast('Create a sync link first', true);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(input.value).then(() => toast('Subscribe URL copied')).catch(() => fallbackCopy(input));
  } else {
    fallbackCopy(input);
  }
}

function fallbackCopy(input) {
  input.focus();
  input.select();
  try { document.execCommand('copy'); toast('Subscribe URL copied'); }
  catch { toast('Copy failed — select the URL manually', true); }
}

function stockDeltaMessage(it, delta) {
  if (!Number.isFinite(delta) || delta >= 0) return '';
  if (delta < 0 && Math.abs(delta) > Number(it.quantity)) {
    return `Insufficient stock: ${it.quantity} ${it.unit || ''} available`;
  }
  return '';
}

function inventoryFieldMessage(quantity, reorderLevel) {
  const qty = quantity === '' ? 0 : Number(quantity);
  const reorder = reorderLevel === '' ? 0 : Number(reorderLevel);
  if (!Number.isFinite(qty)) return 'Quantity must be numeric';
  if (qty < 0) return 'Quantity cannot be negative';
  if (!Number.isFinite(reorder)) return 'Reorder level must be numeric';
  if (reorder < 0) return 'Reorder level cannot be negative';
  return '';
}

function reservationFieldMessage(startsAt, endsAt, purpose) {
  if (!startsAt) return 'Start time is required';
  if (!endsAt) return 'End time is required';
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (!Number.isFinite(start.getTime())) return 'Start time is invalid';
  if (!Number.isFinite(end.getTime())) return 'End time is invalid';
  if (end <= start) return 'End time must be after start time';
  if (!String(purpose || '').trim()) return 'Purpose is required';
  return '';
}

function datetimeLocalValue(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function reservationWindowLabel(r) {
  return `${fmt(r.starts_at)} → ${fmt(r.ends_at)}`;
}

function dateInputValue(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function calendarWindowFromInputs(fromValue, toValue) {
  const from = localDateStart(fromValue);
  const toStart = localDateStart(toValue);
  if (!from) return { error: 'From date is required' };
  if (!toStart) return { error: 'To date is required' };
  const to = new Date(toStart.getTime() + 86400000);
  if (to <= from) return { error: 'To date must be after from date' };
  return { from: from.toISOString(), to: to.toISOString() };
}

function localDateStart(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isFinite(d.getTime()) ? d : null;
}
