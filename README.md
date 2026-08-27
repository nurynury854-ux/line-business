# LINE LIFF Booking

Multi-tenant LINE LIFF booking system for Taiwanese salons.

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Supabase · Vercel

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

The only route today is `/liff/booking`, which renders a placeholder.

## Scripts

| Command         | Purpose                        |
| --------------- | ------------------------------ |
| `npm run dev`   | Local dev server               |
| `npm run build` | Production build               |
| `npm start`     | Serve the production build     |
| `npm run lint`  | ESLint                         |

## Working on this project

Read [CLAUDE.md](./CLAUDE.md) first. It covers tenant isolation, the LINE
identity trust boundary, timezone handling, and mobile/i18n constraints —
and it lists the decisions that are still open.

## Deployment

Deployed on Vercel with zero configuration; Next.js is detected automatically.
Set the variables from `.env.example` in the Vercel project settings before
the first deploy.
