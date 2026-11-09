let token = sessionStorage.getItem('t') || '';
let initData = '';
export const setInit = (v) => (initData = v);

export async function login() {
  const r = await fetch('/api?action=auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Login failed');
  token = j.token;
  sessionStorage.setItem('t', token);
  return j;
}

async function req(path, opts = {}, retry = true) {
  const r = await fetch('/api?action=' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  });
  if (r.status === 401 && retry && initData) {
    await login();
    return req(path, opts, false);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

export const getState = () => req('state');
export const getHistory = () => req('history');
export const getLeaderboard = (period) => req('leaderboard&period=' + period);
export const predict = (round_id, direction) =>
  req('predict', { method: 'POST', body: JSON.stringify({ round_id, direction }) });
