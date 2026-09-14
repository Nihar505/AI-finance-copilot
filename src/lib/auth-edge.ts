export const SESSION_COOKIE_NAME = 'copilot_session';

export interface EdgeSessionPayload {
  userId: string;
  userName: string;
  userEmail: string;
  role: string;
  orgId: string;
  exp: number; // Unix epoch ms
}

function base64urlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function verifySessionEdge(
  token: string | null | undefined,
  secret: string | undefined = process.env.SESSION_SECRET
): Promise<EdgeSessionPayload | null> {
  if (!token || typeof token !== 'string') return null;
  // A public development key must never become a production credential.
  if (process.env.NODE_ENV === 'production' && !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, signature] = parts;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret || 'ai-finance-copilot-dev-secret-hmac-key-2026'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = base64urlDecode(signature);
    const bodyBytes = encoder.encode(body);
    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes as unknown as BufferSource, bodyBytes as unknown as BufferSource);
    if (!isValid) return null;

    const payloadJson = new TextDecoder().decode(base64urlDecode(body));
    const payload: EdgeSessionPayload = JSON.parse(payloadJson);
    if (Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
