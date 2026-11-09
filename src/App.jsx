import { useEffect, useState, useCallback } from 'react';
import { login, setInit, getState, getHistory, predict } from './api.js';

const DUR = [
  { sec: 300, label: '5m' },
  { sec: 900, label: '15m' },
  { sec: 3600, label: '1h' },
];
const durLabel = (s) => DUR.find((d) => d.sec === s)?.label || s + 's';
const price = (p) =>
  p == null ? '—' : Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: Number(p) < 10 ? 4 : 2 });
const pad = (n) => String(n).padStart(2, '0');
const clock = (s) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${pad(m)}:${pad(x)}`;
};
const pct = (p, b) => (p && b ? ((Number(p) / Number(b) - 1) * 100) : 0);
const STATUS = { pending: 'Pending', win: 'Won', loss: 'Lost', tie: 'Tie', void: 'Void' };

export default function App() {
  const [tab, setTab] = useState('home');
  const [state, setState] = useState(null);
  const [offset, setOffset] = useState(0);
  const [err, setErr] = useState('');
  const [bonus, setBonus] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!window.Telegram?.WebApp?.initData) return;
    try {
      const s = await getState();
      setOffset(s.serverTime - Date.now());
      setState(s);
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();
    setInit(tg?.initData || '');
    (async () => {
      if (!tg?.initData) return setErr('Open this app from Telegram.');
      try {
        const j = await login();
        setBonus(j.dailyBonus);
        await load();
      } catch (e) {
        setErr(e.message);
      }
    })();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const srv = now + offset;

  return (
    <div className="app">
      {bonus > 0 && (
        <button className="toast" onClick={() => setBonus(0)}>
          Daily login bonus: +{bonus} AP
        </button>
      )}
      <main>
        {!state && <p className="muted center">{err || 'Loading…'}</p>}
        {state && err && <p className="warn">{err}</p>}
        {state && tab === 'home' && <Home state={state} />}
        {state && tab === 'arena' && <Arena state={state} srv={srv} reload={load} />}
        {state && tab === 'history' && <History />}
        <p className="foot">Free-to-play. AP and XP are virtual points with no cash value. Forecasts are game entries, not trades or investment advice.</p>
      </main>
      <nav>
        {[['home', 'Home'], ['arena', 'Arena'], ['history', 'History']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>
    </div>
  );
}

function Home({ state }) {
  const { balances, level, stats, markets, recent } = state;
  return (
    <>
      <section className="hero">
        <div>
          <span className="lbl">Arena Points</span>
          <b className="big amber">{balances.AP.toLocaleString()}</b>
        </div>
        <div className="r">
          <span className="lbl">Level {level}</span>
          <b className="mid">{balances.XP} XP</b>
        </div>
      </section>
      <section className="row3">
        <div><b>{stats.winRate}%</b><span>Win rate</span></div>
        <div><b>{stats.streak}</b><span>Win streak</span></div>
        <div><b>{stats.total}</b><span>Forecasts</span></div>
      </section>
      <h2>Markets</h2>
      <section className="list">
        {markets.map((m) => {
          const ch = pct(m.price, m.base);
          return (
            <div className="item" key={m.id}>
              <div><b>{m.symbol}</b><span className="muted"> {m.name}</span></div>
              <div className="r">
                <b>${price(m.price)}</b>
                <span className={ch >= 0 ? 'up' : 'down'}>{ch >= 0 ? '+' : ''}{ch.toFixed(2)}%</span>
              </div>
            </div>
          );
        })}
      </section>
      <h2>Recent results</h2>
      <section className="list">
        {!recent.length && <p className="muted">No forecasts yet. Open the Arena and make your first one.</p>}
        {recent.map((p) => <Result key={p.id} p={p} />)}
      </section>
    </>
  );
}

function Result({ p }) {
  return (
    <div className="item">
      <div>
        <b>{p.symbol}</b> <span className={p.direction === 'UP' ? 'up' : 'down'}>{p.direction}</span>
        <span className="muted"> · {durLabel(p.duration_sec)}</span>
      </div>
      <span className={'tag ' + p.status}>{STATUS[p.status] || p.status}</span>
    </div>
  );
}

function Arena({ state, srv, reload }) {
  const [coin, setCoin] = useState('BTC');
  const [dur, setDur] = useState(300);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const rs = state.rounds.filter((r) => r.symbol === coin && r.duration_sec === dur);
  const t = (x) => Date.parse(x);
  const round = rs.find((r) => ['open', 'scheduled'].includes(r.status) && t(r.open_at) <= srv && srv < t(r.lock_at));
  const next = rs.filter((r) => r.status === 'scheduled' && t(r.open_at) > srv).sort((a, b) => t(a.open_at) - t(b.open_at))[0];
  const waiting = rs.filter((r) => r.status === 'locked').sort((a, b) => t(a.close_at) - t(b.close_at))[0];
  const mk = state.markets.find((m) => m.symbol === coin);
  const active = state.rounds.filter((r) => r.my_direction && ['open', 'locked'].includes(r.status));

  let label = 'No round yet', target = null, canPredict = false;
  if (round) {
    label = 'Forecasts close in'; target = round.lock_at; canPredict = !round.my_direction;
  } else if (next) {
    label = 'Next round opens in'; target = next.open_at;
  }

  async function submit() {
    setBusy(true);
    try {
      await predict(confirm.round.id, confirm.dir);
      setMsg('Forecast submitted.');
      await reload();
    } catch (e) {
      setMsg(e.message);
    }
    setConfirm(null);
    setBusy(false);
  }

  return (
    <>
      <div className="chips">
        {state.markets.map((m) => (
          <button key={m.id} className={coin === m.symbol ? 'on' : ''} onClick={() => setCoin(m.symbol)}>{m.symbol}</button>
        ))}
      </div>
      <div className="chips">
        {DUR.map((d) => (
          <button key={d.sec} className={dur === d.sec ? 'on' : ''} onClick={() => setDur(d.sec)}>{d.label}</button>
        ))}
      </div>

      <section className="stage">
        <span className="lbl">{coin} price now</span>
        <b className="mid">${price(mk?.price)}</b>
        <span className="lbl">{label}</span>
        <b className="timer">{target ? clock((Date.parse(target) - srv) / 1000) : '--:--'}</b>
        {round && <span className="muted">Reference price is set when forecasts close.</span>}
        {round?.my_direction && <span className="mine">Your forecast: {round.my_direction}</span>}
        <div className="split">
          <button className="upb" disabled={!canPredict} onClick={() => setConfirm({ round, dir: 'UP' })}>UP</button>
          <button className="downb" disabled={!canPredict} onClick={() => setConfirm({ round, dir: 'DOWN' })}>DOWN</button>
        </div>
        {msg && <p className="muted center">{msg}</p>}
        {waiting && <span className="muted small">Previous round: result in {clock((t(waiting.close_at) - srv) / 1000)} · reference ${price(waiting.open_price)}</span>}
      </section>

      <h2>Your active forecasts</h2>
      <section className="list">
        {!active.length && <p className="muted">Nothing active. Pick UP or DOWN above.</p>}
        {active.map((r) => (
          <div className="item" key={r.id}>
            <div><b>{r.symbol}</b> <span className={r.my_direction === 'UP' ? 'up' : 'down'}>{r.my_direction}</span><span className="muted"> · {durLabel(r.duration_sec)}</span></div>
            <span className="muted">{r.status === 'locked' ? `Ref $${price(r.open_price)} · ` : 'Waiting for lock · '}{clock((Date.parse(r.close_at) - srv) / 1000)}</span>
          </div>
        ))}
      </section>

      <details className="rules">
        <summary>Round rules</summary>
        <p>One forecast per round. Forecasts close at the lock time (server time). The reference price is the first verified price after lock. Close price above reference: UP wins. Below: DOWN wins. Equal at the coin's precision: tie. If price data is missing or unreliable the round is voided, never guessed.</p>
        <p>Correct forecast: +50 AP and +10 XP. Incorrect: +2 XP. Ties and void rounds give nothing.</p>
      </details>

      {confirm && (
        <div className="sheet" onClick={() => !busy && setConfirm(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h3>Confirm your forecast</h3>
            <p><b>{coin}</b> will go <b className={confirm.dir === 'UP' ? 'up' : 'down'}>{confirm.dir}</b> in the {durLabel(dur)} round.</p>
            <p className="muted">Round ends {new Date(confirm.round.close_at).toLocaleTimeString()}. You cannot change it after submitting. This is a game forecast, not a trade.</p>
            <button className="primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit Prediction'}</button>
            <button className="ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}

function History() {
  const [items, setItems] = useState(null);
  useEffect(() => { getHistory().then((j) => setItems(j.items)).catch(() => setItems([])); }, []);
  if (!items) return <p className="muted center">Loading…</p>;
  if (!items.length) return <p className="muted center">No forecasts yet. Your history will show up here.</p>;
  return (
    <section className="list">
      {items.map((p) => (
        <div className="item col" key={p.id}>
          <div className="between">
            <div><b>{p.symbol}</b> <span className={p.direction === 'UP' ? 'up' : 'down'}>{p.direction}</span><span className="muted"> · {durLabel(p.duration_sec)}</span></div>
            <span className={'tag ' + p.status}>{STATUS[p.status] || p.status}</span>
          </div>
          <span className="muted small">
            {p.open_price ? `$${price(p.open_price)} → $${price(p.close_price)}` : p.void_reason || 'Waiting for result'} · {new Date(p.accepted_at).toLocaleString()}
          </span>
        </div>
      ))}
    </section>
  );
}
