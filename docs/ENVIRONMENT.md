# Environment

## Local

1. PostgreSQL 14+ running
2. Copy `.env.example` → `.env.local`
3. `npm install`
4. `npx prisma migrate dev`
5. `npm run dev`

## Variables

| Name | Required | Purpose |
|------|----------|---------|
| `DATABASE_URL` | yes | PostgreSQL connection |
| `AUTH_SECRET` | yes | Auth.js secret |
| `AUTH_URL` | yes | Canonical app URL |
| `AI_PROVIDER` | no | Future provider switch (default stub) |

## Secrets

Never commit `.env` / `.env.local`. Never ship provider API keys to the browser.
