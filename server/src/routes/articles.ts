import { Router, Request, Response } from 'express';
import db from '../db';

const router = Router();

router.get('/journalist/:journalistId', (req: Request, res: Response) => {
  res.json(db.prepare('SELECT * FROM articles WHERE journalistId = ? ORDER BY publishDate DESC').all(req.params.journalistId));
});

router.post('/', (req: Request, res: Response) => {
  const b = req.body;
  const result = db.prepare(`
    INSERT INTO articles (journalistId, title, url, publication, publishDate, topic, storyType, summary, relevanceToNorthStar, usefulAngle)
    VALUES (@journalistId, @title, @url, @publication, @publishDate, @topic, @storyType, @summary, @relevanceToNorthStar, @usefulAngle)
  `).run(b);
  res.status(201).json(db.prepare('SELECT * FROM articles WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req: Request, res: Response) => {
  const b = req.body;
  db.prepare(`
    UPDATE articles SET title=@title, url=@url, publication=@publication, publishDate=@publishDate,
    topic=@topic, storyType=@storyType, summary=@summary, relevanceToNorthStar=@relevanceToNorthStar,
    usefulAngle=@usefulAngle, updatedAt=datetime('now') WHERE id=@id
  `).run({ ...b, id: req.params.id });
  res.json(db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM articles WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
