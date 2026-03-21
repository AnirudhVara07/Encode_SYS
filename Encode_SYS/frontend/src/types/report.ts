/** Shape of `report` from GET /api/report when status is completed */

export type VigilMetrics = {
  net_profit_usd: number;
  trade_count: number;
  win_rate: number;
  max_drawdown_usd: number;
};

export type VigilRecentTrade = {
  asset: string;
  action: string;
  time_unix: number | null;
  exit_price: number;
  entry_price: number;
  pnl_usd: number;
  win: boolean;
};

export type VigilEquityPoint = { t: number; equity_usd: number };

export type VigilTrial = {
  params: Record<string, number>;
  metrics: VigilMetrics;
};

export type VigilReport = {
  template_type: string;
  stop_loss_pct: number;
  btc_size: number;
  leverage: number;
  baseline_params: Record<string, number>;
  best_params: Record<string, number>;
  baseline_metrics: VigilMetrics;
  best_metrics: VigilMetrics;
  delta_metrics: Partial<VigilMetrics>;
  improvements_text: string;
  tried_sample: VigilTrial[];
  execution: unknown;
  data_source?: string;
  data_warning?: string | null;
  learning_duration_seconds?: number;
  learning_started_at_unix?: number;
  equity_curve_baseline?: VigilEquityPoint[] | null;
  equity_curve_best?: VigilEquityPoint[] | null;
  recent_trades_best?: VigilRecentTrade[];
};
