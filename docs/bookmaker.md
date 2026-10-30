# Bookmaker by Investours

Bookmaker turns a creator's idea into a complete ebook: free title and outline, editable
manuscript, context-aware visuals, a typographic cover, a print-ready PDF and an AI-narrated
audiobook. It shares the existing Investours credit packs and subscription allowance.

## Routes

| Route | Purpose |
| --- | --- |
| `/bookmaker` | Public marketing landing page |
| `/bookmaker/create` | Five-step wizard (idea, reader/length, outline, manuscript, design/export) |
| `/dashboard/bookmaker` | Member's saved ebooks, audiobooks, credits and PDF downloads |

The wizard accepts text or a browser voice note. A draft is kept in `localStorage` until the
free outline has been saved, so a detour to login or to buy credits never loses the idea.

## Database

Migration: `supabase/migrations/20261029000000_bookmaker_mvp.sql`
Audiobook migration: `supabase/migrations/20261030000000_bookmaker_audiobook.sql`

| Object | Purpose |
| --- | --- |
| `bookmaker_books` | One row per ebook, owned by `user_id` (RLS); `audiobook` stores narration state |
| `bookmaker_credit_operations` | Auditable ledger of every AI operation, price and refund |
| `bookmaker_subscription_credits` | Included credits granted per subscription period |
| `bookmaker-covers` storage bucket | Public cover uploads at `${userId}/${bookId}-${timestamp}.${ext}` |
| `bookmaker-audio` storage bucket | Public narration WAVs at `${userId}/${bookId}/chapter-{n}.wav` and `audiobook.wav` |

Server-authoritative RPCs:

- `bookmaker_operation_cost(operation, length)` – the only price source.
- `bookmaker_get_entitlement()` – subscription + pack balances plus the cost table.
- `bookmaker_reserve_operation(...)` – idempotent reservation, one pending operation per book,
  spends subscription credits first and then the oldest-expiring credit pack.
- `bookmaker_complete_operation(...)` – settles a reservation.
- `bookmaker_abandon_operation(...)` – refunds ungenerated chapters (service/owner path).
- `bookmaker_fail_operation(...)` – service-role refund used when an AI call fails.
- `bookmaker_record_chapter_progress(...)` – service-role progress for partial refunds.

Existing pack tables (`user_credit_packs`) remain the source of truth for purchased credits.
Bookmaker mirrors the active pack total into `profiles.audit_credits`.

## Credit schedule

| Action | Cost |
| --- | --- |
| Outline / title / chapter structure | 0 (free, still logged for idempotency) |
| Short manuscript (1,500–3,000 words, 3–5 chapters) | 2 |
| Medium manuscript (4,000–7,000 words, 6–10 chapters) | 4 |
| Long manuscript (8,000–12,000 words, 10–15 chapters) | 6 |
| Full-book regeneration | Same as the book length |
| Rewrite one chapter | 1 |
| Refresh one visual block | 1 |
| Generate a new cover | 1 |
| Audiobook narration (whole book, chapter by chapter) | 3 |
| Manual edits, uploaded covers, PDF export, audio assembly | 0 |

Subscription included credits per period: monthly 3, quarterly 6, bi-annual 9, annual 15;
B2B quarterly 6, B2B annual 15. Subscription credits are spent before packs.

### Safety rules

- The client cannot choose a price; every paid call goes through the database reservation.
- An idempotency key is unique per account. A repeated click returns the existing operation.
- Only one pending operation may exist per book (partial unique index).
- `start_manuscript` reserves the whole book once. Chapters are generated sequentially.
- `complete` is rejected unless every requested chapter has been generated.
- `abandon` refunds in proportion to chapters never written.
- An audiobook reservation is priced once for the whole book. Quote the same proportional refund
  rule: stopping early refunds chapters that were never narrated.
- A new narration pass replaces the previous voice and audio files; finished chapters are saved as
  the pass progresses, so a refresh or closed tab can resume without a second charge.
- A failed AI call invokes `bookmaker_fail_operation`, refunding the reservation.
- Approved chapters are sent as `lockedChapters` during full regeneration and are not touched.
- Re-running an already generated chapter inside a reservation is free and returns the saved copy.

## Edge function

Path: `supabase/functions/bookmaker/index.ts` · `verify_jwt = true` in `supabase/config.toml`.

AI provider: Groq `openai/gpt-oss-120b` for text. Narration uses Groq Orpheus:
`canopylabs/orpheus-v1-english` (English) and `canopylabs/orpheus-arabic-saudi` (Arabic). The
`GROQ_API_KEY` secret stays server-side and follows the same pattern as the existing AI functions.

| Action | Paid | Description |
| --- | --- | --- |
| `outline` | no | Saves the draft book, then returns title, subtitle and chapters |
| `start_manuscript` | yes | Reserves the book and returns `operationId` + `pendingChapters` (0-based indexes) |
| `resume` | no | Inspects the pending reservation without charging; returns only missing chapters |
| `chapter` | reserved | Writes one chapter inside the open reservation |
| `complete` | no | Verifies all requested chapters exist and settles the reservation |
| `abandon` | no | Stops early and refunds ungenerated chapters |
| `regenerate_chapter` | 1 | Rewrites one chapter with an optional instruction |
| `regenerate_visual` | 1 | Rewrites one `:::` visual block |
| `generate_cover` | 1 | Returns typographic/vector cover art direction |
| `start_audiobook` | yes | Reserves narration for the whole book and returns `operationId` + chapter numbers |
| `audiobook_chapter` | reserved | Narrates one chapter, uploads the WAV and records progress |
| `complete_audiobook` | no | Settles the reservation once every requested chapter has audio |
| `assemble_audiobook` | no | Joins stored chapter WAVs into one downloadable file (degraded to per-chapter on size limits) |

`generatedChapters` in responses is 1-based (the chapter numbers written). `pendingChapters` is
0-based because it is passed back as `chapterIndex` for manuscript generation; for audiobook
actions it is the 1-based chapter number.

## Audiobook

Narration is generated server-side in `supabase/functions/bookmaker/index.ts`:

1. `start_audiobook` reserves 3 credits for the whole book, pins the narrator voice and the list of
   written chapters, then clears any previous audio so a new voice replaces it cleanly.
2. `audiobook_chapter` cleans markdown down to speakable prose, splits it into ≤190-character
   chunks (Orpheus accepts at most 200 per request), requests WAV from Groq, joins the chunks with
   a short gap and uploads `chapter-{n}.wav` to the public `bookmaker-audio` bucket.
3. `complete_audiobook` verifies every requested chapter has audio and settles the reservation.
4. `assemble_audiobook` re-downloads the chapter files, joins them with a half-second gap and
   uploads `audiobook.wav`. If the combined file exceeds the bucket limit, the UI keeps
   chapter-by-chapter downloads as the fallback.

Only English and Arabic manuscripts can be narrated. Other languages still keep PDF export and the
browser's read-aloud feature. WAV keeps the implementation dependency-free but large (~3 MB per
minute at 24 kHz mono 16-bit), so chapters are downloadable individually.

## Visual markup

Chapters are markdown plus structured blocks. The parser escapes all author/AI text; only the
structured blocks render as SVG.

```md
:::callout Tip
One useful tip, warning or definition.
:::

:::keypoints Key takeaways
- Point one
- Point two
:::

:::checklist Action checklist
- [ ] Task one
- [x] Completed example
:::

:::diagram How the pieces connect
Idea -> Validation : test demand
Validation -> Launch : build the offer
:::

:::chart Monthly cash flow
Sales | 120
Costs | 45
Profit | 75
(unit: ₦'000)
:::

:::figure The customer journey
caption: A simple three-stage journey the reader can copy.
:::
```

Prompts require at least one useful visual per chapter and forbid invented statistics, studies,
quotes or sources. Charts must use supplied or clearly labelled illustrative figures. Diagrams
are limited to 3–6 nodes and charts to 3–6 bars so they remain readable on phones and A4.

## PDF export

`src/lib/bookExport.ts` builds an A4 print document with cover, title page, contents, repeated
table headers, page numbers and JavaScript pagination. Export opens a new window and uses the
browser's print dialog (`Save as PDF`). No PDF dependency is required. Enable background
graphics in the print dialog so the cover and SVG visuals print correctly.

Uploaded covers are rendered with `object-contain`, so unusual aspect ratios are never cropped
or stretched. Generated covers are typographic layouts driven by AI art direction, not photos.

## Purchase and return flow

`purchaseUrl(bookId, kind)` links to `/pricing` or `/subscribe` with `from=bookmaker` and the
book id. The wizard header, credit gate and dashboard all use it. `/pricing` forwards that target
to `/auditor/packs` and `/subscribe`, and both pages return to `checkoutReturnUrl(bookId)`
(`/bookmaker/create?book=...`) after a successful purchase. `/auth` supports an internal
`redirect` query parameter so login also returns to the same book.

## Deploy

```bash
supabase db push
supabase functions deploy bookmaker
```

Set `GROQ_API_KEY` if it is not already configured for the other AI functions. Re-run
`supabase gen types typescript` after applying the migration if you prefer generated DB types
over the manual additions in `src/integrations/supabase/types.ts`.

## Manual test checklist

1. Start an idea without signing in, continue to setup, then generate the outline → login
   prompt → draft is restored → outline appears.
2. Edit the title and chapters, save, reload the book from `/dashboard/bookmaker` → edits persist.
3. Buy enough credits, then write a short book → 2 credits are reserved, chapters appear one by
   one, and the book becomes `manuscript_ready`.
4. Reload mid-generation → “Resume writing” continues the same reservation without a second charge.
5. Stop mid-generation → ungenerated chapters are refunded.
6. Edit a chapter manually → free; approve it; run full regeneration → approved chapter is kept.
7. Rewrite a chapter and refresh a visual → 1 credit each, surrounding content unchanged.
8. Generate a cover, upload a portrait and a landscape image → no cropping or distortion.
9. Export PDF → cover, contents, headings, page numbers and visuals print on A4.
10. Generate an audiobook → 3 credits are reserved, each chapter appears with its own player and
    download, and the completed pass can be combined into one WAV.
11. Start narration, reload mid-pass → narration resumes from the narrator card without a second
    charge; stop early and confirm the unfinished chapters are refunded.
12. Switch narrator and narrate again → the previous audio is replaced and the new voice is used.
13. Double-click a paid button → only one operation is recorded.
