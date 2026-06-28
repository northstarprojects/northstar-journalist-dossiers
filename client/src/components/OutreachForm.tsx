import { useState } from 'react';
import { outreach as api } from '../api';
import type { OutreachLog } from '../types';

interface Props {
  journalistId: number;
  log: OutreachLog | null;
  onSave: () => void;
  onCancel: () => void;
}

const STATUSES = ['Draft', 'Sent', 'No Response', 'Responded', 'Meeting Scheduled', 'Covered', 'Declined', 'Not a Fit'];
const CHANNELS = ['Email', 'Twitter/X', 'LinkedIn', 'Phone', 'In-Person', 'Other'];
const MSG_TYPES = ['Initial Pitch', 'Follow-up', 'Thank You', 'Media Brief', 'Press Release', 'Story Tip', 'Other'];

const empty = {
  date: new Date().toISOString().split('T')[0],
  channel: '', messageType: '', subjectLine: '', messageBody: '',
  response: '', status: 'Draft', nextStep: '',
};

export default function OutreachForm({ journalistId, log, onSave, onCancel }: Props) {
  const [form, setForm] = useState(log ? { ...log } : { ...empty });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    if (log) {
      await api.update(log.id, form);
    } else {
      await api.create({ ...form, journalistId });
    }
    setSaving(false);
    onSave();
  };

  return (
    <div className="card p-5 mb-4 border-northstar-200">
      <h3 className="font-semibold text-slate-900 mb-4">{log ? 'Edit Outreach Log' : 'Log Outreach'}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label">Date</label>
          <input className="form-input" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Status</label>
          <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Channel</label>
          <select className="form-select" value={form.channel} onChange={e => set('channel', e.target.value)}>
            <option value="">Select...</option>
            {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Message Type</label>
          <select className="form-select" value={form.messageType} onChange={e => set('messageType', e.target.value)}>
            <option value="">Select...</option>
            {MSG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="form-label">Subject Line</label>
          <input className="form-input" value={form.subjectLine} onChange={e => set('subjectLine', e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="form-label">Message Body</label>
          <textarea className="form-textarea" rows={4} value={form.messageBody} onChange={e => set('messageBody', e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="form-label">Response Received</label>
          <textarea className="form-textarea" rows={2} value={form.response} onChange={e => set('response', e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="form-label">Next Step</label>
          <input className="form-input" value={form.nextStep} onChange={e => set('nextStep', e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Log'}</button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
