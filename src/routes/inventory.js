import { Router } from 'express';
import { Inventory, Audit } from '../db.js';
import { requireRole } from '../auth.js';
import { defaultCalendarWindow, inventoryCalendarFilename, renderInventoryCalendar } from '../calendar.js';

const r = Router();
const requireInventoryWrite = requireRole('scientist');
const inventoryNumberLabels = {
  quantity: 'Quantity',
  reorder_level: 'Reorder level'
};

/** Annotate items with computed status flags for the UI. */
function decorate(it) {
  const low = Number(it.quantity) <= Number(it.reorder_level);
  let expiring = false, expired = false;
  if (it.expiry_date) {
    const days = (new Date(it.expiry_date) - new Date()) / 86400000;
    expired = days < 0;
    expiring = days >= 0 && days <= 30;
  }
  const reservations = Inventory.reservations(it.id);
  return { ...it, low, expiring, expired, reservations, next_reservation: reservations[0] || null };
}

function validateInventoryNumbers(body) {
  for (const [field, label] of Object.entries(inventoryNumberLabels)) {
    if (body[field] == null || body[field] === '') continue;
    const value = Number(body[field]);
    if (!Number.isFinite(value)) return `${label} must be numeric`;
    if (value < 0) return `${label} cannot be negative`;
    body[field] = value;
  }
  return '';
}

r.get('/', (_req, res) => res.json(Inventory.list().map(decorate)));

r.get('/:id', (req, res) => {
  const it = Inventory.get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Item not found' });
  res.json(decorate(it));
});

r.get('/:id/availability', (req, res) => {
  const it = Inventory.get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Item not found' });
  const window = defaultCalendarWindow(req.query);
  if (window.error) return res.status(400).json({ error: window.error });
  const reservations = Inventory.reservationWindow(it.id, window.from, window.to);
  res.json({
    item: decorate(it),
    from: window.from,
    to: window.to,
    reservations,
    booked_count: reservations.length
  });
});

r.get('/:id/calendar.ics', (req, res) => {
  const it = Inventory.get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Item not found' });
  const window = defaultCalendarWindow(req.query);
  if (window.error) return res.status(400).json({ error: window.error });
  const reservations = Inventory.reservationWindow(it.id, window.from, window.to);
  sendInventoryCalendar(res, it, reservations, true);
});

r.post('/', requireInventoryWrite, (req, res) => {
  if (!req.body || !req.body.name) return res.status(400).json({ error: 'Name is required' });
  const numericError = validateInventoryNumbers(req.body);
  if (numericError) return res.status(400).json({ error: numericError });
  const it = Inventory.create(req.body);
  Audit.log(req.user.name, req.user.role, 'CREATE_INVENTORY', `"${it.name}" (${it.id})`);
  res.status(201).json(decorate(it));
});

r.patch('/:id', requireInventoryWrite, (req, res) => {
  const body = req.body || {};
  const numericError = validateInventoryNumbers(body);
  if (numericError) return res.status(400).json({ error: numericError });
  const it = Inventory.update(req.params.id, body);
  if (!it) return res.status(404).json({ error: 'Item not found' });
  Audit.log(req.user.name, req.user.role, 'EDIT_INVENTORY', `"${it.name}" (${it.id})`);
  res.json(decorate(it));
});

r.post('/:id/calendar-token', (req, res) => {
  const it = Inventory.get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Item not found' });
  const feed = Inventory.createCalendarToken(it.id, req.user);
  Audit.log(req.user.name, req.user.role, 'CREATE_INVENTORY_CALENDAR_FEED', `"${it.name}" (${it.id})`);
  const feedPath = `/api/calendar/inventory/${encodeURIComponent(feed.token)}.ics`;
  res.status(201).json({
    id: feed.id,
    item_id: it.id,
    created_at: feed.created_at,
    feed_url: absoluteUrl(req, feedPath)
  });
});

/** Consume or restock: body { delta: number, reason?: string } */
r.post('/:id/adjust', requireInventoryWrite, (req, res) => {
  const delta = Number(req.body?.delta);
  if (!Number.isFinite(delta)) return res.status(400).json({ error: 'Numeric delta required' });
  const before = Inventory.get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Item not found' });
  if (delta < 0 && Math.abs(delta) > Number(before.quantity)) {
    const available = `${before.quantity} ${before.unit || ''}`.trim();
    return res.status(409).json({ error: `Insufficient stock: ${available} available` });
  }
  const it = Inventory.adjust(req.params.id, delta);
  const verb = delta < 0 ? 'CONSUME_INVENTORY' : 'RESTOCK_INVENTORY';
  Audit.log(req.user.name, req.user.role, verb,
    `"${it.name}" ${delta > 0 ? '+' : ''}${delta} ${it.unit || ''} → ${it.quantity}${req.body?.reason ? ' — ' + req.body.reason : ''}`);
  res.json(decorate(it));
});

r.post('/:id/reservations', requireInventoryWrite, (req, res) => {
  const it = Inventory.get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Item not found' });
  const parsed = parseReservationWindow(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const overlap = Inventory.overlappingReservation(it.id, parsed.starts_at, parsed.ends_at);
  if (overlap) return res.status(409).json({ error: 'Resource already reserved for that time' });
  const reservation = Inventory.createReservation(it.id, req.user, parsed);
  Audit.log(req.user.name, req.user.role, 'RESERVE_INVENTORY',
    `"${it.name}" ${reservation.starts_at} → ${reservation.ends_at}${reservation.purpose ? ' — ' + reservation.purpose : ''}`);
  res.status(201).json(reservation);
});

r.delete('/:id/reservations/:reservationId', requireInventoryWrite, (req, res) => {
  const it = Inventory.get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Item not found' });
  const reservation = Inventory.getReservation(it.id, req.params.reservationId);
  if (!reservation || reservation.cancelled_at) return res.status(404).json({ error: 'Reservation not found' });
  if (req.user.role !== 'admin' && reservation.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the reserver or an admin can cancel this reservation' });
  }
  const cancelled = Inventory.cancelReservation(it.id, reservation.id);
  Audit.log(req.user.name, req.user.role, 'CANCEL_INVENTORY_RESERVATION',
    `"${it.name}" ${reservation.starts_at} → ${reservation.ends_at}${reservation.purpose ? ' — ' + reservation.purpose : ''}`);
  res.json({ ok: true, reservation: cancelled });
});

r.delete('/:id', requireInventoryWrite, (req, res) => {
  const it = Inventory.get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Item not found' });
  Inventory.remove(req.params.id);
  Audit.log(req.user.name, req.user.role, 'DELETE_INVENTORY', `"${it.name}" (${it.id})`);
  res.json({ ok: true });
});

export default r;

function parseReservationWindow(body) {
  const starts = parseReservationDate(body.starts_at, 'Start time');
  if (starts.error) return starts;
  const ends = parseReservationDate(body.ends_at, 'End time');
  if (ends.error) return ends;
  if (new Date(ends.value) <= new Date(starts.value)) return { error: 'End time must be after start time' };
  const purpose = String(body.purpose || '').trim().slice(0, 240);
  if (!purpose) return { error: 'Purpose is required' };
  return { starts_at: starts.value, ends_at: ends.value, purpose };
}

function parseReservationDate(value, label) {
  if (!value) return { error: `${label} is required` };
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return { error: `${label} is invalid` };
  return { value: d.toISOString() };
}

function sendInventoryCalendar(res, item, reservations, download = false) {
  const body = renderInventoryCalendar({ item, reservations });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (download) {
    res.setHeader('Content-Disposition', `attachment; filename="${inventoryCalendarFilename(item)}"`);
  }
  res.send(body);
}

function absoluteUrl(req, pathname) {
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return new URL(pathname, base.endsWith('/') ? base : `${base}/`).toString();
}
