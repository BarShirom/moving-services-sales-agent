/** Minimal cookie jar for HTTP tests; Node fetch does not retain browser cookies. */
export function browser() {
  let cookie = '';
  return async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('X-Demo-Request', '1');
    if (cookie) headers.set('Cookie', cookie);
    const response = await fetch(url, { ...init, headers });
    const issued = response.headers.get('set-cookie');
    if (issued) cookie = issued.split(';')[0];
    return response;
  };
}
