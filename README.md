# Investours

Investours is a fintech platform for African investors with opportunity vetting, financial literacy tutoring, business plan generation, and financial health audits.

## Tech stack

- Vite + React + TypeScript
- Tailwind CSS + shadcn-ui
- Supabase (database, auth, Edge Functions)
- Google Gemini (`gemini-3.6-flash`) for all AI features

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

They call the Google Gemini API (`models/gemini-3.6-flash:generateContent`) using the `GEMINI_API_KEY` secret.

### Setting `GEMINI_API_KEY`

The key must be set server-side only. Never put it in frontend code or commit it to git.

1. **Local development**: add `GEMINI_API_KEY="..."` to `.env` (already git-ignored).
2. **Supabase (where the functions run)**: Dashboard > Edge Functions (or the `supabase/functions` section) > Secret management, add `GEMINI_API_KEY`.

## Deployment

The frontend is a static Vite build served on your host of choice (e.g. Vercel or Render) - no backend environment variables are needed for the client. The AI backend lives in Supabase Edge Functions, so the Gemini key is configured there, not on the static host.
