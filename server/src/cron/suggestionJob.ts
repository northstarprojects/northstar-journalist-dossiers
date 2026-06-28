import cron from 'node-cron';
import Anthropic from '@anthropic-ai/sdk';
import db from '../db';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

interface SuggestionResult {
  name: string;
  url: string;
  tier: 'A' | 'B' | 'C';
  focus: string;
  reason: string;
}

async function runSuggestionJob() {
  console.log('[SuggestionJob] Running weekly publication discovery...');

  // Get all current publications to avoid duplicates
  const existing = db.prepare('SELECT name, url FROM publications').all() as { name: string; url: string }[];
  const existingNames = existing.map(p => p.name.toLowerCase());
  const existingUrls = existing.map(p => (p.url || '').toLowerCase());

  // Also skip recently rejected suggestions (don't re-suggest within 30 days)
  const recentlyRejected = db.prepare(`
    SELECT name FROM publication_suggestions
    WHERE status = 'rejected' AND createdAt >= datetime('now', '-30 days')
  `).all() as { name: string }[];
  const rejectedNames = recentlyRejected.map(p => p.name.toLowerCase());

  const existingList = existing.map(p => `- ${p.name} (${p.url})`).join('\n');

  const prompt = `You are a media research assistant for North Star AI Labs, an AI startup based in Atlanta, Georgia.

Your task is to suggest NEW publications, blogs, newsletters, or media outlets that cover AI, machine learning, tech startups, venture capital, or the Atlanta/Southeast tech ecosystem — that are NOT already in our tracking list.

Our current tracked publications:
${existingList}

We use a 3-tier system:
- Tier A: Major national tech/AI publications with large audiences and strong industry influence (e.g. TechCrunch, Wired, MIT Technology Review). These are outlets most people in tech would recognize.
- Tier B: Business publications with dedicated tech or AI desks; strong but broader focus (e.g. Forbes Technology, Fast Company, Bloomberg Technology). These cover AI within a broader business context.
- Tier C: Regional, niche, or emerging publications — especially Southeast US ecosystem, AI-specific newsletters, or rising vertical publications (e.g. Hypepotamus, Atlanta Business Chronicle, AI-specific substacks with significant readership).

Please suggest up to 5 publications we should add. Quality matters more than quantity — only suggest a publication if you are genuinely confident it:
1. Is NOT already in our existing list (check carefully)
2. Is currently active and publishing as of 2025-2026
3. Is genuinely relevant to AI startups, venture capital, or the Southeast US tech ecosystem
4. Has a real, verifiable web presence (not a defunct or paywalled-only outlet)

If you cannot find enough publications that meet all these criteria, return fewer than 5 — or return an empty array [] if there are truly no good additions right now. Never pad the list with weak or marginally relevant suggestions just to reach a number.

Respond with ONLY a valid JSON array (which may be empty), no markdown, no explanation outside the JSON:
[
  {
    "name": "Publication Name",
    "url": "https://example.com",
    "tier": "A" | "B" | "C",
    "focus": "Short description of what they cover (max 60 chars)",
    "reason": "One sentence explaining why this is relevant to an AI startup (max 120 chars)"
  }
]`;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract text content
    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      console.error('[SuggestionJob] No text block in response');
      return;
    }

    let suggestions: SuggestionResult[];
    try {
      // Strip any accidental markdown fences
      const raw = textBlock.text.replace(/```json|```/g, '').trim();
      suggestions = JSON.parse(raw);
    } catch (e) {
      console.error('[SuggestionJob] Failed to parse Claude response as JSON:', textBlock.text);
      return;
    }

    if (!Array.isArray(suggestions)) {
      console.error('[SuggestionJob] Expected array, got:', typeof suggestions);
      return;
    }

    const insertStmt = db.prepare(`
      INSERT INTO publication_suggestions (name, url, tier, focus, reason, status)
      VALUES (@name, @url, @tier, @focus, @reason, 'pending')
    `);

    let added = 0;
    for (const s of suggestions) {
      if (!s.name || !s.url) continue;

      // Skip if already in publications list
      if (existingNames.includes(s.name.toLowerCase())) continue;
      if (existingUrls.includes(s.url.toLowerCase())) continue;

      // Skip if recently rejected
      if (rejectedNames.includes(s.name.toLowerCase())) continue;

      // Skip if already pending suggestion
      const alreadyPending = db.prepare(
        "SELECT id FROM publication_suggestions WHERE LOWER(name)=LOWER(?) AND status='pending'"
      ).get(s.name);
      if (alreadyPending) continue;

      insertStmt.run({
        name: s.name,
        url: s.url,
        tier: ['A', 'B', 'C'].includes(s.tier) ? s.tier : 'B',
        focus: s.focus || '',
        reason: s.reason || '',
      });
      added++;
    }

    if (added === 0) {
      console.log(`[SuggestionJob] Done. Claude returned ${suggestions.length} suggestion(s) but none passed filters (duplicates/recently rejected). No new suggestions added.`);
    } else {
      console.log(`[SuggestionJob] Done. Added ${added} new suggestion(s) for admin review.`);
    }
  } catch (err: any) {
    console.error('[SuggestionJob] Error calling Claude:', err.message || err);
  }
}

// Run every Monday at 8am
export function startSuggestionCron() {
  cron.schedule('0 8 * * 1', () => {
    runSuggestionJob();
  }, { timezone: 'America/New_York' });

  console.log('[SuggestionJob] Weekly cron scheduled — Mondays at 8am ET');
}

// Export for manual trigger via API
export { runSuggestionJob };
