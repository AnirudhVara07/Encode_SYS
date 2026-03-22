/** Session keys for Civic OAuth + PKCE (authorization code flow). */
export const CIVIC_STATE_KEY = "vigil_civic_oauth_state";
export const CIVIC_VERIFIER_KEY = "vigil_civic_pkce_verifier";
export const CIVIC_RETURN_TO_KEY = "vigil_civic_return_to";
export const CIVIC_REDIRECT_PATH = "/callback";

/** Internal path only, avoids open redirects after OAuth. */
export function sanitizeCivicReturnTo(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  let t = raw.trim();
  if (!t.startsWith("/") || t.startsWith("//")) return null;
  if (t.includes("..")) return null;
  t = t.split("#")[0]?.split("?")[0] ?? "";
  if (!t || t.length > 256) return null;
  return t;
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomVerifier(): string {
  const u = new Uint8Array(32);
  crypto.getRandomValues(u);
  return bytesToBase64Url(u.buffer);
}

async function sha256Base64Url(plain: string): Promise<string> {
  const enc = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return bytesToBase64Url(hash);
}

export type CivicOauthConfig = {
  client_id: string;
  authorize_url: string;
  scope: string;
};

export async function fetchCivicOauthConfig(): Promise<CivicOauthConfig> {
  const r = await fetch("/civic-oauth-config");
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || `Civic config failed (${r.status})`);
  }
  return r.json() as Promise<CivicOauthConfig>;
}

/**
 * Redirect browser to Civic authorize URL (PKCE S256). Call from a click handler.
 * Register redirect URI in Civic: `${window.location.origin}/callback` for each origin you use (8080 vs 8000, localhost vs 127.0.0.1).
 */
export async function startCivicLogin(options?: { returnTo?: string }): Promise<void> {
  const safe = sanitizeCivicReturnTo(options?.returnTo ?? null);
  if (safe) sessionStorage.setItem(CIVIC_RETURN_TO_KEY, safe);
  else sessionStorage.removeItem(CIVIC_RETURN_TO_KEY);

  const cfg = await fetchCivicOauthConfig();
  const redirectUri = `${window.location.origin}${CIVIC_REDIRECT_PATH}`;
  const state = randomVerifier();
  const codeVerifier = randomVerifier();
  const codeChallenge = await sha256Base64Url(codeVerifier);
  sessionStorage.setItem(CIVIC_STATE_KEY, state);
  sessionStorage.setItem(CIVIC_VERIFIER_KEY, codeVerifier);

  const u = new URL(cfg.authorize_url);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.client_id);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", cfg.scope);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  // Ask Civic to show sign-in again instead of silently reusing an existing browser session (OIDC-style).
  u.searchParams.set("prompt", "login");
  u.searchParams.set("max_age", "0");

  window.location.assign(u.toString());
}
