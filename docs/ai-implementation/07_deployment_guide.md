# 07 — Deployment Guide

1. Set all env vars (Slack + Redis + Zoho + Sheets + optional AI).  
2. Deploy Next.js app (Vercel recommended — uses `waitUntil` from `@vercel/functions`).  
3. Configure Slack Event/Interactivity URLs to production HTTPS.  
4. Ensure holiday Redis cache is warm (`/api/cron/refresh-holidays` or Friday reminder).  
5. Smoke test: DM bot “help”, “what did I log this week?”, then a confirmed add on a non-leave day.

## Production debug routes

`/api/debug/*` requires `Authorization: Bearer ${CRON_SECRET}` when `NODE_ENV=production`.
