import { Router, Request, Response } from 'express';
import db from '../db';
import { generateDraft } from '../services/campaignDraftService';
import type { CampaignType } from '../services/campaignDraftService';

const router = Router();

// ── Campaigns CRUD ────────────────────────────────────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  const campaigns = db.prepare(`
    SELECT c.*,
      COUNT(cj.id) as journalistCount,
      SUM(CASE WHEN cj.draftStatus = 'approved' THEN 1 ELSE 0 END) as approvedCount,
      SUM(CASE WHEN cj.draftStatus = 'sent' THEN 1 ELSE 0 END) as sentCount
    FROM campaigns c
    LEFT JOIN campaign_journalists cj ON cj.campaignId = c.id
    GROUP BY c.id
    ORDER BY c.createdAt DESC
  `).all();
  res.json(campaigns);
});

router.get('/:id', (req: Request, res: Response) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  res.json(campaign);
});

router.post('/', (req: Request, res: Response) => {
  const { name, type = 'cold_intro', brief = '', status = 'draft' } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = db.prepare(`
    INSERT INTO campaigns (name, type, brief, status) VALUES (@name, @type, @brief, @status)
  `).run({ name, type, brief, status });
  res.status(201).json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name = existing.name, type = existing.type, brief = existing.brief, status = existing.status } = req.body;
  db.prepare(`
    UPDATE campaigns SET name=@name, type=@type, brief=@brief, status=@status, updatedAt=datetime('now') WHERE id=@id
  `).run({ name, type, brief, status, id: req.params.id });
  res.json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Campaign journalists ───────────────────────────────────────────────────────

// GET all journalists in a campaign (with journalist details + draft)
router.get('/:id/journalists', (req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT cj.*, j.name, j.publication, j.beat, j.roleTitle, j.email,
           j.outreachStatus, j.totalScore, j.priorityTier, j.bestPitchAngle,
           j.isFavorite, j.staleFlag
    FROM campaign_journalists cj
    JOIN journalists j ON j.id = cj.journalistId
    WHERE cj.campaignId = ?
    ORDER BY j.totalScore DESC
  `).all(req.params.id);
  res.json(rows);
});

// POST add journalists to a campaign (bulk)
router.post('/:id/journalists', (req: Request, res: Response) => {
  const { journalistIds }: { journalistIds: number[] } = req.body;
  if (!Array.isArray(journalistIds) || journalistIds.length === 0) {
    return res.status(400).json({ error: 'journalistIds array is required' });
  }
  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const insert = db.prepare(`
    INSERT OR IGNORE INTO campaign_journalists (campaignId, journalistId)
    VALUES (?, ?)
  `);
  const insertMany = db.transaction(() => {
    for (const jid of journalistIds) insert.run(req.params.id, jid);
  });
  insertMany();

  res.json({ added: journalistIds.length });
});

// DELETE remove a journalist from a campaign
router.delete('/:id/journalists/:journalistId', (req: Request, res: Response) => {
  db.prepare('DELETE FROM campaign_journalists WHERE campaignId = ? AND journalistId = ?')
    .run(req.params.id, req.params.journalistId);
  res.json({ success: true });
});

// POST generate Claude drafts for all pending journalists in a campaign
router.post('/:id/generate-drafts', async (req: Request, res: Response) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });
  }

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id) as any;
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const pending = db.prepare(`
    SELECT cj.journalistId FROM campaign_journalists cj
    WHERE cj.campaignId = ? AND cj.draftStatus = 'pending'
  `).all(req.params.id) as any[];

  if (pending.length === 0) {
    return res.json({ count: 0, message: 'No pending drafts to generate.' });
  }

  res.json({
    count: pending.length,
    message: `Generating ${pending.length} draft${pending.length !== 1 ? 's' : ''} with Claude. This will take about ${Math.ceil(pending.length * 15 / 60)} minute${pending.length > 4 ? 's' : ''}. Refresh the page to see them appear.`,
  });

  // Background generation
  (async () => {
    for (const { journalistId } of pending) {
      const draft = await generateDraft(journalistId, campaign.type as CampaignType, campaign.brief);
      if (draft) {
        db.prepare(`
          UPDATE campaign_journalists SET draftSubject = @subject, draftBody = @body, draftStatus = 'ready'
          WHERE campaignId = @campaignId AND journalistId = @journalistId
        `).run({ subject: draft.subject, body: draft.body, campaignId: campaign.id, journalistId });
        console.log(`[CampaignDraft] ✓ Draft ready for journalist ${journalistId}`);
      } else {
        db.prepare(`
          UPDATE campaign_journalists SET draftStatus = 'failed'
          WHERE campaignId = @campaignId AND journalistId = @journalistId
        `).run({ campaignId: campaign.id, journalistId });
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log(`[CampaignDraft] Done — ${pending.length} drafts processed.`);
  })();
});

// PUT update a single draft (subject/body edit + approval)
router.put('/:id/journalists/:journalistId/draft', (req: Request, res: Response) => {
  const { draftSubject, draftBody, draftStatus } = req.body;
  db.prepare(`
    UPDATE campaign_journalists
    SET draftSubject = COALESCE(@subject, draftSubject),
        draftBody    = COALESCE(@body, draftBody),
        draftStatus  = COALESCE(@status, draftStatus)
    WHERE campaignId = @campaignId AND journalistId = @journalistId
  `).run({
    subject: draftSubject ?? null,
    body: draftBody ?? null,
    status: draftStatus ?? null,
    campaignId: req.params.id,
    journalistId: req.params.journalistId,
  });
  res.json({ success: true });
});

// POST mark a draft as sent — logs to outreach_logs, triggers status sync
router.post('/:id/journalists/:journalistId/send', (req: Request, res: Response) => {
  const cj = db.prepare(`
    SELECT cj.*, j.publication FROM campaign_journalists cj
    JOIN journalists j ON j.id = cj.journalistId
    WHERE cj.campaignId = ? AND cj.journalistId = ?
  `).get(req.params.id, req.params.journalistId) as any;

  if (!cj) return res.status(404).json({ error: 'Not found' });

  const today = new Date().toISOString().split('T')[0];

  // Create outreach log entry
  const logResult = db.prepare(`
    INSERT INTO outreach_logs (journalistId, date, channel, messageType, subjectLine, messageBody, status, nextStep)
    VALUES (@journalistId, @date, 'Email', @messageType, @subjectLine, @messageBody, 'Sent', 'Follow up in 7 days if no response')
  `).run({
    journalistId: req.params.journalistId,
    date: today,
    messageType: getCampaignMessageType(req.body.campaignType || 'cold_intro'),
    subjectLine: cj.draftSubject,
    messageBody: cj.draftBody,
  });

  // Mark draft as sent
  db.prepare(`
    UPDATE campaign_journalists SET draftStatus = 'sent', sentAt = @sentAt
    WHERE campaignId = @campaignId AND journalistId = @journalistId
  `).run({ sentAt: today, campaignId: req.params.id, journalistId: req.params.journalistId });

  // Sync journalist status (imported inline to avoid circular deps)
  syncJournalistAfterSend(Number(req.params.journalistId), today);

  res.json({ success: true, outreachLogId: logResult.lastInsertRowid });
});

function getCampaignMessageType(type: string): string {
  switch (type) {
    case 'cold_intro':    return 'Initial Pitch';
    case 'event':         return 'Story Tip';
    case 'hackathon':     return 'Story Tip';
    case 'founder_promo': return 'Story Tip';
    default:              return 'Initial Pitch';
  }
}

function syncJournalistAfterSend(journalistId: number, date: string) {
  // Same logic as outreach route syncJournalistStatus
  const logs = db.prepare(
    "SELECT * FROM outreach_logs WHERE journalistId = ? ORDER BY date DESC, createdAt DESC"
  ).all(journalistId) as any[];

  const priority: Record<string, number> = {
    'Not a Fit': 8, 'Declined': 8, 'Covered': 7, 'Meeting Scheduled': 6,
    'Responded': 5, 'Sent': 3, 'No Response': 3, 'Draft': 0,
  };
  const toStatus: Record<string, string> = {
    'Not a Fit': 'Not a Fit', 'Declined': 'Not a Fit', 'Covered': 'Covered',
    'Meeting Scheduled': 'In Conversation', 'Responded': 'Responded',
    'Sent': 'Pitched', 'No Response': 'Pitched',
  };

  let best = ''; let bestP = -1;
  for (const log of logs) {
    const p = priority[log.status] ?? 0;
    if (p > bestP) { bestP = p; best = log.status; }
  }
  if (bestP <= 0) return;

  const newStatus = toStatus[best];
  if (!newStatus) return;

  const followUp = new Date(date);
  followUp.setDate(followUp.getDate() + 7);
  const followUpDate = followUp.toISOString().split('T')[0];

  db.prepare(`
    UPDATE journalists SET
      outreachStatus    = @status,
      lastContactedDate = @lcd,
      nextFollowUpDate  = CASE WHEN nextFollowUpDate IS NULL OR nextFollowUpDate = '' THEN @fud ELSE nextFollowUpDate END,
      updatedAt         = datetime('now')
    WHERE id = @id
  `).run({ status: newStatus, lcd: date, fud: followUpDate, id: journalistId });
}

export default router;
