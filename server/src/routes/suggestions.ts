import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// GET all pending suggestions
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = (await pool.query(
      "SELECT * FROM publication_suggestions WHERE status = 'pending' ORDER BY \"createdAt\" DESC"
    )).rows;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET count of pending suggestions
router.get('/count', async (_req: Request, res: Response) => {
  try {
    const result = (await pool.query(
      "SELECT COUNT(*)::int as c FROM publication_suggestions WHERE status = 'pending'"
    )).rows[0];
    res.json({ count: result.c });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST accept
router.post('/:id/accept', async (req: Request, res: Response) => {
  try {
    const suggestion = (await pool.query(
      'SELECT * FROM publication_suggestions WHERE id = $1', [req.params.id]
    )).rows[0];
    if (!suggestion) return res.status(404).json({ error: 'Not found' });

    const existing = (await pool.query(
      'SELECT id FROM publications WHERE LOWER(name) = LOWER($1)', [suggestion.name]
    )).rows[0];
    if (existing) {
      await pool.query("UPDATE publication_suggestions SET status='accepted' WHERE id=$1", [req.params.id]);
      return res.json({ success: true, message: 'Already exists — marked as accepted' });
    }

    await pool.query(
      'INSERT INTO publications (name, url, tier, focus, notes, active) VALUES ($1,$2,$3,$4,$5,1)',
      [suggestion.name, suggestion.url || '', suggestion.tier || 'B', suggestion.focus || '', suggestion.reason || '']
    );
    await pool.query("UPDATE publication_suggestions SET status='accepted' WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST reject
router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const suggestion = (await pool.query(
      'SELECT * FROM publication_suggestions WHERE id = $1', [req.params.id]
    )).rows[0];
    if (!suggestion) return res.status(404).json({ error: 'Not found' });
    await pool.query("UPDATE publication_suggestions SET status='rejected' WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET history
router.get('/history', async (_req: Request, res: Response) => {
  try {
    const rows = (await pool.query(
      "SELECT * FROM publication_suggestions WHERE status != 'pending' ORDER BY \"createdAt\" DESC LIMIT 50"
    )).rows;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
