import { q, tx } from './db.js';
import { collectPrices } from './prices.js';
import { DURATIONS, POINTS, MAX_SNAPSHOT_AGE_SEC } from './config.js';

// Cron har 1 minute pe ye chalata hai: price lo -> rounds banao -> lock -> settle
export async function tick() {
  const out = {};
  out.prices = await collectPrices();
  out.created = await ensureRounds();
  await q(`update prediction_rounds set status='open' where status='scheduled' and open_at<=now() and lock_at>now()`);
  await q(`update prediction_rounds set status='void', void_reason='missed window' where status='scheduled' and lock_at<=now()`);
  out.locked = await lockRounds();
  out.settled = await settleRounds();
  return out;
}

async function ensureRounds() {
  const { rows: coins } = await q('select id from coins where enabled');
  const now = Math.floor(Date.now() / 1000);
  let n = 0;
  for (const c of coins) {
    for (const d of DURATIONS) {
      const slot = Math.floor(now / d.sec) * d.sec;
      for (const s of [slot, slot + d.sec]) {
        if (s + d.lock <= now) continue;
        const status = s <= now ? 'open' : 'scheduled';
        const r = await q(
          `insert into prediction_rounds(coin_id,duration_sec,open_at,lock_at,close_at,status)
           values($1,$2,to_timestamp($3::double precision),to_timestamp($4::double precision),to_timestamp($5::double precision),$6)
           on conflict do nothing`,
          [c.id, d.sec, s, s + d.lock, s + d.sec, status]
        );
        n += r.rowCount;
      }
    }
  }
  return n;
}

async function voidRound(c, id, reason) {
  await c.query(`update prediction_rounds set status='void', void_reason=$2 where id=$1 and status in ('open','locked')`, [id, reason]);
  await c.query(`update predictions set status='void' where round_id=$1`, [id]);
}

// Lock: reference (opening) price = lock ke baad ka pehla fresh snapshot
async function lockRounds() {
  const { rows } = await q(`select id, coin_id, lock_at from prediction_rounds where status='open' and lock_at<=now()`);
  let n = 0;
  for (const r of rows) {
    const snap = await q(
      `select id from market_prices
       where coin_id=$1 and quality_status='ok' and received_at>=$2 and received_at>now()-make_interval(secs=>$3::int)
       order by received_at asc limit 1`,
      [r.coin_id, r.lock_at, MAX_SNAPSHOT_AGE_SEC]
    );
    if (snap.rows[0]) {
      const u = await q(`update prediction_rounds set status='locked', open_snapshot_id=$2 where id=$1 and status='open'`, [r.id, snap.rows[0].id]);
      n += u.rowCount;
    } else if (Date.parse(r.lock_at) < Date.now() - 5 * 60e3) {
      await tx((c) => voidRound(c, r.id, 'no fresh price at lock'));
    }
  }
  return n;
}

async function settleRounds() {
  const { rows } = await q(`select id from prediction_rounds where status='locked' and close_at<=now()`);
  let n = 0;
  for (const { id } of rows) {
    try {
      if (await settleOne(id)) n++;
    } catch (e) {
      console.error('settle failed', id, e);
    }
  }
  return n;
}

// Settlement: ek transaction, row lock, idempotent (ledger unique + status check)
async function settleOne(id) {
  return tx(async (c) => {
    const { rows: [r] } = await c.query(
      `select r.*, co.price_precision from prediction_rounds r join coins co on co.id=r.coin_id
       where r.id=$1 and r.status='locked' for update of r skip locked`,
      [id]
    );
    if (!r) return false;

    const { rows: [cs] } = await c.query(
      `select id from market_prices
       where coin_id=$1 and quality_status='ok' and received_at>=$2 and received_at>now()-make_interval(secs=>$3::int)
       order by received_at asc limit 1`,
      [r.coin_id, r.close_at, MAX_SNAPSHOT_AGE_SEC]
    );
    if (!cs) {
      if (Date.parse(r.close_at) < Date.now() - 15 * 60e3) {
        await voidRound(c, id, 'no valid close price');
        return true;
      }
      return false; // wait: kabhi guess nahi karte
    }

    const { rows: [o] } = await c.query(
      `select case when round(cl.price,$3::int) > round(op.price,$3::int) then 'UP'
                   when round(cl.price,$3::int) < round(op.price,$3::int) then 'DOWN'
                   else 'TIE' end as outcome,
              op.price as open_price, cl.price as close_price
       from market_prices op, market_prices cl where op.id=$1 and cl.id=$2`,
      [r.open_snapshot_id, cs.id, r.price_precision]
    );

    await c.query(`insert into prediction_results(round_id,outcome,open_price,close_price) values($1,$2,$3,$4)`, [id, o.outcome, o.open_price, o.close_price]);
    await c.query(`insert into user_stats(user_id) select user_id from predictions where round_id=$1 on conflict do nothing`, [id]);

    if (o.outcome === 'TIE') {
      await c.query(`update predictions set status='tie' where round_id=$1`, [id]);
      await c.query(
        `update user_stats s set total_predictions=total_predictions+1, ties=ties+1
         from predictions p where p.round_id=$1 and p.user_id=s.user_id`,
        [id]
      );
    } else {
      await c.query(`update predictions set status=case when direction=$2 then 'win' else 'loss' end where round_id=$1`, [id, o.outcome]);
      const ref = String(id);
      await c.query(
        `insert into points_ledger(user_id,points_type,amount,reason,reference_type,reference_id)
         select user_id,'AP',$2::int,'correct_forecast','round',$3 from predictions where round_id=$1 and status='win'
         on conflict do nothing`,
        [id, POINTS.correct.AP, ref]
      );
      await c.query(
        `insert into points_ledger(user_id,points_type,amount,reason,reference_type,reference_id)
         select user_id,'XP',$2::int,'correct_forecast','round',$3 from predictions where round_id=$1 and status='win'
         on conflict do nothing`,
        [id, POINTS.correct.XP, ref]
      );
      await c.query(
        `insert into points_ledger(user_id,points_type,amount,reason,reference_type,reference_id)
         select user_id,'XP',$2::int,'participation','round',$3 from predictions where round_id=$1 and status='loss'
         on conflict do nothing`,
        [id, POINTS.wrong.XP, ref]
      );
      await c.query(
        `update user_stats s set total_predictions=total_predictions+1, wins=wins+1,
           current_streak=current_streak+1, best_streak=greatest(best_streak,current_streak+1)
         from predictions p where p.round_id=$1 and p.user_id=s.user_id and p.status='win'`,
        [id]
      );
      await c.query(
        `update user_stats s set total_predictions=total_predictions+1, losses=losses+1, current_streak=0
         from predictions p where p.round_id=$1 and p.user_id=s.user_id and p.status='loss'`,
        [id]
      );
    }
    await c.query(`update prediction_rounds set status='settled', close_snapshot_id=$2 where id=$1`, [id, cs.id]);
    return true;
  });
}
