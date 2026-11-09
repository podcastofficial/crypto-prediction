# Crypto Prediction Arena (MVP)

Telegram Mini App. React + Vite (frontend), `/api` (Vercel functions), Neon Postgres.

## Setup (Hinglish)
1. Neon: new project -> SQL Editor -> `database/schema.sql` paste karke Run.
2. GitHub pe ye saare files upload karo (folders ke saath: api, lib, src, database).
3. Vercel: Add New Project -> repo import -> Framework: Vite.
   Environment Variables: DATABASE_URL, BOT_TOKEN, SESSION_SECRET, CRON_SECRET.
4. Deploy ke baad cron-job.org: har 1 minute `https://YOUR-APP.vercel.app/api/cron?key=CRON_SECRET`
5. BotFather: /newapp ya Menu Button me Vercel URL set karo.
