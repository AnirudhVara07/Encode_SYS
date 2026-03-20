import { useScrollReveal } from "./useScrollReveal";

const trades = [
  { asset: "ETH", action: "Buy", time: "02:14 AM", price: "$3,847.20", pnl: "+$124.30", win: true },
  { asset: "LINK", action: "Sell", time: "03:47 AM", price: "$18.92", pnl: "+$47.85", win: true },
  { asset: "ARB", action: "Buy", time: "04:12 AM", price: "$1.34", pnl: "-$12.10", win: false },
  { asset: "SOL", action: "Sell", time: "05:30 AM", price: "$178.45", pnl: "+$89.20", win: true },
];

const PerformanceReport = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section className="relative py-32 px-6" ref={ref}>
      <div className="container mx-auto max-w-5xl">
        <div className={`text-center mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
          <span className="font-mono text-xs tracking-[0.3em] uppercase text-primary">Morning Debrief</span>
          <h2 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight">Wake up to this</h2>
        </div>

        <div className={`relative rounded-2xl border border-border bg-vigil-surface overflow-hidden transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`} style={{ transitionDelay: '200ms' }}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="h-2.5 w-2.5 rounded-full bg-vigil-green" />
              <span className="font-mono text-sm">Overnight Session</span>
            </div>
            <span className="font-mono text-xs text-muted-foreground">11:30 PM → 7:00 AM</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-border">
            {[
              { label: "P&L", value: "+$249.25", color: "text-vigil-green" },
              { label: "Win Rate", value: "75%", color: "text-foreground" },
              { label: "Trades", value: "4", color: "text-foreground" },
              { label: "Drawdown", value: "-1.2%", color: "text-vigil-red" },
            ].map((s) => (
              <div key={s.label} className="px-6 py-5 border-r border-border last:border-r-0">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{s.label}</div>
                <div className={`font-mono text-xl font-semibold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="px-6 py-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground border-b border-border/50">
                  <th className="text-left py-2 font-medium">Asset</th>
                  <th className="text-left py-2 font-medium">Action</th>
                  <th className="text-left py-2 font-medium hidden sm:table-cell">Time</th>
                  <th className="text-right py-2 font-medium">Price</th>
                  <th className="text-right py-2 font-medium">P&L</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {trades.map((t, i) => (
                  <tr key={i} className="border-b border-border/30 last:border-b-0">
                    <td className="py-3 font-medium">{t.asset}</td>
                    <td className="py-3">{t.action}</td>
                    <td className="py-3 text-muted-foreground hidden sm:table-cell">{t.time}</td>
                    <td className="py-3 text-right">{t.price}</td>
                    <td className={`py-3 text-right font-medium ${t.win ? 'text-vigil-green' : 'text-vigil-red'}`}>{t.pnl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PerformanceReport;
