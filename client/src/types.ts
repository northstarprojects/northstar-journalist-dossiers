export interface Journalist {
  id: number;
  name: string;
  publication: string;
  roleTitle: string;
  beat: string;
  location: string;
  publicationType: string;
  aiRelevanceScore: number;
  startupRelevanceScore: number;
  northStarFitScore: number;
  publicationAuthorityScore: number;
  audienceReachScore: number;
  contactabilityScore: number;
  totalScore: number;
  priorityTier: number;
  email: string;
  contactUrl: string;
  linkedinUrl: string;
  twitterUrl: string;
  personalWebsite: string;
  muckRackUrl: string;
  bestPitchAngle: string;
  notes: string;
  isFavorite: number;
  staleFlag: number;
  lastArticleDate: string;
  outreachStatus: string;
  lastContactedDate: string;
  nextFollowUpDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface Article {
  id: number;
  journalistId: number;
  title: string;
  url: string;
  publication: string;
  publishDate: string;
  topic: string;
  storyType: string;
  summary: string;
  relevanceToNorthStar: string;
  usefulAngle: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutreachLog {
  id: number;
  journalistId: number;
  date: string;
  channel: string;
  messageType: string;
  subjectLine: string;
  messageBody: string;
  response: string;
  status: string;
  nextStep: string;
  createdAt: string;
  updatedAt: string;
}

export interface Publication {
  id: number;
  name: string;
  url: string;
  tier: 'A' | 'B' | 'C';
  focus: string;
  notes: string;
  rssUrl: string;
  rssStatus: 'unknown' | 'active' | 'inactive' | 'none';
  rssLastChecked: string;
  healthStatus: 'unknown' | 'healthy' | 'unreachable';
  lastHealthCheck: string;
  isVirtual: number;
  active: number;
  feedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicationFeed {
  id: number;
  publicationId: number;
  feedUrl: string;
  feedLabel: string;
  feedType: 'main' | 'category';
  rssStatus: 'unknown' | 'active' | 'inactive';
  rssLastChecked: string;
  discoveredAt: string;
}

export interface JournalistSuggestion {
  id: number;
  name: string;
  publicationId: number;
  publicationName: string;
  sourceType: 'rss' | 'staffpage' | 'firecrawl';
  recentArticleTitle: string;
  recentArticleUrl: string;
  recentArticleDate: string;
  suggestedBeat: string;
  relevanceScore: number;       // 0–10
  matchedTags: string;          // JSON string array
  articleCount: number;         // articles found for this author
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface PublicationSuggestion {
  id: number;
  name: string;
  url: string;
  tier: 'A' | 'B' | 'C';
  focus: string;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export type CampaignType = 'cold_intro' | 'event' | 'hackathon' | 'founder_promo';
export type CampaignStatus = 'draft' | 'active' | 'completed';
export type DraftStatus = 'pending' | 'ready' | 'approved' | 'sent' | 'skipped' | 'failed';

export interface Campaign {
  id: number;
  name: string;
  type: CampaignType;
  brief: string;
  status: CampaignStatus;
  journalistCount: number;
  approvedCount: number;
  sentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignJournalist {
  id: number;
  campaignId: number;
  journalistId: number;
  draftSubject: string;
  draftBody: string;
  draftStatus: DraftStatus;
  sentAt: string;
  createdAt: string;
  // joined journalist fields
  name: string;
  publication: string;
  beat: string;
  roleTitle: string;
  email: string;
  outreachStatus: string;
  totalScore: number;
  priorityTier: number;
  bestPitchAngle: string;
  isFavorite: number;
  staleFlag: number;
}

export type CoverageType = 'mention' | 'feature' | 'interview' | 'quote' | 'review' | 'op-ed';
export type CoverageSentiment = 'positive' | 'neutral' | 'mixed' | 'negative';

export interface CoverageItem {
  id: number;
  title: string;
  url: string;
  publication: string;
  publishDate: string;
  journalistId: number | null;
  journalistName: string;
  linkedJournalistName: string;
  linkedPublication: string;
  coverageType: CoverageType;
  sentiment: CoverageSentiment;
  summary: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardData {
  total: number;
  tiers: { priorityTier: number; count: number }[];
  avgScore: number;
  followUps: Journalist[];
  recentOutreach: (OutreachLog & { journalistName: string; publication: string })[];
  staleJournalists: number;
  unreachablePubs: number;
  activeCampaigns: number;
  draftsReady: number;
  sentThisWeek: number;
  recentCampaigns: {
    id: number; name: string; type: string; status: string;
    journalistCount: number; sentCount: number; readyCount: number;
  }[];
}
