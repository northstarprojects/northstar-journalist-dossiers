export default function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    'Not Started': 'bg-slate-100 text-slate-600',
    'Researching': 'bg-purple-100 text-purple-700',
    'Ready to Pitch': 'bg-blue-100 text-blue-700',
    'Pitched': 'bg-yellow-100 text-yellow-700',
    'Responded': 'bg-green-100 text-green-700',
    'In Conversation': 'bg-emerald-100 text-emerald-700',
    'Covered': 'bg-teal-100 text-teal-700',
    'Not a Fit': 'bg-red-100 text-red-600',
    'On Hold': 'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles['Not Started']}`}>
      {status || 'Not Started'}
    </span>
  );
}
