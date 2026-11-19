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

`npm run lint` currently exits non-zero on pre-existing `react-hooks/set-state-in-effect`
errors in `components/code-dialog.tsx` (×2).
There are also pre-existing warnings: `@next/next/no-img-element` for the deliberate raw
`<img>` tags in `components/media-card.tsx` / `components/preview-dialog.tsx`, and an
unused `MAX_PAGE_SIZE` in `lib/shopify.ts`. Don't treat these as regressions — but don't
add new ones either: setState inside effects must go through promise/event callbacks,
never synchronously (see `hooks/use-mounted.ts` and the `refreshTargetTypes` pattern in
`components/metaobject-migration.tsx`).

## Architecture

### Request flow

The download feature is a client page plus two route handlers:

1. **`app/page.tsx`** — the main `"use client"` page holding feature state (parsed file
   list, selection, preview, error). API credentials are read from the shared store
   config (`lib/stores.ts`) at mount — business pages carry no config UI. Parsing lives
   in `lib/parse.ts`; step panels and dialogs live in `components/`.
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

### Credentials (`lib/stores.ts` + the `/config` page)

API credentials are managed on their own page (`app/config/page.tsx` +
`components/store-config.tsx`): one **unified store list** (localStorage key
`shopify-video-downloader-stores`, entries `{ id, name, domain, token }`) plus two
pointers, `shopify-video-downloader-current-source` / `-current-target` (store ids).
A store holds at most one role — checking one role evicts the store's other
role (the pointer setters cross-clear on collision; legacy collisions keep 源).
Business pages (`app/page.tsx`, `app/metaobjects/page.tsx`,
`app/metafields/page.tsx`) carry **no config UI** —
they read `getCurrentSource()` / `getCurrentTarget()` at mount and never change them;
to switch stores the user goes to 店铺配置. Legacy source/target list keys are merged
into the unified list on first read (`ensureMigrated`), so old setups keep working.

Each store's domain and token are entered in the browser, kept in `localStorage`
(keys prefixed `shopify-video-downloader-`), and sent to the route handlers in each
POST body. There is no server-side session, database, or env-var config — the server
is stateless and the token is used only to call the Shopify Admin API for that
request, with `X-Shopify-Access-Token`. The Shopify API version is
hardcoded to `2024-01` in both routes.

Consequently, requests proxy a user-supplied token to a user-supplied domain. Keep it
that way, and never log the token value. The token header belongs only on Admin API
calls — the CDN is public read, so the download `fetch` deliberately sends no
`X-Shopify-Access-Token`.

### Metafield migration (`lib/metafields.ts` + `app/api/shopify-metafields`)

Product/variant metafield migration lives on `app/metafields/page.tsx` (nav
产品元字段); the panel is `components/metafield-migration.tsx`. Same conventions
as metaobject migration: streaming NDJSON with **one line per checked definition
(failures included)**, writes through `mapWithConcurrency` (at 4), results
scoped to the checked items.

Migration copies only the **definitions** (namespace/key/type/name/…) to the
target — missing ones are created, existing ones reported as "skipped".
**Field values on products/variants are deliberately NOT migrated**: value
migration needs cross-store product/variant alignment and is out of scope —
don't quietly reintroduce it.

Schema facts (2024-01):

- **`MetafieldOwnerType` uses `PRODUCTVARIANT`**, not `VARIANT` — a wrong enum
  value rejects the whole variable with "provided invalid value". The internal
  model stays PRODUCT/VARIANT and `WIRE_OWNER_TYPE` maps at the GraphQL boundary.
- **Never give the definition-create mutation a typed variable.** In 2024-01 the
  input type is *not* `MetafieldDefinitionCreateInput` ("isn't a defined input
  type") and the payload's definition field is *not* `metafieldDefinition`.
  `buildDefinitionCreateMutation` inlines the `definition:` literal (schema
  infers the type) and selects only `userErrors` — don't "tidy" it back into
  `$definition: SomeInput!`.
- **`metafieldDefinitions(ownerType:)` is required** — PRODUCT and VARIANT are
  fetched as two queries.
- **A definition's `type` is a `MetafieldDefinitionType` object** — query with
  `type { name }` and flatten for create input (same trap as metaobject field
  definitions).
- **A definition's `validations` can carry source-store GIDs** — e.g.
  `metaobject_reference` definitions store `metaobject_definition_id` as
  `gid://shopify/MetaobjectDefinition/<source id>`, which the target rejects
  ("must be a valid metaobject definition belonging to your shop") even when the
  metaobject exists there. `migrateMetafields` remaps those by identity
  (source GID → definition `type` → target GID) and drops any other `gid://`
  validation values with a warning — same cross-store rule as metaobject refs.
- Standard metafields live in the reserved **`shopify` namespace** and are
  excluded from listing (`isSystemMetafieldDef`).

### Metaobject migration (`lib/metaobjects.ts` + `app/api/shopify-metaobjects`)

Metaobject migration (definitions + entries, source store → target store) lives
on its own full-screen route `app/metaobjects/page.tsx`, reached from the sidebar
nav (`components/app-sidebar.tsx`, shared by all pages). Credentials come from the shared
store config (`lib/stores.ts`, see above) — source = 当前源店铺, target =
当前目标店铺. The panel itself is `components/metaobject-migration.tsx`; it is
deliberately not part of the main page's step flow.

The API route has three actions: `list` returns the source store's custom
definitions and their entries as one JSON payload (Shopify's reserved system
types — `shopify--*` — are excluded at fetch time via `isSystemMetaobjectType`,
so their huge entry lists are never enumerated); `migrate` streams NDJSON —
**one line per selected entry, failures included**, same rule as
`shopify-resolve`; `target-definitions`
returns just the definition types the target store already has (the group-header
badges in the panel read this). `migrate` with `definitionsOnly: true` creates
only the missing definitions in the target (one result line per definition,
"skipped" when the type already exists) and touches no entries — the panel's
「只迁移定义」 toggle uses this. The client scopes both modes to the checked
items: in definitions-only mode it sends only the definitions whose `type`
appears among the selected entries' types.

**Never write a source-store GID into the target store.** GID numeric ranges
overlap between shops — `gid://shopify/Product/123` in the target can be a
completely unrelated resource, so a raw-copied reference silently points at the
wrong data (worse than failing). Reference fields are remapped by identity
instead: `metaobject_reference` by `type` + `handle`, `file_reference` by
filename (via `nodeMatches`, so the video-hash and decode traps above apply
too). Anything unresolvable is left empty with a per-entry warning. Other
reference kinds (product, collection, …) are skipped with a warning — there is
no reliable cross-store identity for them.

Migration is round-based (`MAX_ROUNDS`): an entry whose required reference
points at a not-yet-created entry retries on later rounds, and the final round
reports everything that is still stuck instead of leaving spinners. Missing
definitions are auto-created in the target from the source field structure;
entries whose `handle` already exists in the target are skipped. Like
`shopify-resolve`, everything goes through `mapWithConcurrency` — writes run at
`ENTRY_CONCURRENCY` (4), never `Promise.all`, never serial.

Three schema facts, verified against 2024-01 by introspection — each one makes
Shopify reject the **entire** query, so don't "simplify" any of them:

- **`MetaobjectFieldDefinition.type` is a `MetafieldDefinitionType` object**, not
  a string — the query must say `type { name }` (a bare `type` dies with "Field
  must have selections"). The definition-create input takes that `name` as a
  plain string, hence `normalizeDefinition` flattens it back. Conversely
  **`MetaobjectField.type` (on entries) IS a plain String** — rewriting it to
  `type { name }` breaks the entries query with the inverse error.
- **`QueryRoot.metaobjects(type:)` is required (`String!`)** in 2024-01. There is
  no "all types" listing — `fetchAllMetaobjectEntries` enumerates one type per
  definition (bounded concurrency). Passing `type: null` fails validation.
- Tokens without the metaobject scopes fail at **execution** time with "Access
  denied for metaobjectDefinitions field." — this is what you see after the
  query shape is already correct; the fix is scopes on the Shopify side.

### Component and styling conventions

- `components/ui/` — shadcn/ui primitives, added via
  `npx shadcn@latest add <component>`. Config uses the `base-nova` style with
  `@base-ui/react` (not Radix), so component APIs differ from older shadcn docs —
  e.g. `<DialogClose render={<button />}>` rather than `asChild`.
- `components/theme-provider.tsx` — wraps `next-themes` and registers a global hotkey:
  pressing `d` toggles dark/light, suppressed while focus is in an input, textarea,
  select, or contenteditable.
- App shell is the shadcn **dashboard-01 block**: `app/layout.tsx` wraps every
  page in `SidebarProvider` + `AppSidebar` + `SidebarInset` + `SiteHeader`
  (inside `TooltipProvider` — sidebar tooltips require it). Nav items live in
  `components/app-sidebar.tsx`; `components/site-header.tsx` is sticky and shows
  the page title plus the current source/target store chips (right side, linking
  to /config). Pages render content only — no per-page headers.
- `hooks/use-mounted.ts` — hydration-safe "client mounted" flag built on
  `useSyncExternalStore` (not effect+setState). Pages gate localStorage-derived UI
  on it to avoid SSR mismatches. `hooks/use-mobile.ts` (from the block) follows
  the same pattern.
- `lib/list-cache.ts` — session in-memory list cache keyed by source store: the
  metaobject/metafield panels render cached data instantly on re-entry and
  silently revalidate (stale-while-revalidate). Deliberately not persisted to
  localStorage — entry payloads are large and stale disk data is worse than a
  reload fetch. Panel effects must not call setState synchronously (lint): the
  auto-load wraps its work in `Promise.resolve().then(...)`.
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
