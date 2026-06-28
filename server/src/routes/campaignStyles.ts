import { Router } from 'express';
import db from '../db';

const router = Router();

// GET /api/campaign-styles — all four rows
router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT type, instructions, updatedAt FROM campaign_type_styles').all();
  res.json(rows);
});

// PUT /api/campaign-styles/:type — save instructions for one type
router.put('/:type', (req, res) => {
  const { type } = req.params;
  const valid = ['cold_intro', 'event', 'hackathon', 'founder_promo'];
  if (!valid.includes(type)) return res.status(400).json({ error: 'Invalid campaign type' });

  const { instructions } = req.body;
  if (typeof instructions !== 'string') return res.status(400).json({ error: 'instructions must be a string' });

  db.prepare(`
    UPDATE campaign_type_styles
    SET instructions = ?, updatedAt = datetime('now')
    WHERE type = ?
  `).run(instructions.trim(), type);

  res.json({ type, instructions: instructions.trim() });
});

export default router;
