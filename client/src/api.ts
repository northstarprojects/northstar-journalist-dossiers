import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
});

export const journalists = {
  list: (params?: any) => api.get('/journalists', { params }),
  get: (id: number) => api.get(`/journalists/${id}`),
  create: (data: any) => api.post('/journalists', data),
  update: (id: number, data: any) => api.put(`/journalists/${id}`, data),
  delete: (id: number) => api.delete(`/journalists/${id}`),
  bulkRescore: () => api.post('/journalists/bulk-rescore'),
  backfillArticles: () => api.post('/journalists/backfill-articles'),
  toggleFavorite: (id: number) => api.patch(`/journalists/${id}/favorite`),
  refreshArticles: () => api.post('/journalist-articles/refresh-now'),
};

export const articles = {
  byJournalist: (id: number) => api.get(`/articles/journalist/${id}`),
  create: (data: any) => api.post('/articles', data),
  update: (id: number, data: any) => api.put(`/articles/${id}`, data),
  delete: (id: number) => api.delete(`/articles/${id}`),
};

export const outreach = {
  byJournalist: (id: number) => api.get(`/outreach/journalist/${id}`),
  activity: (params?: any) => api.get('/outreach/activity', { params }),
  create: (data: any) => api.post('/outreach', data),
  update: (id: number, data: any) => api.put(`/outreach/${id}`, data),
  delete: (id: number) => api.delete(`/outreach/${id}`),
};

export const dashboard = {
  get: () => api.get('/dashboard'),
};

export const campaigns = {
  list: () => api.get('/campaigns'),
  get: (id: number) => api.get(`/campaigns/${id}`),
  create: (data: any) => api.post('/campaigns', data),
  update: (id: number, data: any) => api.put(`/campaigns/${id}`, data),
  delete: (id: number) => api.delete(`/campaigns/${id}`),
  getJournalists: (id: number) => api.get(`/campaigns/${id}/journalists`),
  addJournalists: (id: number, journalistIds: number[]) => api.post(`/campaigns/${id}/journalists`, { journalistIds }),
  removeJournalist: (id: number, journalistId: number) => api.delete(`/campaigns/${id}/journalists/${journalistId}`),
  generateDrafts: (id: number) => api.post(`/campaigns/${id}/generate-drafts`),
  updateDraft: (id: number, journalistId: number, data: any) => api.put(`/campaigns/${id}/journalists/${journalistId}/draft`, data),
  markSent: (id: number, journalistId: number, campaignType: string) => api.post(`/campaigns/${id}/journalists/${journalistId}/send`, { campaignType }),
};

export const publications = {
  list:          () => api.get('/publications'),
  get:           (id: number) => api.get(`/publications/${id}`),
  create:        (data: any) => api.post('/publications', data),
  update:        (id: number, data: any) => api.put(`/publications/${id}`, data),
  delete:        (id: number) => api.delete(`/publications/${id}`),
  importOpml:    (opmlContent: string) => api.post('/publications/import-opml', { opmlContent }),
  getFeeds:      (id: number) => api.get(`/publications/${id}/feeds`),
  getJournalists: (id: number) => api.get(`/publications/${id}/journalists`),
  discover: (query: string) => api.post('/publications/discover', { query }),
  discoverFeeds: (id: number) => api.post(`/publications/${id}/discover-feeds`),
  addFeed:       (id: number, feedUrl: string, feedLabel: string) => api.post(`/publications/${id}/feeds`, { feedUrl, feedLabel }),
  deleteFeed:    (id: number, feedId: number) => api.delete(`/publications/${id}/feeds/${feedId}`),
  checkAllFeeds: () => api.post('/publications/check-feeds'),
  discoverFeedsAll: () => api.post('/publications/discover-feeds-all'),
  syncFeeds: () => api.post('/publications/sync-feeds'),
};

export const journalistSuggestions = {
  list: () => api.get('/journalist-suggestions'),
  count: () => api.get('/journalist-suggestions/count'),
  accept: (id: number) => api.post(`/journalist-suggestions/${id}/accept`),
  reject: (id: number) => api.post(`/journalist-suggestions/${id}/reject`),
  history: () => api.get('/journalist-suggestions/history'),
  scanPublication: (publicationId: number) => api.post(`/journalist-suggestions/scan/${publicationId}`),
  staffScan: (publicationId: number) => api.post(`/journalist-suggestions/staff-scan/${publicationId}`),
  scanAll: () => api.post('/journalist-suggestions/scan-all'),
};

export const healthCheck = {
  summary: () => api.get('/health-check/summary'),
  runNow: () => api.post('/health-check/run-now'),
};

export const suggestions = {
  list: () => api.get('/suggestions'),
  count: () => api.get('/suggestions/count'),
  accept: (id: number) => api.post(`/suggestions/${id}/accept`),
  reject: (id: number) => api.post(`/suggestions/${id}/reject`),
  history: () => api.get('/suggestions/history'),
  runNow: () => api.post('/suggestions/run-now'),
};

export const coverage = {
  list:      (params?: any) => api.get('/coverage', { params }),
  get:       (id: number)   => api.get(`/coverage/${id}`),
  create:    (data: any)    => api.post('/coverage', data),
  update:    (id: number, data: any) => api.put(`/coverage/${id}`, data),
  delete:    (id: number)   => api.delete(`/coverage/${id}`),
  fetchMeta: (url: string)  => api.post('/coverage/fetch-meta', { url }),
};

export const campaignStyles = {
  list: () => api.get('/campaign-styles'),
  update: (type: string, instructions: string) => api.put(`/campaign-styles/${type}`, { instructions }),
};

export const enrichment = {
  findProfiles:  (id: number) => api.post(`/enrichment/${id}/profiles`),
  bulkProfiles:  ()           => api.post('/enrichment/bulk/profiles'),
};

export const exportUrl = (type: 'journalists' | 'articles' | 'outreach') =>
  `http://localhost:3001/api/export/${type}`;
