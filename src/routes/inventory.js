import { Router } from 'express';
import { Inventory, Audit } from '../db.js';

const r = Router();

/** Annotate items with computed status flags for the UI. */
function decorate(it) {
  const low = Number(it.quantity) <= Number(it.reorder_level);
  let expiring = false, expired = false;
  if (it.expiry_date) {
    const days = (new Date(it.expiry_date) - new Date()) / 86400000;
    expired = days < 0;
    expiring = days >= 0 && days <= 30;
  }
  return { ...it, low, expiring, expired };
}

r.get('/', (_req, res) => res.json(Inventory.list().map(decorate)));

r.get('/:id', (req, res) => {
  const it = Inventory.get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Item not found' });
  res.json(decorate(it));
});

r.post('/', (req, res) => {
  if (!req.body || !req.body.name) return res.status(400).json({ error: 'Name is required' });
  const it = Inventory.create(req.body);
  Audit.log(req.user.name, req.user.role, 'CREATE_INVENTORY', `"${it.name}" (${it.id})`);
  res.status(201).json(decorate(it));
});

r.patch('/:id', (req, res) => {
  const it = Inventory.update(req.params.id, req.body);
  if (!it) return res.status(404).json({ error: 'Item not found' });
  Audit.log(req.user.name, req.user.role, 'EDIT_INVENTORY', `"${it.name}" (${it.id})`);
  res.json(decorate(it));
});

/** Consume or restock: body { delta: number, reason?: string } */
r.post('/:id/adjust', (req, res) => {
  const delta = Number(req.body?.delta);
  if (!Number.isFinite(delta)) return res.status(400).json({ error: 'Numeric delta required' });
  const before = Inventory.get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Item not found' });
  const it = Inventory.adjust(req.params.id, delta);
  const verb = delta < 0 ? 'CONSUME_INVENTORY' : 'RESTOCK_INVENTORY';
  Audit.log(req.user.name, req.user.role, verb,
    `"${it.name}" ${delta > 0 ? '+' : ''}${delta} ${it.unit || ''} → ${it.quantity}${req.body?.reason ? ' — ' + req.body.reason : ''}`);
  res.json(decorate(it));
});

r.delete('/:id', (req, res) => {
  const it = Inventory.get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Item not found' });
  Inventory.remove(req.params.id);
  Audit.log(req.user.name, req.user.role, 'DELETE_INVENTORY', `"${it.name}" (${it.id})`);
  res.json({ ok: true });
});

export default r;
