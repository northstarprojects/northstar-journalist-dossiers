import { Router, Request, Response } from 'express';
import db from '../db';

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

router.get('/journalists', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM journalists ORDER BY totalScore DESC').all();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="journalists.csv"');
  res.send(toCSV(rows));
});

router.get('/articles', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM articles ORDER BY publishDate DESC').all();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="articles.csv"');
  res.send(toCSV(rows));
});

router.get('/outreach', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM outreach_logs ORDER BY date DESC').all();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="outreach_logs.csv"');
  res.send(toCSV(rows));
});

export default router;
