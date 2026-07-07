import { Router } from 'express';
import { Inventory } from '../db.js';
import { defaultCalendarWindow, renderInventoryCalendar } from '../calendar.js';

const r = Router();

r.get('/inventory/:token.ics', (req, res) => {
  const feed = Inventory.getCalendarToken(req.params.token);
  if (!feed) return res.status(404).json({ error: 'Calendar feed not found' });
  const item = Inventory.get(feed.item_id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const window = defaultCalendarWindow(req.query);
  if (window.error) return res.status(400).json({ error: window.error });
  const reservations = Inventory.reservationWindow(item.id, window.from, window.to);
  const body = renderInventoryCalendar({ item, reservations });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(body);
});

export default r;
