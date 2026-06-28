import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

router.get('/journalist/:journalistId', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM articles WHERE "journalistId" = $1 ORDER BY "publishDate" DESC',
      [req.params.journalistId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const result = await pool.query(`
      INSERT INTO articles ("journalistId", title, url, publication, "publishDate", topic, "storyType", summary, "relevanceToNorthStar", "usefulAngle")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
    `, [b.journalistId, b.title, b.url, b.publication, b.publishDate, b.topic, b.storyType, b.summary, b.relevanceToNorthStar, b.usefulAngle]);
    const created = (await pool.query('SELECT * FROM articles WHERE id = $1', [result.rows[0].id])).rows[0];
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    await pool.query(`
      UPDATE articles SET title=$1, url=$2, publication=$3, "publishDate"=$4,
      topic=$5, "storyType"=$6, summary=$7, "relevanceToNorthStar"=$8,
      "usefulAngle"=$9, "updatedAt"=NOW() WHERE id=$10
    `, [b.title, b.url, b.publication, b.publishDate, b.topic, b.storyType, b.summary, b.relevanceToNorthStar, b.usefulAngle, req.params.id]);
    const updated = (await pool.query('SELECT * FROM articles WHERE id = $1', [req.params.id])).rows[0];
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM articles WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
