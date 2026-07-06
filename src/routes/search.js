import { Router } from 'express';
import { Search } from '../db.js';

const r = Router();

r.get('/', (req, res) => {
  res.json(Search.smart(req.user, req.query.q || req.query.query || ''));
});

export default r;
