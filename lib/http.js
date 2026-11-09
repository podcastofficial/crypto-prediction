import { verifyToken } from './auth.js';

export function handler(fn, { auth = true, methods = ['GET'] } = {}) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
      let user = null;
      if (auth) {
        const uid = verifyToken((req.headers.authorization || '').replace(/^Bearer /, ''));
        if (!uid) return res.status(401).json({ error: 'Session expired. Reopen the app.' });
        user = { id: uid };
      }
      res.setHeader('Cache-Control', 'no-store');
      await fn(req, res, user);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Server error. Try again.' });
    }
  };
}
