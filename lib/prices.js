import { q } from './db.js';

const timeout = () => AbortSignal.timeout(8000);

async function fromCoinGecko(coins) {
  const ids = coins.map((c) => c.cg_id).join(',');
  const r = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_last_updated_at=true`,
    { signal: timeout(), headers: { accept: 'application/json' } }
  );
  if (!r.ok) throw new Error('coingecko ' + r.status);
  const j = await r.json();
  const out = {};
  for (const c of coins) {
    const d = j[c.cg_id];
    if (d && d.usd > 0) out[c.symbol] = { price: d.usd, time: d.last_updated_at ? new Date(d.last_updated_at * 1000) : null };
  }
  if (!Object.keys(out).length) throw new Error('coingecko empty');
  return out;
}

async function fromCoinbase(coins) {
  const out = {};
  await Promise.all(
    coins.map(async (c) => {
      const r = await fetch(`https://api.coinbase.com/v2/prices/${c.symbol}-USD/spot`, { signal: timeout() });
      if (!r.ok) return;
      const j = await r.json();
      const p = Number(j?.data?.amount);
      if (p > 0) out[c.symbol] = { price: p, time: null };
    })
  );
  if (!Object.keys(out).length) throw new Error('coinbase empty');
  return out;
}

export async function collectPrices() {
  const { rows: coins } = await q('select id, symbol, cg_id from coins where enabled');
  let data, provider;
  try {
    data = await fromCoinGecko(coins);
    provider = 'coingecko';
  } catch (e1) {
    try {
      data = await fromCoinbase(coins);
      provider = 'coinbase';
    } catch (e2) {
      return { ok: false, error: `${e1.message} | ${e2.message}` };
    }
  }
  let saved = 0;
  let suspect = 0;
  for (const c of coins) {
    const d = data[c.symbol];
    if (!d) continue;
    // suspicious jump guard: pichle 10 min ke price se >10% fark => 'suspect' (settlement mein use nahi hoga)
    const { rows } = await q(
      `select price from market_prices where coin_id=$1 and quality_status='ok' and received_at>now()-interval '10 minutes' order by received_at desc limit 1`,
      [c.id]
    );
    let quality = 'ok';
    if (rows[0] && Math.abs(d.price / Number(rows[0].price) - 1) > 0.1) quality = 'suspect';
    await q(
      `insert into market_prices(coin_id, price, provider, source_time, quality_status) values($1,$2,$3,$4,$5)`,
      [c.id, d.price, provider, d.time, quality]
    );
    saved++;
    if (quality === 'suspect') suspect++;
  }
  return { ok: true, provider, saved, suspect };
}
