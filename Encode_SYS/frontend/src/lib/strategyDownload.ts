const _REVOKE_MS = 4000;

function triggerBlobDownload(blob: Blob, filename: string) {
  const safeName = filename.replace(/[/\\?%*:|"<>]/g, "-");
  const nav = navigator as Navigator & { msSaveOrOpenBlob?: (b: Blob, name?: string) => void };
  try {
    if (typeof nav.msSaveOrOpenBlob === "function") {
      nav.msSaveOrOpenBlob(blob, safeName);
      return;
    }
  } catch {
    /* fall through */
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName;
  a.rel = "noopener";
  a.setAttribute("download", safeName);
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, _REVOKE_MS);
}

export function downloadJsonFile(filename: string, data: unknown) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  triggerBlobDownload(blob, filename);
}

export function strategyExportFilename(prefix: string) {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${prefix}-${stamp}.json`;
}
