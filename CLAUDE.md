# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A **Shopify Asset Downloader** — a single-page tool for batch-downloading videos and
images referenced in Shopify theme templates. The user pastes a JSON blob copied from
a Shopify page/product template, the app extracts media URLs from it, resolves
`shopify://` protocol paths to real CDN URLs, and downloads the selection as a file
(single) or a ZIP (multiple).

Built on Next.js 16 App Router, React 19, TypeScript, shadcn/ui, and Tailwind CSS 4.

**All user-facing UI text is Simplified Chinese.** Keep new strings in Chinese to
match `app/page.tsx`.

## Commands

```bash
npm run dev        # Start development server
npm run build      # Production build
npm run start      # Start production server
npm run lint       # Run ESLint
npm run format     # Format code with Prettier
npm run typecheck  # TypeScript type checking (no emit)
```

There is no test framework configured — no test script, runner, or spec files.

`npm run lint` currently exits non-zero on one pre-existing error, not caused by your
change: `react-hooks/set-state-in-effect` at `app/page.tsx:252` (the `setMounted(true)`
mount guard). There are also two pre-existing `@next/next/no-img-element` warnings for
the deliberate raw `<img>` tags in `app/page.tsx`. Don't treat these as regressions.

## Architecture

### Request flow

The whole feature is one client component plus two route handlers:

1. **`app/page.tsx`** — a single ~1000-line `"use client"` component holding all state:
   API credentials, saved configs, parsed file list, selection, preview, and error.
   There are no extracted hooks or feature components; `hooks/` is empty. Parsing
   (`parseMediaUrls`), storage helpers, and inline SVG icon components all live in this
   file alongside the page.
2. **`app/api/shopify-resolve/route.ts`** — `POST`, takes the `shopify://` URLs from the
   parsed list and **streams** results back as NDJSON — one line per file, emitted the
   moment that file resolves. It has to stream: returning one payload at the end meant a
   40-file template held every spinner for the full duration and then lit up all at once.
   The client reads `response.body` line by line and updates state per line, so files
   appear one at a time. **Every entry must produce exactly one line, failures included**
   (`resolveShopifyPaths` guarantees a callback per entry) — a silent entry is a spinner
   that never stops, which is how this presented before.
3. **`app/api/shopify-videos/route.ts`** — `POST`, downloads each selected URL. Returns
   the raw bytes with a `Content-Disposition: attachment` header when one file was
   requested, or a JSZip archive when several were. The client does not distinguish:
   it just consumes `response.blob()` and names the download.

**Preview deliberately does not go through these routes.** The resolved CDN URL is
public read, so `<video src={resolvedUrl}>` / `<img src={resolvedUrl}>` load directly in
the browser — same as the thumbnails already do. That gives real range requests (video
seeking works, playback starts immediately) with no server-side buffering. Don't
"simplify" preview by proxying it through the API: that path has to download the entire
file before anything plays, which is unusable for large videos.

### The `shopify://` resolution chain

All of it lives in **`lib/shopify.ts`** — both route files are thin wrappers that only
export `POST`. `resolveShopifyFileUrl` and `batchResolve` were previously duplicated
across the two `route.ts` files and drifted into the same bug, so they are shared here
deliberately; keep the matching and source-picking logic in this one module.

`resolveShopifyFileUrl` tries three strategies in order, returning the first hit:
1. GraphQL `files` query with several search-query variants. The result is accepted
   only if `nodeMatches()` agrees — see the filename trap below.
2. REST `/admin/api/2024-01/files.json?limit=250`, matching on `alt`, `filename`, or `url`.
3. Constructed CDN URLs (`/cdn/shop/files/...`, `/cdn/shop/videos/...`), probed with
   `HEAD` and rejected if the response is an HTML error page.

The GraphQL `ACCESS_DENIED` case is special-cased to surface the missing scopes
(`read_files` / `read_content`) to the user rather than silently falling through.

**Keep `filename` / `status` inside `... on Video`.** The `File` interface exposes exactly
seven fields — `alt`, `createdAt`, `fileErrors`, `fileStatus`, `id`, `preview`,
`updatedAt` — and no `filename`. Requesting a field the schema does not have makes
GraphQL reject the **entire** query, so `data.files` comes back null and every lookup
falls through to the slow REST + HEAD path. This has been proposed twice as an
"optimization" and is strictly worse both times. Likewise `Image.originalSrc` / `src` /
`transformedSrc`: they exist but are deprecated, and `url` already returns the original
when no transform is set.

### Two traps that already caused a bug here — don't reintroduce them

**Never match a file by looking for its name in the returned CDN URL.** Image CDN URLs
preserve the filename (`/s/files/1/.../photo.png`), so URL matching appears to work —
but Shopify *video* URLs are
`/cdn/shop/videos/c/vp/<hash>/<hash>.HD-1080p-7.2Mbps.mp4`, where the name position is a
hash. A URL-based guard silently discards every video that GraphQL correctly found,
which presents as "images all work, videos all fail". `nodeMatches()` therefore matches
on `Video.filename` first; the URL check is only a fallback for types that lack it.

**Never return `sources[0]` as the download URL.** `Video.sources` contains the mp4
transcodes *and* an auto-generated `.m3u8` HLS playlist, so `sources[0]` may be a
few-KB text manifest rather than a video — it downloads "successfully" and then plays
nowhere. `pickBestVideoSource()` filters playlists out and picks the highest-resolution
transcode, falling back to `originalSource`.

Also note `sources` and `originalSource` are **empty unless `Video.status` is `READY`**,
so a still-processing video must be reported as such (the resolver returns a
"转码中" error) rather than as a missing file.

**Resolution is batched — round trips, not per-request latency, are what make it slow.**
Wall time scales with how many HTTP requests a batch needs, so the rules below all exist
to keep that number small. Each one was a real regression here and is easy to undo by
accident:

- **One request per `OR_CHUNK_SIZE` (80) files.** `batchResolve` joins the names into a
  single search — `filename:"a.mp4" OR filename:"b.mp4" OR …` — so 80 assets cost **1**
  round trip, not 80. `OR` is a documented connective in Shopify's search syntax (the
  docs show field-prefixed forms like `state:enabled OR state:disabled`), and one query
  is far cheaper than the alternative of aliasing N separate `files` queries: cost is
  billed per *requested object*, so 50 aliases at `first: 5` request 250 objects where
  one `OR` query at `first: 50` requests 50.
- **Size `first` with `pageSizeFor`, not to the max.** Each `filename:"X"` term matches
  about one file, so `count × 2` covers collisions; asking for 250 regardless just bills
  for objects you never receive.
- **Both rounds are batched.** Round two re-asks by filename stem (extension stripped,
  stems under 3 chars skipped) as another `OR` batch — not per file. The per-file REST +
  CDN probes live in `resolveShopifyPaths` and only run for whatever survives both
  rounds, with `{ skipGraphQL: true }` since GraphQL is already exhausted.
- **`claim()` marks nodes consumed.** A batched response holds every node for the whole
  chunk, so without that marker two different names can claim the same node and one of
  them silently gets nothing. Related: matching stays **exact** — a loose `includes`
  match across a shared node pool assigns file A's node to file B, which resolves the
  *wrong* file and is worse than failing.
- **Never `Promise.all` over a list of files, and never run downloads serially.** The
  first launches N full resolves (GraphQL + REST + HEAD each) at once and self-inflicts
  the throttling it then fails on; the second was a plain `for` + `await fetch` loop.
  Both go through `mapWithConcurrency`.
- **Decode URLs before matching them.** The CDN percent-encodes spaces, so an un-decoded
  comparison against `hero image.png` never matches `hero%20image.png` and the file gets
  misfiled as "not found". `nodeMatches` runs `safeDecode` first.

### Credentials

Store domain and Admin API access token are entered in the browser, kept in
`localStorage` (keys prefixed `shopify-video-downloader-`), and sent to the route
handlers in each POST body. There is no server-side session, database, or env-var
config — the server is stateless and the token is used only to call the Shopify Admin
API for that request, with `X-Shopify-Access-Token`. The Shopify API version is
hardcoded to `2024-01` in both routes.

Consequently, requests proxy a user-supplied token to a user-supplied domain. Keep it
that way, and never log the token value. The token header belongs only on Admin API
calls — the CDN is public read, so the download `fetch` deliberately sends no
`X-Shopify-Access-Token`.

### Component and styling conventions

- `components/ui/` — shadcn/ui primitives, added via
  `npx shadcn@latest add <component>`. Config uses the `base-nova` style with
  `@base-ui/react` (not Radix), so component APIs differ from older shadcn docs —
  e.g. `<DialogClose render={<button />}>` rather than `asChild`.
- `components/theme-provider.tsx` — wraps `next-themes` and registers a global hotkey:
  pressing `d` toggles dark/light, suppressed while focus is in an input, textarea,
  select, or contenteditable.
- `lib/utils.ts` — re-exports `cn` from the `cn` package.
- Theme tokens are CSS variables in oklch, defined in `app/globals.css`.
- A `.mcp.json` registers the shadcn MCP server; prefer its registry tools over
  guessing component source.

### Read the Next.js docs before writing code

This is Next.js 16, which has breaking changes from earlier versions — APIs,
conventions, and file structure may all differ from your training data. Read the
relevant guide in `node_modules/next/dist/docs/` before writing code, and heed
deprecation notices.

## Code Style

- Prettier: no semicolons, double quotes, trailing commas (es5), 80 char width
- Tailwind class sorting via `prettier-plugin-tailwindcss` (configured with
  `cn` and `cva` as class functions; stylesheet `app/globals.css`)
- TypeScript strict mode enabled
- Path alias: `@/*` maps to project root

Import components using the `@/` alias:

```tsx
import { Button } from "@/components/ui/button"
```
