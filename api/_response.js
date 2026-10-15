const SECURITY_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

export function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...SECURITY_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(error) {
  const isClientError = /^Unsupported (asset|interval):/.test(error?.message ?? '');
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : isClientError ? 400 : 500;
  return json({ error: error instanceof Error ? error.message : String(error) }, status);
}
