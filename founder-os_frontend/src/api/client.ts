const API_BASE = '/api';

/** Tolerate a leading "/api" so a caller passing a full path can't double
 *  the prefix (/api/api/... once 404'd every role save). */
function joinPath(path: string): string {
  return `${API_BASE}${path.startsWith('/api/') ? path.slice(4) : path}`;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(joinPath(path), {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: any) => request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: any) => request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: any) => request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
