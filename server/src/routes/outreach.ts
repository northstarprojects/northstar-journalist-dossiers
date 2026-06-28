import { Router, Request, Response } from 'express';
import db from '../db';

const router = Router();

// ── Status sync ───────────────────────────────────────────────────────────────
// Called after every create / update / delete so journalist.outreachStatus
// always reflects the most advanced real state across all logged interactions.
//
// Log status priority (higher = more advanced):
//   Covered (7) > Meeting Scheduled / In Conversation (6) > Responded (5)
//   > Sent / No Response (3) > Draft (0, ignored)
//   Not a Fit / Declined (8) — terminal, overrides everything
//
// The journalist status is always driven upward by the highest-priority log.
// Deleting a log can move the status back down to reflect what remains.

const LOG_PRIORITY: Record<string, number> = {
  'Not a Fit':         8,
  'Declined':          8,
  'Covered':           7,
  'Meeting Scheduled': 6,
  'Responded':         5,
  'Sent':              3,
  'No Response':       3,
  'Draft':             0,
};

const LOG_TO_JOURNALIST_STATUS: Record<string, string> = {
  'Not a Fit':         'Not a Fit',
  'Declined':          'Not a Fit',
  'Covered':           'Covered',
  'Meeting Scheduled': 'In Conversation',
  'Responded':         'Responded',
  'Sent':              'Pitched',
  'No Response':       'Pitched',
};

function syncJournalistStatus(journalistId: number) {
  const logs = db.prepare(
    "SELECT * FROM outreach_logs WHERE journalistId = ? ORDER BY date DESC, createdAt DESC"
  ).all(journalistId) as any[];

  if (logs.length === 0) {
    // All logs deleted — reset to Researching (still in system, just no history)
    db.prepare(
      "UPDATE journalists SET outreachStatus = 'Researching', lastContactedDate = '', updatedAt = datetime('now') WHERE id = ?"
    ).run(journalistId);
    return;
  }

  // Find the highest-priority log status
  let bestStatus = '';
  let bestPriority = -1;

  for (const log of logs) {
    const p = LOG_PRIORITY[log.status] ?? 0;
    if (p > bestPriority) {
      bestPriority = p;
      bestStatus = log.status;
    }
  }

  // Only act on logs that matter (ignore draft-only histories)
  if (bestPriority <= 0) return;

  const newOutreachStatus = LOG_TO_JOURNALIST_STATUS[bestStatus];
  if (!newOutreachStatus) return;

  // Most recent non-draft sent date → lastContactedDate
  const lastSent = logs.find(l => l.status !== 'Draft' && l.date);
  const lastContactedDate = lastSent?.date || '';

  // Auto-set follow-up date to +7 days from last sent, if not already set
  // and status is Pitched (i.e. we just sent and are waiting)
  let followUpUpdate = '';
  if (newOutreachStatus === 'Pitched' && lastContactedDate) {
    const followUp = new Date(lastContactedDate);
    followUp.setDate(followUp.getDate() + 7);
    followUpUpdate = followUp.toISOString().split('T')[0];
  }

  db.prepare(`
    UPDATE journalists SET
      outreachStatus      = @status,
      lastContactedDate   = CASE WHEN @lcd != '' THEN @lcd ELSE lastContactedDate END,
      nextFollowUpDate    = CASE WHEN @fud != '' AND (nextFollowUpDate IS NULL OR nextFollowUpDate = '') THEN @fud ELSE nextFollowUpDate END,
      updatedAt           = datetime('now')
    WHERE id = @id
  `).run({ status: newOutreachStatus, lcd: lastContactedDate, fud: followUpUpdate, id: journalistId });

  console.log(`[OutreachSync] Journalist ${journalistId} → ${newOutreachStatus}`);
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/outreach/activity
 * Full activity feed — all outreach logs across all journalists.
 * Query params: publication, status, from (YYYY-MM-DD), to (YYYY-MM-DD), limit
 */
router.get('/activity', (req: Request, res: Response) => {
  const { publication, status, from, to, limit = '200' } = req.query as Record<string, string>;

  let where = '1=1';
  const params: any[] = [];

  if (publication) { where += ' AND j.publication = ?'; params.push(publication); }
  if (status)      { where += ' AND ol.status = ?';      params.push(status); }
  if (from)        { where += ' AND ol.date >= ?';        params.push(from); }
  if (to)          { where += ' AND ol.date <= ?';        params.push(to); }

  const rows = db.prepare(`
    SELECT
      ol.*,
      j.name        AS journalistName,
      j.publication AS publication,
      j.outreachStatus AS journalistStatus
    FROM outreach_logs ol
    JOIN journalists j ON j.id = ol.journalistId
    WHERE ${where}
    ORDER BY ol.date DESC, ol.createdAt DESC
    LIMIT ?
  `).all(...params, Number(limit));

  // Return distinct publication list for filter dropdown
  const publications = db.prepare(`
    SELECT DISTINCT j.publication
    FROM outreach_logs ol
    JOIN journalists j ON j.id = ol.journalistId
    ORDER BY j.publication
  `).all().map((r: any) => r.publication);

  res.json({ logs: rows, publications });
});

router.get('/journalist/:journalistId', (req: Request, res: Response) => {
  res.json(
    db.prepare('SELECT * FROM outreach_logs WHERE journalistId = ? ORDER BY date DESC, createdAt DESC')
      .all(req.params.journalistId)
  );
});

router.post('/', (req: Request, res: Response) => {
  const b = req.body;
  const result = db.prepare(`
    INSERT INTO outreach_logs (journalistId, date, channel, messageType, subjectLine, messageBody, response, status, nextStep)
    VALUES (@journalistId, @date, @channel, @messageType, @subjectLine, @messageBody, @response, @status, @nextStep)
  `).run(b);

  const created = db.prepare('SELECT * FROM outreach_logs WHERE id = ?').get(result.lastInsertRowid);
  syncJournalistStatus(Number(b.journalistId));
  res.status(201).json(created);
});

router.put('/:id', (req: Request, res: Response) => {
  const b = req.body;
  db.prepare(`
    UPDATE outreach_logs SET date=@date, channel=@channel, messageType=@messageType,
    subjectLine=@subjectLine, messageBody=@messageBody, response=@response,
    status=@status, nextStep=@nextStep, updatedAt=datetime('now') WHERE id=@id
  `).run({ ...b, id: req.params.id });

  const updated = db.prepare('SELECT * FROM outreach_logs WHERE id = ?').get(req.params.id) as any;
  if (updated) syncJournalistStatus(Number(updated.journalistId));
  res.json(updated);
});

router.delete('/:id', (req: Request, res: Response) => {
  const log = db.prepare('SELECT journalistId FROM outreach_logs WHERE id = ?').get(req.params.id) as any;
  db.prepare('DELETE FROM outreach_logs WHERE id = ?').run(req.params.id);
  if (log) syncJournalistStatus(Number(log.journalistId));
  res.json({ success: true });
});

export default router;
