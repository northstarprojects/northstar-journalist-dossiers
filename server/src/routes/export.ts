import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

function toCSV(rows: any[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => {
      const v = row[h] ?? '';
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(','));
  }
  return lines.join('\n');
}

router.get('/journalists', async (_req: Request, res: Response) => {
  try {
    const rows = (await pool.query('SELECT * FROM journalists ORDER BY "totalScore" DESC')).rows;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="journalists.csv"');
    res.send(toCSV(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/articles', async (_req: Request, res: Response) => {
  try {
    const rows = (await pool.query('SELECT * FROM articles ORDER BY "publishDate" DESC')).rows;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="articles.csv"');
    res.send(toCSV(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/outreach', async (_req: Request, res: Response) => {
  try {
    const rows = (await pool.query('SELECT * FROM outreach_logs ORDER BY date DESC')).rows;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="outreach_logs.csv"');
    res.send(toCSV(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
