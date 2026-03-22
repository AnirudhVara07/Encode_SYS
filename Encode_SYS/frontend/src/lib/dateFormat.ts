/** British (en-GB): dd/mm/yy dates; 24h times where a clock is shown. */
export const DATE_LOCALE = "en-GB" as const;

const dateOnly: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
};

const dateAndTime: Intl.DateTimeFormatOptions = {
  ...dateOnly,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

const timeOnly: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

/** Unix seconds or milliseconds → milliseconds. */
export function timestampToMs(tsOrMs: number): number {
  if (!Number.isFinite(tsOrMs)) return NaN;
  return tsOrMs > 1e12 ? tsOrMs : tsOrMs * 1000;
}

export function formatDateGb(input: Date | number): string {
  const d = input instanceof Date ? input : new Date(timestampToMs(input));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(DATE_LOCALE, dateOnly);
}

export function formatDateTimeGb(input: Date | number): string {
  const d = input instanceof Date ? input : new Date(timestampToMs(input));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(DATE_LOCALE, dateAndTime);
}

export function formatTimeGb(input: Date | number): string {
  const d = input instanceof Date ? input : new Date(timestampToMs(input));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(DATE_LOCALE, timeOnly);
}

/** ISO 8601 strings from APIs → dd/mm/yy (date only). */
export function formatDateGbFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return formatDateGb(d);
}
