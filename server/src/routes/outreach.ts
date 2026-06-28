import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

const LOG_PRIORITY: Record<string, number> = {
  'Not a Fit': 8, 'Declined': 8, 'Covered': 7, 'Meeting Scheduled': 6,
  'Responded': 5, 'Sent': 3, 'No Response': 3, 'Draft': 0,
};
const LOG_TO_JOURNALIST_STATUS: Record<string, string> = {
  'Not a Fit': 'Not a Fit', 'Declined': 'Not a Fit', 'Covered': 'Covered',
  'Meeting Scheduled': 'In Conversation', 'Responded': 'Responded',
  'Sent': 'Pitched', 'No Response': 'Pitched',
};

async function syncJournalistStatus(journalistId: number): Promise<void> {
  const logs = (await pool.query(
    'SELECT * FROM outreach_logs WHERE "journalistId" = $1 ORDER BY date DESC, "createdAt" DESC',
    [journalistId]
  )).rows;

  if (logs.length === 0) {
    await pool.query(
      "UPDATE journalists SET \"outreachStatus\" = 'Researching', \"lastContactedDate\" = '', \"updatedAt\" = NOW() WHERE id = $1",
      [journalistId]
    );
    return;
  }

  let bestStatus = '';
  let bestPriority = -1;
  for (const log of logs) {
    const p = LOG_PRIORITY[log.status] ?? 0;
    if (p > bestPriority) { bestPriority = p; bestStatus = log.status; }
  }
  if (bestPriority <= 0) return;

  const newOutreachStatus = LOG_TO_JOURNALIST_STATUS[bestStatus];
  if (!newOutreachStatus) return;

  const lastSent = logs.find(l => l.status !== 'Draft' && l.date);
  const lastContactedDate = lastSent?.date || '';

  let followUpDate = '';
  if (newOutreachStatus === 'Pitched' && lastContactedDate) {
    const followUp = new Date(lastContactedDate);
    followUp.setDate(followUp.getDate() + 7);
    followUpDate = followUp.toISOString().split('T')[0];
  }

  await pool.query(`
    UPDATE journalists SET
      "outreachStatus" = $1,
      "lastContactedDate" = CASE WHEN $2 != '' THEN $2 ELSE "lastContactedDate" END,
      "nextFollowUpDate" = CASE WHEN $3 != '' AND ("nextFollowUpDate" IS NULL OR "nextFollowUpDate" = '') THEN $3 ELSE "nextFollowUpDate" END,
      "updatedAt" = NOW()
    WHERE id = $4
  `, [newOutreachStatus, lastContactedDate, followUpDate, journalistId]);

  console.log(`[OutreachSync] Journalist ${journalistId} → ${newOutreachStatus}`);
}

// GET /activity — full activity feed
router.get('/activity', async (req: Request, res: Response) => {
  try {
    const { publication, status, from, to, limit = '200' } = req.query as Record<string, string>;
    let where = '1=1';
    const params: any[] = [];
    let n = 1;

    if (publication) { where += ` AND j.publication = $${n++}`; params.push(publication); }
    if (status)      { where += ` AND ol.status = $${n++}`;      params.push(status); }
    if (from)        { where += ` AND ol.date >= $${n++}`;        params.push(from); }
    if (to)          { where += ` AND ol.date <= $${n++}`;        params.push(to); }

    const rows = (await pool.query(`
      SELECT ol.*, j.name AS "journalistName", j.publication AS publication,
             j."outreachStatus" AS "journalistStatus"
      FROM outreach_logs ol
      JOIN journalists j ON j.id = ol."journalistId"
      WHERE ${where}
      ORDER BY ol.date DESC, ol."createdAt" DESC
      LIMIT $${n}
    `, [...params, Number(limit)])).rows;

    const publications = (await pool.query(`
      SELECT DISTINCT j.publication
      FROM outreach_logs ol
      JOIN journalists j ON j.id = ol."journalistId"
      ORDER BY j.publication
    `)).rows.map((r: any) => r.publication);

    res.json({ logs: rows, publications });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/journalist/:journalistId', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM outreach_logs WHERE "journalistId" = $1 ORDER BY date DESC, "createdAt" DESC',
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
      INSERT INTO outreach_logs ("journalistId", date, channel, "messageType", "subjectLine", "messageBody", response, status, "nextStep")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
    `, [b.journalistId, b.date, b.channel, b.messageType, b.subjectLine, b.messageBody, b.response, b.status, b.nextStep]);
    const created = (await pool.query('SELECT * FROM outreach_logs WHERE id = $1', [result.rows[0].id])).rows[0];
    await syncJournalistStatus(Number(b.journalistId));
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    await pool.query(`
      UPDATE outreach_logs SET date=$1, channel=$2, "messageType"=$3,
      "subjectLine"=$4, "messageBody"=$5, response=$6,
      status=$7, "nextStep"=$8, "updatedAt"=NOW() WHERE id=$9
    `, [b.date, b.channel, b.messageType, b.subjectLine, b.messageBody, b.response, b.status, b.nextStep, req.params.id]);
    const updated = (await pool.query('SELECT * FROM outreach_logs WHERE id = $1', [req.params.id])).rows[0];
    if (updated) await syncJournalistStatus(Number(updated.journalistId));
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const log = (await pool.query('SELECT "journalistId" FROM outreach_logs WHERE id = $1', [req.params.id])).rows[0];
    await pool.query('DELETE FROM outreach_logs WHERE id = $1', [req.params.id]);
    if (log) await syncJournalistStatus(Number(log.journalistId));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
