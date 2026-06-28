import { Router } from 'express';
import pool from '../db';

const router = Router();

// GET /api/campaign-styles
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query('SELECT type, instructions, "updatedAt" FROM campaign_type_styles');
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/campaign-styles/:type
router.put('/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const valid = ['cold_intro', 'event', 'hackathon', 'founder_promo'];
    if (!valid.includes(type)) return res.status(400).json({ error: 'Invalid campaign type' });

    const { instructions } = req.body;
    if (typeof instructions !== 'string') return res.status(400).json({ error: 'instructions must be a string' });

    await pool.query(
      'UPDATE campaign_type_styles SET instructions = $1, "updatedAt" = NOW() WHERE type = $2',
      [instructions.trim(), type]
    );
    res.json({ type, instructions: instructions.trim() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
