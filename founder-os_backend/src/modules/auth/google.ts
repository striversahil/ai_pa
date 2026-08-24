// Google OAuth2 helpers — pure `fetch`, so they run unchanged on the Cloudflare
// Worker and the Express server. No Node-only deps.

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export function buildGoogleAuthUrl(cfg: GoogleConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleProfile {
  email: string;
  name: string;
  picture: string | null;
}

export async function exchangeGoogleCode(cfg: GoogleConfig, code: string): Promise<GoogleProfile> {
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: cfg.redirectUri,
    }).toString(),
  });
  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed: ${tokenRes.status}`);
  }
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("Google token exchange returned no access_token");

  const infoRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!infoRes.ok) throw new Error(`Google userinfo failed: ${infoRes.status}`);
  const info = (await infoRes.json()) as {
    email?: string;
    name?: string;
    picture?: string;
    email_verified?: boolean;
  };
  if (!info.email || info.email_verified === false) {
    throw new Error("Google account has no verified email");
  }
  return { email: info.email, name: info.name || info.email, picture: info.picture ?? null };
}
