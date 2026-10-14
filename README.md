# Investours

Investours is a fintech platform for African investors with opportunity vetting, financial literacy tutoring, business plan generation, and financial health audits.

## Tech stack

- Vite + React + TypeScript
- Tailwind CSS + shadcn-ui
- Supabase (database, auth, Edge Functions)
- Meta Model API (`muse-spark-1.3`) for all AI features

## Getting started

```sh
npm i
npm run dev
```

Copy the environment variables used by the frontend from `.env` (Supabase project URL + publishable key).

## AI / Edge Functions

All AI features run as Supabase Edge Functions in `supabase/functions`:

- `scam-detection` - investment scam vetting
- `financial-tutor` - AI financial tutor chat
- `business-plan` - business plan generator
- `financial-audit` - financial health audit

All AI Edge Functions call Meta's chat completions API using the `muse-spark-1.3` model and the `MODEL_API_KEY` secret. Keep the key server-side only; never put it in frontend code or commit it to git.

### Setting `MODEL_API_KEY`

1. Create an API key in the [Meta Model API dashboard](https://dev.meta.ai/).
2. **Local development**: add `MODEL_API_KEY="..."` to `.env` (already git-ignored).
3. **Supabase (where the functions run)**: Dashboard > Edge Functions > Secrets, add `MODEL_API_KEY`.

## Deployment

The frontend is a static Vite build served on your host of choice (e.g. Vercel or Render) - no backend environment variables are needed for the client. The AI backend lives in Supabase Edge Functions, so `MODEL_API_KEY` is configured there, not on the static host.
