import { FileDown, FileText, MessageSquare, Users } from 'lucide-react';
import { exportUrl } from '../api';

export default function ExportPage() {
  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Export Data</h1>
      <p className="text-slate-500 mb-8">Download your data as CSV files for use in spreadsheets or other tools.</p>

      <div className="space-y-4">
        <ExportCard
          icon={Users}
          title="Journalists"
          description="All journalist profiles including scores, contact info, and outreach status."
          href={exportUrl('journalists')}
          filename="journalists.csv"
        />
        <ExportCard
          icon={FileText}
          title="Articles"
          description="All article records linked to journalists."
          href={exportUrl('articles')}
          filename="articles.csv"
        />
        <ExportCard
          icon={MessageSquare}
          title="Outreach Logs"
          description="All outreach history including messages, responses, and status."
          href={exportUrl('outreach')}
          filename="outreach_logs.csv"
        />
      </div>

      <div className="mt-8 card p-5 bg-slate-50">
        <h3 className="font-medium text-slate-700 mb-2">Import (TODO)</h3>
        <p className="text-sm text-slate-500">
          CSV import is planned for a future release. To add journalists in bulk, use the API directly or add them
          manually via the "Add Journalist" form. The export format matches the import format that will be supported.
        </p>
      </div>
    </div>
  );
}

function ExportCard({ icon: Icon, title, description, href, filename }: any) {
  return (
    <div className="card p-5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-northstar-50 rounded-lg flex items-center justify-center">
          <Icon className="w-5 h-5 text-northstar-600" />
        </div>
        <div>
          <div className="font-medium text-slate-900">{title}</div>
          <div className="text-sm text-slate-500">{description}</div>
        </div>
      </div>
      <a href={href} download={filename} className="btn-primary shrink-0">
        <FileDown className="w-4 h-4" /> Download CSV
      </a>
    </div>
  );
}
