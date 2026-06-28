export default function TierBadge({ tier }: { tier: number }) {
  const styles: Record<number, string> = {
    1: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    2: 'bg-blue-100 text-blue-800 border-blue-200',
    3: 'bg-slate-100 text-slate-700 border-slate-200',
    4: 'bg-slate-50 text-slate-500 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${styles[tier] || styles[4]}`}>
      Tier {tier}
    </span>
  );
}
