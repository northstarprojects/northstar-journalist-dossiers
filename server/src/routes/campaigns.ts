import { Router, Request, Response } from 'express';
import pool from '../db';
import { generateDraft } from '../services/campaignDraftService';
import type { CampaignType } from '../services/campaignDraftService';

const router = Router();

// GET all campaigns
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT c.*,
        COUNT(cj.id)::int as "journalistCount",
        SUM(CASE WHEN cj."draftStatus" = 'approved' THEN 1 ELSE 0 END)::int as "approvedCount",
        SUM(CASE WHEN cj."draftStatus" = 'sent' THEN 1 ELSE 0 END)::int as "sentCount"
      FROM campaigns c
      LEFT JOIN campaign_journalists cj ON cj."campaignId" = c.id
      GROUP BY c.id
      ORDER BY c."createdAt" DESC
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, type = 'cold_intro', brief = '', status = 'draft' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      'INSERT INTO campaigns (name, type, brief, status) VALUES ($1,$2,$3,$4) RETURNING id',
      [name, type, brief, status]
    );
    const created = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [result.rows[0].id])).rows[0];
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const existing = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { name = existing.name, type = existing.type, brief = existing.brief, status = existing.status } = req.body;
    await pool.query(
      'UPDATE campaigns SET name=$1, type=$2, brief=$3, status=$4, "updatedAt"=NOW() WHERE id=$5',
      [name, type, brief, status, req.params.id]
    );
    res.json((await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id])).rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM campaigns WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET journalists in a campaign
router.get('/:id/journalists', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT cj.*, j.name, j.publication, j.beat, j."roleTitle", j.email,
             j."outreachStatus", j."totalScore", j."priorityTier", j."bestPitchAngle",
             j."isFavorite", j."staleFlag"
      FROM campaign_journalists cj
      JOIN journalists j ON j.id = cj."journalistId"
      WHERE cj."campaignId" = $1
      ORDER BY j."totalScore" DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST add journalists to campaign (bulk)
router.post('/:id/journalists', async (req: Request, res: Response) => {
  try {
    const { journalistIds }: { journalistIds: number[] } = req.body;
    if (!Array.isArray(journalistIds) || journalistIds.length === 0) {
      return res.status(400).json({ error: 'journalistIds array is required' });
    }
    const campaign = (await pool.query('SELECT id FROM campaigns WHERE id = $1', [req.params.id])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const jid of journalistIds) {
        await client.query(
          'INSERT INTO campaign_journalists ("campaignId", "journalistId") VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [req.params.id, jid]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ added: journalistIds.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE remove a journalist from a campaign
router.delete('/:id/journalists/:journalistId', async (req: Request, res: Response) => {
  try {
    await pool.query(
      'DELETE FROM campaign_journalists WHERE "campaignId" = $1 AND "journalistId" = $2',
      [req.params.id, req.params.journalistId]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST generate Claude drafts for all pending journalists
router.post('/:id/generate-drafts', async (req: Request, res: Response) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });
  }
  try {
    const campaign = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const pending = (await pool.query(
      'SELECT "journalistId" FROM campaign_journalists WHERE "campaignId" = $1 AND "draftStatus" = \'pending\'',
      [req.params.id]
    )).rows;

    if (pending.length === 0) return res.json({ count: 0, message: 'No pending drafts to generate.' });

    res.json({
      count: pending.length,
      message: `Generating ${pending.length} draft${pending.length !== 1 ? 's' : ''} with Claude. Refresh to see them appear.`,
    });

    (async () => {
      for (const { journalistId } of pending) {
        const draft = await generateDraft(journalistId, campaign.type as CampaignType, campaign.brief);
        if (draft) {
          await pool.query(`
            UPDATE campaign_journalists SET "draftSubject"=$1, "draftBody"=$2, "draftStatus"='ready'
            WHERE "campaignId"=$3 AND "journalistId"=$4
          `, [draft.subject, draft.body, campaign.id, journalistId]);
        } else {
          await pool.query(
            "UPDATE campaign_journalists SET \"draftStatus\"='failed' WHERE \"campaignId\"=$1 AND \"journalistId\"=$2",
            [campaign.id, journalistId]
          );
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      console.log(`[CampaignDraft] Done — ${pending.length} drafts processed.`);
    })();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update a single draft
router.put('/:id/journalists/:journalistId/draft', async (req: Request, res: Response) => {
  try {
    const { draftSubject, draftBody, draftStatus } = req.body;
    await pool.query(`
      UPDATE campaign_journalists
      SET "draftSubject" = COALESCE($1, "draftSubject"),
          "draftBody"    = COALESCE($2, "draftBody"),
          "draftStatus"  = COALESCE($3, "draftStatus")
      WHERE "campaignId" = $4 AND "journalistId" = $5
    `, [draftSubject ?? null, draftBody ?? null, draftStatus ?? null, req.params.id, req.params.journalistId]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST mark a draft as sent
router.post('/:id/journalists/:journalistId/send', async (req: Request, res: Response) => {
  try {
    const cj = (await pool.query(`
      SELECT cj.*, j.publication FROM campaign_journalists cj
      JOIN journalists j ON j.id = cj."journalistId"
      WHERE cj."campaignId" = $1 AND cj."journalistId" = $2
    `, [req.params.id, req.params.journalistId])).rows[0];

    if (!cj) return res.status(404).json({ error: 'Not found' });

    const today = new Date().toISOString().split('T')[0];
    const messageType = getCampaignMessageType(req.body.campaignType || 'cold_intro');

    const logResult = await pool.query(`
      INSERT INTO outreach_logs ("journalistId", date, channel, "messageType", "subjectLine", "messageBody", status, "nextStep")
      VALUES ($1,$2,'Email',$3,$4,$5,'Sent','Follow up in 7 days if no response') RETURNING id
    `, [req.params.journalistId, today, messageType, cj.draftSubject, cj.draftBody]);

    await pool.query(
      'UPDATE campaign_journalists SET "draftStatus"=\'sent\', "sentAt"=$1 WHERE "campaignId"=$2 AND "journalistId"=$3',
      [today, req.params.id, req.params.journalistId]
    );

    syncJournalistAfterSend(Number(req.params.journalistId), today).catch(console.error);

    res.json({ success: true, outreachLogId: logResult.rows[0].id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function getCampaignMessageType(type: string): string {
  switch (type) {
    case 'cold_intro': return 'Initial Pitch';
    case 'event': return 'Story Tip';
    case 'hackathon': return 'Story Tip';
    case 'founder_promo': return 'Story Tip';
    default: return 'Initial Pitch';
  }
}

async function syncJournalistAfterSend(journalistId: number, date: string): Promise<void> {
  const logs = (await pool.query(
    'SELECT * FROM outreach_logs WHERE "journalistId" = $1 ORDER BY date DESC, "createdAt" DESC',
    [journalistId]
  )).rows;

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

  await pool.query(`
    UPDATE journalists SET
      "outreachStatus" = $1,
      "lastContactedDate" = $2,
      "nextFollowUpDate" = CASE WHEN "nextFollowUpDate" IS NULL OR "nextFollowUpDate" = '' THEN $3 ELSE "nextFollowUpDate" END,
      "updatedAt" = NOW()
    WHERE id = $4
  `, [newStatus, date, followUpDate, journalistId]);
}

export default router;
