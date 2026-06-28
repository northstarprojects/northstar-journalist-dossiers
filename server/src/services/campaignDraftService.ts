/**
 * Campaign draft generation using Claude Opus 4.8.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db';

const client = new Anthropic();

export type CampaignType = 'cold_intro' | 'event' | 'hackathon' | 'founder_promo';

interface DraftResult { subject: string; body: string }

function buildRelationshipContext(logs: any[]): string {
  if (logs.length === 0) return 'No previous contact. This is a cold outreach.';
  const sentLogs = logs.filter(l => l.status !== 'Draft');
  if (sentLogs.length === 0) return 'No previous contact. This is a cold outreach.';
  const latest = sentLogs[0];
  const count = sentLogs.length;
  const hasResponse = sentLogs.some(l => l.response && l.response.trim().length > 0);
  const hasCovered = sentLogs.some(l => l.status === 'Covered');
  if (hasCovered) {
    const coveredLog = sentLogs.find(l => l.status === 'Covered');
    return `This journalist has covered North Star AI Labs before (${coveredLog?.date || 'previously'}). This is a warm follow-up — skip introductions and reference the previous coverage if relevant.`;
  }
  if (hasResponse) {
    const responseLog = sentLogs.find(l => l.response);
    return `${count} previous contact${count !== 1 ? 's' : ''}. They have responded before. Last contact: ${latest.date}. Their response: "${responseLog?.response}". Use a peer-to-peer tone — they know who you are.`;
  }
  return `${count} previous pitch${count !== 1 ? 'es' : ''} with no response. Last contact: ${latest.date}. Keep it brief — reference a fresh hook and don't re-pitch the same angle.`;
}

function buildTypeInstructions(type: CampaignType, brief: string): string {
  switch (type) {
    case 'cold_intro': return `CAMPAIGN TYPE: Cold Introduction\nGOAL: Introduce North Star AI Labs and express genuine interest in the journalist's coverage. Plant a seed — this is not a hard ask, just an opening.\nBRIEF: ${brief}`;
    case 'event': return `CAMPAIGN TYPE: Event Coverage Pitch\nGOAL: Invite the journalist to cover or attend an upcoming event.\nEVENT DETAILS: ${brief}`;
    case 'hackathon': return `CAMPAIGN TYPE: Hackathon Promotion\nGOAL: Get the journalist interested in covering a hackathon.\nHACKATHON DETAILS: ${brief}`;
    case 'founder_promo': return `CAMPAIGN TYPE: Founder / Startup Spotlight\nGOAL: Pitch a specific founder or startup story.\nSTORY DETAILS: ${brief}`;
  }
}

export async function generateDraft(
  journalistId: number,
  campaignType: CampaignType,
  campaignBrief: string,
): Promise<DraftResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const journalist = (await pool.query('SELECT * FROM journalists WHERE id = $1', [journalistId])).rows[0];
  if (!journalist) return null;

  const articles = (await pool.query(
    'SELECT title, url, "publishDate" FROM articles WHERE "journalistId" = $1 ORDER BY "publishDate" DESC LIMIT 5',
    [journalistId]
  )).rows;

  const outreachLogs = (await pool.query(
    'SELECT date, status, "subjectLine", response FROM outreach_logs WHERE "journalistId" = $1 ORDER BY date DESC LIMIT 10',
    [journalistId]
  )).rows;

  const articlesText = articles.length > 0
    ? articles.map((a: any, i: number) => `  ${i + 1}. "${a.title}"${a.url ? ` (${a.url})` : ''}${a.publishDate ? ` — ${a.publishDate}` : ''}`).join('\n')
    : '  No articles on record.';

  const relationshipContext = buildRelationshipContext(outreachLogs);
  const typeInstructions = buildTypeInstructions(campaignType, campaignBrief);

  const styleRow = (await pool.query(
    'SELECT instructions FROM campaign_type_styles WHERE type = $1', [campaignType]
  )).rows[0];
  const houseStyle = styleRow?.instructions?.trim() || '';

  const prompt = `You are a communications specialist at North Star AI Labs writing a pitch email to a journalist.

ABOUT NORTH STAR AI LABS:
North Star AI Labs is an AI startup accelerator and applied research lab based in Atlanta, Georgia. We support early-stage AI founders, run community hackathons, publish applied AI research, and connect the Southeast US tech ecosystem.

${typeInstructions}

JOURNALIST PROFILE:
- Name: ${journalist.name}
- Publication: ${journalist.publication}
- Beat: ${journalist.beat || 'Technology'}
- Role: ${journalist.roleTitle || 'Journalist'}
${journalist.bestPitchAngle ? `- Best pitch angle (from prior research): ${journalist.bestPitchAngle}` : ''}

THEIR RECENT ARTICLES:
${articlesText}

RELATIONSHIP HISTORY:
${relationshipContext}

WRITING GUIDELINES:
- Reference something specific from their actual recent work — not generic flattery
- Body must be under 150 words — journalists delete long emails
- Subject line under 10 words, no clickbait
- No "I hope this email finds you well", no "I'm reaching out because"
- End with one clear, low-pressure ask
- Sign off as: [Your name], North Star AI Labs
${houseStyle ? `\nHOUSE STYLE — ALWAYS FOLLOW THESE ADDITIONAL INSTRUCTIONS:\n${houseStyle}` : ''}

Return ONLY valid JSON: {"subject": "...", "body": "..."}`;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });
    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return null;
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.subject || !parsed.body) return null;
    return { subject: parsed.subject, body: parsed.body };
  } catch (err: any) {
    console.error(`[CampaignDraft] Error for journalist ${journalistId}:`, err.message);
    return null;
  }
}
