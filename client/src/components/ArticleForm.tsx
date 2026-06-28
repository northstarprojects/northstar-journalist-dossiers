import { useState } from 'react';
import { articles as api } from '../api';
import type { Article } from '../types';

interface Props {
  journalistId: number;
  article: Article | null;
  onSave: () => void;
  onCancel: () => void;
}

const empty = {
  title: '', url: '', publication: '', publishDate: '', topic: '',
  storyType: '', summary: '', relevanceToNorthStar: '', usefulAngle: '',
};

export default function ArticleForm({ journalistId, article, onSave, onCancel }: Props) {
  const [form, setForm] = useState(article ? { ...article } : { ...empty });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title) return alert('Title is required');
    setSaving(true);
    if (article) {
      await api.update(article.id, form);
    } else {
      await api.create({ ...form, journalistId });
    }
    setSaving(false);
    onSave();
  };

  return (
    <div className="card p-5 mb-4 border-northstar-200">
      <h3 className="font-semibold text-slate-900 mb-4">{article ? 'Edit Article' : 'Add Article'}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="form-label">Title *</label>
          <input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} />
        </div>
        <div>
          <label className="form-label">URL</label>
          <input className="form-input" value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://" />
        </div>
        <div>
          <label className="form-label">Publish Date</label>
          <input className="form-input" type="date" value={form.publishDate} onChange={e => set('publishDate', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Topic</label>
          <input className="form-input" value={form.topic} onChange={e => set('topic', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Story Type</label>
          <input className="form-input" value={form.storyType} onChange={e => set('storyType', e.target.value)} placeholder="Feature, News, Opinion..." />
        </div>
        <div className="col-span-2">
          <label className="form-label">Summary</label>
          <textarea className="form-textarea" rows={2} value={form.summary} onChange={e => set('summary', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Relevance to North Star</label>
          <textarea className="form-textarea" rows={2} value={form.relevanceToNorthStar} onChange={e => set('relevanceToNorthStar', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Useful Angle</label>
          <textarea className="form-textarea" rows={2} value={form.usefulAngle} onChange={e => set('usefulAngle', e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Article'}</button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
