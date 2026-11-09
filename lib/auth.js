import crypto from 'node:crypto';

const secret = () => process.env.SESSION_SECRET || process.env.BOT_TOKEN;

// Telegram initData ko backend pe verify karna (client pe bharosa nahi)
export function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dcs = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', key).update(dcs).digest('hex');
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
  try {
    return JSON.parse(params.get('user'));
  } catch {
    return null;
  }
}

export function signToken(uid) {
  const body = Buffer.from(JSON.stringify({ u: uid, e: Date.now() + 12 * 3600e3 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  const [body, sig] = (token || '').split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.e > Date.now() ? p.u : null;
  } catch {
    return null;
  }
}
