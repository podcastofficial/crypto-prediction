// Ek hi API: /api?action=auth | state | history | predict | cron
import { q } from '../lib/db.js';
import { verifyInitData, signToken, verifyToken } from '../lib/auth.js';
import { tick } from '../lib/rounds.js';
import { POINTS } from '../lib/config.js';

async function auth(req, res) {
  const tgUser = verifyInitData(req.body?.initData, process.env.BOT_TOKEN);
  if (!tgUser?.id) return res.status(401).json({ error: 'Open this app from Telegram.' });
  const { rows: [u] } = await q(
    `insert into users(telegram_id, username, first_name) values($1,$2,$3)
     on conflict (telegram_id) do update set username=excluded.username, first_name=excluded.first_name
     returning id, status, first_name, username`,
    [tgUser.id, tgUser.username || null, tgUser.first_name || null]
  );
  if (u.status !== 'active') return res.status(403).json({ error: 'Account is blocked.' });
  await q(`insert into user_stats(user_id) values($1) on conflict do nothing`, [u.id]);
  const bonus = await q(
    `insert into points_ledger(user_id,points_type,amount,reason,reference_type,reference_id)
     values($1,'AP',$2,'daily_login','date', to_char(now() at time zone 'utc','YYYY-MM-DD'))
     on conflict do nothing returning id`,
    [u.id, POINTS.dailyLogin.AP]
  );
  res.status(200).json({
    token: signToken(u.id),
    user: { name: u.first_name || u.username || 'Player' },
    dailyBonus: bonus.rowCount ? POINTS.dailyLogin.AP : 0,
  });
}

async function state(req, res, user) {
  const [bal, stats, markets, rounds, recent] = await Promise.all([
    q(`select points_type, coalesce(sum(amount),0)::int as total from points_ledger where user_id=$1 group by 1`, [user.id]),
    q(`select * from user_stats where user_id=$1`, [user.id]),
    q(`select c.id, c.symbol, c.name, c.price_precision,
        (select price from market_prices m where m.coin_id=c.id and m.quality_status='ok' order by received_at desc limit 1) as price,
        (select received_at from market_prices m where m.coin_id=c.id and m.quality_status='ok' order by received_at desc limit 1) as price_time,
        (select price from market_prices m where m.coin_id=c.id and m.quality_status='ok' and received_at>now()-interval '24 hours' order by received_at asc limit 1) as base
       from coins c where c.enabled order by c.id`),
    q(`select r.id, r.coin_id, c.symbol, r.duration_sec, r.open_at, r.lock_at, r.close_at, r.status,
        op.price as open_price, p.direction as my_direction
       from prediction_rounds r
       join coins c on c.id=r.coin_id
       left join market_prices op on op.id=r.open_snapshot_id
       left join predictions p on p.round_id=r.id and p.user_id=$1
       where r.status in ('open','locked') or (r.status='scheduled' and r.open_at<now()+interval '20 minutes')
       order by r.close_at`, [user.id]),
    q(`select p.id, p.direction, p.status, c.symbol, r.duration_sec, pr.open_price, pr.close_price, p.accepted_at
       from predictions p join prediction_rounds r on r.id=p.round_id join coins c on c.id=r.coin_id
       left join prediction_results pr on pr.round_id=r.id
       where p.user_id=$1 order by p.accepted_at desc limit 5`, [user.id]),
  ]);
  const balances = { AP: 0, XP: 0 };
  bal.rows.forEach((b) => (balances[b.points_type] = b.total));
  const s = stats.rows[0] || {};
  const decided = (s.wins || 0) + (s.losses || 0);
  res.status(200).json({
    serverTime: Date.now(),
    balances,
    level: Math.floor(balances.XP / 100) + 1,
    stats: {
      total: s.total_predictions || 0, wins: s.wins || 0, losses: s.losses || 0, ties: s.ties || 0,
      streak: s.current_streak || 0, best: s.best_streak || 0,
      winRate: decided ? Math.round(((s.wins || 0) / decided) * 100) : 0,
    },
    markets: markets.rows,
    rounds: rounds.rows,
    recent: recent.rows,
  });
}

async function history(req, res, user) {
  const { rows } = await q(
    `select p.id, p.direction, p.status, p.accepted_at, c.symbol, r.duration_sec, r.status as round_status, r.void_reason,
            pr.outcome, pr.open_price, pr.close_price
     from predictions p
     join prediction_rounds r on r.id=p.round_id
     join coins c on c.id=r.coin_id
     left join prediction_results pr on pr.round_id=r.id
     where p.user_id=$1 order by p.accepted_at desc limit 50`,
    [user.id]
  );
  res.status(200).json({ items: rows });
}

async function predict(req, res, user) {
  const roundId = Number(req.body?.round_id);
  const direction = req.body?.direction;
  if (!Number.isInteger(roundId) || !['UP', 'DOWN'].includes(direction)) {
    return res.status(400).json({ error: 'Invalid prediction.' });
  }
  const ins = await q(
    `insert into predictions(user_id, round_id, direction)
     select $1, r.id, $3 from prediction_rounds r
     where r.id=$2 and r.status in ('open','scheduled') and now() >= r.open_at and now() < r.lock_at
       and exists (select 1 from users u where u.id=$1 and u.status='active')
     on conflict (user_id, round_id) do nothing
     returning id, accepted_at`,
    [user.id, roundId, direction]
  );
  if (ins.rows[0]) return res.status(200).json({ ok: true, id: ins.rows[0].id, accepted_at: ins.rows[0].accepted_at });
  const ex = await q(`select 1 from predictions where user_id=$1 and round_id=$2`, [user.id, roundId]);
  if (ex.rowCount) return res.status(409).json({ error: 'You already submitted a forecast for this round.' });
  return res.status(409).json({ error: 'This round is closed for new forecasts.' });
}

async function cron(req, res) {
  const out = await tick();
  res.status(200).json({ ok: true, ...out });
}

// mode: public (koi login nahi), user (token chahiye), cron (CRON_SECRET chahiye)
const ACTIONS = {
  auth: { method: 'POST', mode: 'public', run: auth },
  state: { method: 'GET', mode: 'user', run: state },
  history: { method: 'GET', mode: 'user', run: history },
  predict: { method: 'POST', mode: 'user', run: predict },
  cron: { method: 'GET', mode: 'cron', run: cron },
};

export default async function handler(req, res) {
  try {
    const a = ACTIONS[req.query.action];
    if (!a) return res.status(404).json({ error: 'Unknown action' });
    if (req.method !== a.method) return res.status(405).json({ error: 'Method not allowed' });
    res.setHeader('Cache-Control', 'no-store');
    let user = null;
    if (a.mode === 'user') {
      const uid = verifyToken((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!uid) return res.status(401).json({ error: 'Session expired. Reopen the app.' });
      user = { id: uid };
    }
    if (a.mode === 'cron') {
      const key = req.query.key || (req.headers.authorization || '').replace(/^Bearer /, '');
      if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    }
    await a.run(req, res, user);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error. Try again.' });
  }
}
