import { Router, Request, Response } from 'express';
import db from '../db';

const router = Router();

// GET all pending suggestions
router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT * FROM publication_suggestions WHERE status = 'pending' ORDER BY createdAt DESC
  `).all();
  res.json(rows);
});

// GET count of pending suggestions (for badge)
router.get('/count', (_req: Request, res: Response) => {
  const result = db.prepare(`SELECT COUNT(*) as c FROM publication_suggestions WHERE status = 'pending'`).get() as any;
  res.json({ count: result.c });
});

// POST accept — moves suggestion into publications table
router.post('/:id/accept', (req: Request, res: Response) => {
  const suggestion = db.prepare('SELECT * FROM publication_suggestions WHERE id = ?').get(req.params.id) as any;
  if (!suggestion) return res.status(404).json({ error: 'Not found' });

  // Check for duplicate
  const existing = db.prepare('SELECT id FROM publications WHERE LOWER(name) = LOWER(?)').get(suggestion.name);
  if (existing) {
    db.prepare("UPDATE publication_suggestions SET status='accepted' WHERE id=?").run(req.params.id);
    return res.json({ success: true, message: 'Already exists — marked as accepted' });
  }

  db.prepare(`
    INSERT INTO publications (name, url, tier, focus, notes, active)
    VALUES (@name, @url, @tier, @focus, @notes, 1)
  `).run({ name: suggestion.name, url: suggestion.url || '', tier: suggestion.tier || 'B', focus: suggestion.focus || '', notes: suggestion.reason || '' });

  db.prepare("UPDATE publication_suggestions SET status='accepted' WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

// POST reject — archives the suggestion
router.post('/:id/reject', (req: Request, res: Response) => {
  const suggestion = db.prepare('SELECT * FROM publication_suggestions WHERE id = ?').get(req.params.id);
  if (!suggestion) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE publication_suggestions SET status='rejected' WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

// GET history (accepted + rejected)
router.get('/history', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT * FROM publication_suggestions WHERE status != 'pending' ORDER BY createdAt DESC LIMIT 50
  `).all();
  res.json(rows);
});

export default router;
