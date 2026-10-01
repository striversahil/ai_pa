import type { Bindings } from '../../worker/context';

// linkedin/post.ts — personal-profile LinkedIn posting (Share on LinkedIn +
// Sign In with OpenID Connect, scopes: openid profile w_member_social).
// OAuth tokens live ONLY in CACHE_KV (`linkedin:oauth`) — never in D1, never
// in a response body. Access tokens last 60 days; getValidToken() refreshes
// when <7 days remain (LinkedIn rotating refresh tokens).

const LI_AUTH = 'https://www.linkedin.com/oauth/v2/authorization';
const LI_TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';
const LI_USERINFO = 'https://api.linkedin.com/v2/userinfo';
const LI_API = 'https://api.linkedin.com';
const LI_VERSION = '202501';
const SCOPES = 'openid profile w_member_social';

const OAUTH_KEY = 'linkedin:oauth';
const STATE_PREFIX = 'linkedin:oauth:state:';

export function redirectUri(env: Bindings): string {
  const base = (env as any).PUBLIC_ORIGIN || 'https://founder-os-worker.connect-bui2.workers.dev';
  return `${String(base).replace(/\/$/, '')}/api/linkedin/oauth/callback`;
}

function kv(env: Bindings): KVNamespace | undefined {
  return (env as any).CACHE_KV as KVNamespace | undefined;
}

function rid(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function oauthStartUrl(env: Bindings): Promise<string> {
  const id = (env as any).LINKEDIN_CLIENT_ID as string | undefined;
  if (!id) throw new Error('LINKEDIN_CLIENT_ID not set (worker secret)');
  const state = rid();
  await kv(env)?.put(STATE_PREFIX + state, '1', { expirationTtl: 600 });
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: redirectUri(env),
    scope: SCOPES,
    state,
  });
  return `${LI_AUTH}?${q}`;
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const res = await fetch(LI_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`linkedin token exchange failed: ${j.error_description || j.error || res.status}`);
  }
  return j;
}

export async function oauthCallback(env: Bindings, code: string, state: string): Promise<{ personUrn: string }> {
  const seen = await kv(env)?.get(STATE_PREFIX + state);
  if (!seen) throw new Error('OAuth state expired or invalid — retry Connect.');
  await kv(env)?.delete(STATE_PREFIX + state);
  const id = (env as any).LINKEDIN_CLIENT_ID as string | undefined;
  const secret = (env as any).LINKEDIN_CLIENT_SECRET as string | undefined;
  if (!id || !secret) throw new Error('LINKEDIN_CLIENT_ID/SECRET not set (worker secrets)');
  const tok = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri(env),
  });
  // openid `sub` is the person id → author URN.
  const me = await fetch(LI_USERINFO, { headers: { Authorization: `Bearer ${tok.access_token}` } })
    .then((r) => r.json()).catch(() => ({}));
  if (!me?.sub) throw new Error('linkedin userinfo failed — re-authorize with profile scope');
  const personUrn = `urn:li:person:${me.sub}`;
  await kv(env)?.put(OAUTH_KEY, JSON.stringify({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || null,
    expires_at: Date.now() + (Number(tok.expires_in) || 5184000) * 1000,
    person_urn: personUrn,
  }));
  return { personUrn };
}

async function getValidToken(env: Bindings): Promise<{ access: string; personUrn: string }> {
  const raw = await kv(env)?.get(OAUTH_KEY);
  if (!raw) throw new Error('LinkedIn not connected — hit Connect LinkedIn first.');
  const t = JSON.parse(raw);
  if (t.expires_at - Date.now() > 7 * 86400000) return { access: t.access_token, personUrn: t.person_urn };
  // Refresh (rotating — store the new pair).
  const id = (env as any).LINKEDIN_CLIENT_ID as string | undefined;
  const secret = (env as any).LINKEDIN_CLIENT_SECRET as string | undefined;
  if (!t.refresh_token || !id || !secret) throw new Error('LinkedIn session expired — reconnect.');
  const tok = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
    client_id: id,
    client_secret: secret,
  });
  const next = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || t.refresh_token,
    expires_at: Date.now() + (Number(tok.expires_in) || 5184000) * 1000,
    person_urn: t.person_urn,
  };
  await kv(env)?.put(OAUTH_KEY, JSON.stringify(next));
  return { access: next.access_token, personUrn: next.person_urn };
}

function liHeaders(access: string): Record<string, string> {
  return {
    Authorization: `Bearer ${access}`,
    'LinkedIn-Version': LI_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
  };
}

async function uploadImage(access: string, ownerUrn: string, bytes: Uint8Array): Promise<string> {
  const init = await fetch(`${LI_API}/rest/images?action=initializeUpload`, {
    method: 'POST',
    headers: liHeaders(access),
    body: JSON.stringify({
      owner: ownerUrn,
      fileSizeBytes: bytes.length,
      uploadCaptions: { text: 'BUI founder post visual' },
      uploadThumbnail: false,
    }),
  }).then((r) => r.json());
  const up = init?.value;
  if (!up?.uploadUrl || !up?.image) throw new Error(`linkedin image init failed: ${JSON.stringify(init).slice(0, 200)}`);
  const put = await fetch(up.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: bytes as any,
  });
  if (!put.ok) throw new Error(`linkedin image upload failed: ${put.status}`);
  return String(up.image);
}

/** Publish text (+ optional PNG) to the connected personal profile. */
export async function publishPost(
  env: Bindings,
  text: string,
  imageBytes?: Uint8Array | null,
): Promise<{ urn: string; url: string }> {
  const { access, personUrn } = await getValidToken(env);
  let imageUrn: string | null = null;
  if (imageBytes && imageBytes.length > 1000) {
    imageUrn = await uploadImage(access, personUrn, imageBytes);
  }
  const body: any = {
    author: personUrn,
    commentary: String(text).slice(0, 2900),
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  if (imageUrn) {
    body.content = { title: 'BUI founder post visual', contentEntities: [{ entity: imageUrn }], shareMediaCategory: 'IMAGE' };
  }
  const res = await fetch(`${LI_API}/rest/posts`, {
    method: 'POST',
    headers: liHeaders(access),
    body: JSON.stringify(body),
  });
  const restliId = res.headers.get('x-restli-id');
  const respText = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`linkedin publish failed (${res.status}): ${respText.slice(0, 300)}`);
  const urn = restliId || respText.slice(0, 120);
  return { urn, url: `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}` };
}

/** Connection status for the dashboard pill (no secrets leak). */
export async function connectionStatus(env: Bindings): Promise<{ connected: boolean; expiresAt: number | null }> {
  const raw = await kv(env)?.get(OAUTH_KEY).catch(() => null);
  if (!raw) return { connected: false, expiresAt: null };
  try {
    const t = JSON.parse(raw);
    return { connected: Date.now() < t.expires_at, expiresAt: Number(t.expires_at) || null };
  } catch {
    return { connected: false, expiresAt: null };
  }
}
