import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useVigilUser } from "@/context/VigilUserContext";
import {
  CIVIC_REDIRECT_PATH,
  CIVIC_RETURN_TO_KEY,
  CIVIC_STATE_KEY,
  CIVIC_VERIFIER_KEY,
  sanitizeCivicReturnTo,
} from "@/lib/civicOAuth";

/** Prevents a second effect run (e.g. React Strict Mode remount) from clearing PKCE state before the first run’s async work finishes. */
let civicCallbackExchangeLockCode: string | null = null;

/**
 * OAuth redirect target: exchanges ?code for Vigil session JWT via POST /auth.
 */
const CivicCallback = () => {
  const navigate = useNavigate();
  const { setBearer, refreshProfile } = useVigilUser();
  const [message, setMessage] = useState("Signing you in…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const err = params.get("error");
      const desc = params.get("error_description");
      if (err) {
        setMessage(desc || err || "Login was cancelled or failed.");
        return;
      }
      const code = params.get("code");
      const state = params.get("state");

      if (!code || !state) {
        civicCallbackExchangeLockCode = null;
        setMessage("No authorization response. Open the app from Log In, or try again.");
        return;
      }

      if (civicCallbackExchangeLockCode === code) {
        return;
      }

      const expected = sessionStorage.getItem(CIVIC_STATE_KEY);
      const verifier = sessionStorage.getItem(CIVIC_VERIFIER_KEY);

      if (!expected || state !== expected) {
        setMessage("Invalid or missing login state. Try Log In again.");
        return;
      }
      if (!verifier) {
        setMessage("Missing PKCE verifier. Try Log In again.");
        return;
      }

      civicCallbackExchangeLockCode = code;
      sessionStorage.removeItem(CIVIC_STATE_KEY);
      sessionStorage.removeItem(CIVIC_VERIFIER_KEY);

      const redirectUri = `${window.location.origin}${CIVIC_REDIRECT_PATH}`;
      try {
        const r = await fetch("/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            redirect_uri: redirectUri,
            code_verifier: verifier,
          }),
        });
        const data = (await r.json().catch(() => ({}))) as {
          access_token?: string;
          detail?: string | { message?: string }[];
        };
        if (cancelled) {
          civicCallbackExchangeLockCode = null;
          return;
        }
        if (!r.ok) {
          civicCallbackExchangeLockCode = null;
          const d = data.detail;
          const msg =
            typeof d === "string"
              ? d
              : Array.isArray(d)
                ? JSON.stringify(d)
                : "Token exchange failed";
          setMessage(msg);
          return;
        }
        const token = typeof data.access_token === "string" ? data.access_token : "";
        if (!token) {
          civicCallbackExchangeLockCode = null;
          setMessage("No access token returned.");
          return;
        }
        setBearer(token);
        await refreshProfile();
        civicCallbackExchangeLockCode = null;
        const rawReturn = sessionStorage.getItem(CIVIC_RETURN_TO_KEY);
        sessionStorage.removeItem(CIVIC_RETURN_TO_KEY);
        const dest = sanitizeCivicReturnTo(rawReturn) ?? "/paper-trading";
        navigate(dest, { replace: true });
      } catch (e) {
        civicCallbackExchangeLockCode = null;
        if (!cancelled) {
          setMessage(e instanceof Error ? e.message : "Network error during sign-in.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, setBearer, refreshProfile]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6">
      <p className="text-sm text-muted-foreground text-center max-w-md">{message}</p>
      <Button asChild variant="outline">
        <Link to="/paper-trading">Go to Paper Trading</Link>
      </Button>
    </div>
  );
};

export default CivicCallback;
