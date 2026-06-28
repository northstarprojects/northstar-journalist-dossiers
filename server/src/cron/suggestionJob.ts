import cron from 'node-cron';
import Anthropic from '@anthropic-ai/sdk';
import pool from '../db';

const client = new Anthropic();

interface SuggestionResult {
  name: string;
  url: string;
  tier: 'A' | 'B' | 'C';
  focus: string;
  reason: string;
}

export async function runSuggestionJob() {
  console.log('[SuggestionJob] Running weekly publication discovery...');

  const existing = (await pool.query('SELECT name, url FROM publications')).rows as { name: string; url: string }[];
  const existingNames = existing.map(p => p.name.toLowerCase());
  const existingUrls = existing.map(p => (p.url || '').toLowerCase());

  const recentlyRejected = (await pool.query(`
    SELECT name FROM publication_suggestions
    WHERE status = 'rejected' AND "createdAt" >= NOW() - INTERVAL '30 days'
  `)).rows as { name: string }[];
  const rejectedNames = recentlyRejected.map(p => p.name.toLowerCase());

  const existingList = existing.map(p => `- ${p.name} (${p.url})`).join('\n');

  const prompt = `You are a media research assistant for North Star AI Labs, an AI startup based in Atlanta, Georgia.

Your task is to suggest NEW publications, blogs, newsletters, or media outlets that cover AI, machine learning, tech startups, venture capital, or the Atlanta/Southeast tech ecosystem — that are NOT already in our tracking list.

Our current tracked publications:
${existingList}

We use a 3-tier system:
- Tier A: Major national tech/AI publications with large audiences and strong industry influence
- Tier B: Business publications with dedicated tech or AI desks
- Tier C: Regional, niche, or emerging publications — especially Southeast US ecosystem

Please suggest up to 5 publications we should add. Only suggest a publication if you are genuinely confident it:
1. Is NOT already in our existing list
2. Is currently active and publishing as of 2025-2026
3. Is genuinely relevant to AI startups, venture capital, or the Southeast US tech ecosystem
4. Has a real, verifiable web presence

Respond with ONLY a valid JSON array (which may be empty), no markdown:
[
  {
    "name": "Publication Name",
    "url": "https://example.com",
    "tier": "A" | "B" | "C",
    "focus": "Short description (max 60 chars)",
    "reason": "One sentence why this is relevant (max 120 chars)"
  }
]`;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') { console.error('[SuggestionJob] No text block in response'); return; }

    let suggestions: SuggestionResult[];
    try {
      const raw = textBlock.text.replace(/```json|```/g, '').trim();
      suggestions = JSON.parse(raw);
    } catch {
      console.error('[SuggestionJob] Failed to parse Claude response:', textBlock.text);
      return;
    }

    if (!Array.isArray(suggestions)) { console.error('[SuggestionJob] Expected array'); return; }

    let added = 0;
    for (const s of suggestions) {
      if (!s.name || !s.url) continue;
      if (existingNames.includes(s.name.toLowerCase())) continue;
      if (existingUrls.includes(s.url.toLowerCase())) continue;
      if (rejectedNames.includes(s.name.toLowerCase())) continue;

      const alreadyPending = (await pool.query(
        "SELECT id FROM publication_suggestions WHERE LOWER(name)=LOWER($1) AND status='pending'", [s.name]
      )).rows[0];
      if (alreadyPending) continue;

      await pool.query(
        "INSERT INTO publication_suggestions (name, url, tier, focus, reason, status) VALUES ($1,$2,$3,$4,$5,'pending')",
        [s.name, s.url, ['A', 'B', 'C'].includes(s.tier) ? s.tier : 'B', s.focus || '', s.reason || '']
      );
      added++;
    }

    console.log(`[SuggestionJob] Done. Added ${added} new suggestion(s).`);
  } catch (err: any) {
    console.error('[SuggestionJob] Error:', err.message || err);
  }
}

export function startSuggestionCron() {
  cron.schedule('0 8 * * 1', () => {
    runSuggestionJob().catch(console.error);
  }, { timezone: 'America/New_York' });
  console.log('[SuggestionJob] Weekly cron scheduled — Mondays at 8am ET');
}
