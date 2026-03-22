const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

const gbpTight = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats amounts in GBP (£). Used for paper/live quote currency and spot prices (BTC-GBP). */
export function fmtGbp(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return gbp.format(Number(n));
}

/** GBP with exactly two decimal places (e.g. tables and debrief). */
export function fmtGbpFixed(n: number): string {
  return gbpTight.format(n);
}

/** Spot-style GBP: extra decimals when price is below £1 (e.g. alts). */
export function fmtGbpSpot(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const maxFrac = n >= 1000 ? 2 : n >= 1 ? 2 : 4;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: maxFrac,
    maximumFractionDigits: maxFrac,
  }).format(n);
}

/** Compact £ ticks for chart axes (no pence). */
export function fmtGbpAxis0(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}
