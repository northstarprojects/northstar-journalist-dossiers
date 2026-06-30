/**
 * journalistAnalysis.ts
 * Uses Claude to auto-suggest beat + scoring dimensions when a journalist
 * suggestion is accepted. The admin reviews and adjusts before saving.
 *
 * Input:  journalist name, publication, recent article title + URL, suggested beat
 * Output: refined beat, score suggestions for all 6 dimensions, best pitch angle
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface JournalistAnalysis {
  beat: string;
  bestPitchAngle: string;
  scores: {
    aiRelevanceScore: number;       // 0–25
    startupRelevanceScore: number;  // 0–20
    northStarFitScore: number;      // 0–20
    publicationAuthorityScore: number; // 0–15
    audienceReachScore: number;     // 0–10
    contactabilityScore: number;    // 0–10 (default mid-range; no info yet)
  };
  reasoning: string;
}

export async function analyzeJournalist(params: {
  name: string;
  publication: string;
  publicationTier: string; // A, B, or C
  recentArticleTitle: string;
  recentArticleUrl: string;
  suggestedBeat: string;
  allArticleTitles?: string[]; // All scanned article titles for beat accuracy
}): Promise<JournalistAnalysis | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const { name, publication, publicationTier, recentArticleTitle, recentArticleUrl, suggestedBeat, allArticleTitles } = params;

  const tierContext: Record<string, string> = {
    A: 'Major national tech/AI publication (large audience, high industry authority)',
    B: 'Business publication with a tech desk (executive and investor audience)',
    C: 'Regional or niche publication (targeted audience, Southeast US or vertical focus)',
  };

  const prompt = `You are helping a PR team at North Star AI Labs — an AI startup based in Atlanta, Georgia — evaluate a newly discovered journalist.

JOURNALIST:
- Name: ${name}
- Publication: ${publication} (Tier ${publicationTier}: ${tierContext[publicationTier] || 'unknown tier'})
${allArticleTitles && allArticleTitles.length > 1
  ? `- Recent articles scanned (${allArticleTitles.length}):\n${allArticleTitles.map((t, i) => `  ${i + 1}. "${t}"`).join('\n')}`
  : `- Recent article: "${recentArticleTitle}"`}
${recentArticleUrl ? `- Top article URL: ${recentArticleUrl}` : ''}
${suggestedBeat ? `- Keyword-inferred beat: ${suggestedBeat} (use the article list above to verify or correct this)` : ''}

North Star AI Labs builds AI tools for enterprise. They want coverage in tech, AI, and startup media — especially Southeast US outlets.

Based on what you know about this journalist and publication, provide:

1. A refined beat description (max 50 characters, e.g. "AI/ML & Enterprise Software")
2. Suggested scores on these dimensions:
   - aiRelevanceScore: 0–25 (how closely does their beat match AI/ML/LLM?)
   - startupRelevanceScore: 0–20 (do they cover startups, funding, founders?)
   - northStarFitScore: 0–20 (would they likely cover an AI enterprise startup?)
   - publicationAuthorityScore: 0–15 (reach and credibility of ${publication})
   - audienceReachScore: 0–10 (estimated readership and social following)
   - contactabilityScore: 0–5 (default mid-range — we have no contact info yet)
3. A best pitch angle (max 100 characters — what hook would resonate with this journalist?)
4. One sentence of reasoning explaining your scores

Return ONLY valid JSON — no prose before or after:
{
  "beat": "...",
  "bestPitchAngle": "...",
  "scores": {
    "aiRelevanceScore": 0,
    "startupRelevanceScore": 0,
    "northStarFitScore": 0,
    "publicationAuthorityScore": 0,
    "audienceReachScore": 0,
    "contactabilityScore": 5
  },
  "reasoning": "..."
}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 512,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as JournalistAnalysis;
    return parsed;
  } catch (err: any) {
    console.error('[JournalistAnalysis] Claude error:', err.message);
    return null;
  }
}
