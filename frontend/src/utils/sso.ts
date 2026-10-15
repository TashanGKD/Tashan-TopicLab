// Only carry authentication context through login, registration and password recovery.
export function authPath(path: string, search: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const key of ['sso_client', 'sso_redirect', 'sso_state', 'sso_code_challenge', 'sso_code_challenge_method', 'openclaw_claim', 'next']) {
    const value = search.get(key);
    if (value) kept.set(key, value);
  }
  return kept.size ? `${path}?${kept}` : path;
}
