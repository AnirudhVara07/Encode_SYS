import type { VigilMetrics, VigilRecentTrade } from "@/types/report";

function fmtUsd(n: number) {
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPrice(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function tradeTime(t: VigilRecentTrade) {
  if (t.time_unix == null) return "—";
  return new Date(t.time_unix * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export type MorningDebriefCardProps = {
  metrics: VigilMetrics;
  trades: VigilRecentTrade[];
  /** Left label in the card header (e.g. "Last run (simulated)") */
  sessionLabel: string;
  /** Right label in the card header (e.g. time range or "BTC · template backtest") */
  sessionRight: string;
};

/**
 * Shared “wake up to this” report surface: stat strip + recent trades table.
 */
const MorningDebriefCard = ({ metrics, trades, sessionLabel, sessionRight }: MorningDebriefCardProps) => {
  const stats = [
    { label: "P&L", value: fmtUsd(metrics.net_profit_usd), color: "text-vigil-green" },
    {
      label: "Win Rate",
      value: `${(metrics.win_rate * 100).toFixed(0)}%`,
      color: "text-foreground",
    },
    { label: "Trades", value: String(metrics.trade_count), color: "text-foreground" },
    {
      label: "Max DD",
      value: fmtUsd(-Math.abs(metrics.max_drawdown_usd)),
      color: "text-vigil-red",
    },
  ];

  const rows = trades.map((t) => {
    const abs = Math.abs(t.pnl_usd).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const pnl = `${t.pnl_usd >= 0 ? "+" : "−"}$${abs}`;
    return {
      asset: t.asset,
      action: t.action,
      time: tradeTime(t),
      price: fmtPrice(t.exit_price),
      pnl,
      win: t.win,
    };
  });

  return (
    <div className="relative rounded-2xl border border-border bg-vigil-surface overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="h-2.5 w-2.5 rounded-full bg-vigil-green" />
          <span className="font-mono text-sm">{sessionLabel}</span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">{sessionRight}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-border">
        {stats.map((s) => (
          <div key={s.label} className="px-6 py-5 border-r border-border last:border-r-0">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              {s.label}
            </div>
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
            {rows.length ? (
              rows.map((t, i) => (
                <tr key={i} className="border-b border-border/30 last:border-b-0">
                  <td className="py-3 font-medium">{t.asset}</td>
                  <td className="py-3">{t.action}</td>
                  <td className="py-3 text-muted-foreground hidden sm:table-cell">{t.time}</td>
                  <td className="py-3 text-right">{t.price}</td>
                  <td className={`py-3 text-right font-medium ${t.win ? "text-vigil-green" : "text-vigil-red"}`}>
                    {t.pnl}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="py-6 text-muted-foreground text-center">
                  No closed trades in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MorningDebriefCard;
