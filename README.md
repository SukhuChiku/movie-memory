

## Setup Instructions

### Prerequisites
 Node.js 18+
 PostgreSQL running locally
 A Google Cloud project with OAuth credentials
 An OpenAI API key

### 1. Clone the repository
git clone https://github.com/SukhuChiku/movie-memory. 
cd movie-memory


### 2. Install dependencies
npm install


### 3. Run database migrations
npx prisma migrate dev

### 4. Set up environment variables

### Google OAuth Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project
3. Navigate to **APIs & Services → OAuth consent screen** and configure it
4. Navigate to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Set **Authorized redirect URI** to: `http://localhost:3000/api/auth/callback/google`
6. Copy the Client ID and Client Secret into your .env file. 


## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string e.g. `postgresql://postgres:password@localhost:5432/movie_memory` |
| `AUTH_SECRET` | Random secret for NextAuth session encryption. Generate with: `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | Google OAuth Client ID from Google Cloud Console |
| `AUTH_GOOGLE_SECRET` | Google OAuth Client Secret from Google Cloud Console |
| `NEXTAUTH_URL` | Base URL of the app. Use `http://localhost:3000` for local development |
| `OPENAI_API_KEY` | OpenAI API key from platform.openai.com |. 

## Add .env file as below -

DATABASE_URL="postgresql://postgres:SOME_PASSWORD@localhost:5432/movie_memory". 
AUTH_SECRET="run this command - 'openssl rand -base64 32' and paste the output here". 
AUTH_GOOGLE_ID="YOUR-google-client-id". 
AUTH_GOOGLE_SECRET="YOUR-google-client-secret". 
OPENAI_API_KEY="YOUR-openai-api-key". 
NEXTAUTH_URL="http://localhost:3000". 





### 5. Start the development server
npm run dev


Visit http://localhost:3000

---


---

## Database Migration Steps
Migrations are managed with Prisma and committed to the repository under 'prisma/migrations/'

**Run all migrations:**
npx prisma migrate dev


**View your data in Prisma Studio:**
npx prisma studio


## Architecture Overview

### Application Flow

```
User visits /
    │
    ├── Not authenticated → Landing page with "Sign in with Google"
    │
    └── Authenticated
            │
            ├── favoriteMovie is null → /onboarding (one-time, cannot be skipped)
            │
            └── favoriteMovie is set → /dashboard
```

### Auth Flow Correctness

NextAuth v5 handles Google OAuth using the Prisma adapter with a **database session strategy**. Sessions are stored in Postgres rather than JWTs, which enables instant session revocation and keeps sensitive data server-side.

**First-time user flow:**
1. User clicks "Sign in with Google" → redirected to Google consent screen
2. On return, NextAuth creates `User`, `Account`, and `Session` records via the Prisma adapter
3. The dashboard page checks `user.favoriteMovie` — if null, redirects to `/onboarding`
4. Onboarding validates + saves the movie server-side, then redirects to `/dashboard`

**Returning user flow:**
1. Session cookie is validated against the `Session` table on every request
2. `user.favoriteMovie` is already set → dashboard loads directly

**Auth guards** are enforced inside each server component using `auth()` from NextAuth. If a session is missing, the page immediately calls `redirect("/")`. This means unauthenticated users cannot reach `/dashboard` or `/onboarding` regardless of how they navigate.

### Directory Structure

```
src/
  app/
    page.tsx                  # Landing page — redirects to dashboard if already logged in
    dashboard/page.tsx        # Main dashboard (server component — DB fetch + auth check)
    onboarding/page.tsx       # First-time movie setup (server component)
    api/
      auth/[...nextauth]/     # NextAuth catch-all handler
      onboarding/route.ts     # POST: validate + save favorite movie
      fact/route.ts           # POST: generate/cache fact | GET: fetch current fact
  components/
    OnboardingForm.tsx        # Client component: movie input + client-side validation
    MovieFact.tsx             # Client component: fact display + cache metadata badge
  lib/
    auth.ts                   # NextAuth config, Google provider, session callback
    prisma.ts                 # Prisma singleton (prevents connection exhaustion in dev)
prisma/
  schema.prisma               # DB schema
  migrations/                 # Full migration history committed to repo
src/__tests__/
  fact.test.ts                # Backend unit tests: cache logic + authorization
```

**Server vs Client component reasoning:** Pages and API routes are server-side — they own auth checks, DB queries, and all sensitive logic. `OnboardingForm` and `MovieFact` are client components only because they require interactivity (form state, button clicks, fetch calls). No secrets or DB access happen client-side.

### Data Model Quality

```prisma
User
  id                    String    (cuid)
  email                 String    (unique)
  name                  String?
  image                 String?
  emailVerified         DateTime? ← required by NextAuth Prisma adapter
  favoriteMovie         String?   ← null until onboarding; gates dashboard access
  generatingFactSince   DateTime? ← distributed lock with self-healing 30s expiry
  createdAt             DateTime

MovieFact
  id        String
  fact      String
  movie     String    ← denormalized snapshot of movie name at generation time
  userId    String    → User (foreign key, cascades on delete)
  createdAt DateTime

  @@index([userId, createdAt])
```

**Design decisions:**
- `favoriteMovie` lives on `User` — it is a 1:1 scalar value; a separate table would add a join with no benefit.
- `movie` is denormalized onto `MovieFact` so historical facts remain accurate if the user updates their favorite movie later.
- The composite index on `(userId, createdAt)` was added explicitly because the cache query always filters by `userId` and sorts by `createdAt DESC LIMIT 1`. Without it, every cache check is a full table scan.
- `generatingFactSince` is a timestamp rather than a boolean so stale locks self-heal after 30 seconds without any background job.

---

## Variant Chosen: Variant A — Backend-Focused (Caching & Correctness)

### Why Variant A?

Variant A addresses the hardest correctness problems in a backend system — cache consistency, concurrency safety, and graceful degradation. These requirements are concrete and verifiable, making it straightforward to implement them confidently and explain the decisions clearly.

---

## Variant A: Full Implementation Detail

### Requirement 1 :60-Second Cache Window 

On every `POST /api/fact`, the most recent `MovieFact` for the user is fetched first. Its `createdAt` is compared against `Date.now()`. If the age is under 60,000ms, the cached fact is returned immediately:

```json
{ "fact": "...", "cached": true, "expiresInSeconds": 34 }
```

No OpenAI call is made. This is the hot path for the majority of requests.

### Requirement 2 : Burst / Idempotency Protection ✅

A `generatingFactSince DateTime?` field on `User` acts as a distributed lock. It is set before calling OpenAI and always cleared in a `finally` block.

**Why a DB field and not in-memory:** An in-memory variable only exists in one Node.js process. Multiple browser tabs or serverless instances would each see `null` and call OpenAI simultaneously. The DB field is shared across all instances.

**Why a timestamp and not a boolean:** A boolean lock permanently blocks the user if the server crashes before `finally` runs. The timestamp allows any subsequent request to treat locks older than 30 seconds as stale and proceed — self-healing without any cron.

**Known limitation:** There is a small race window between reading `generatingFactSince` and writing it. Two simultaneous requests could both see no active lock. The production fix is an atomic `UPDATE ... WHERE generatingFactSince IS NULL RETURNING id`. At this scale the current approach is acceptable and the tradeoff is documented.

### Requirement 3 : Failure Handling ✅

OpenAI calls are wrapped in `Promise.race` with a 10-second timeout. The `catch` block handles two cases:

- **Cached fact exists** → return it with `fallback: true` (frontend shows a warning badge)
- **No cached fact** → return HTTP 503 with a user-friendly error message

The `finally` block always releases the lock, preventing permanent lockout on error.

### Requirement 4 : Backend Tests ✅

Tests in `src/__tests__/fact.test.ts` cover:

- Cache window boundary conditions (30s, 59s, 61s, 90s)
- `expiresInSeconds` calculation accuracy
- Authorization: DB query scoped to `userId` — users cannot read another user's facts

npm test


---

## Security & Authorization

**All API routes require authentication.** Every handler starts with:

```typescript
const session = await auth();
if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

**All DB queries are scoped to the authenticated user.** Facts are always fetched with `WHERE userId = session.user.id`. It is not possible for a user to read or generate facts for another user.

**No secrets are exposed to the client.** `OPENAI_API_KEY`, `AUTH_SECRET`, and `DATABASE_URL` are used only in server-side files. None use the `NEXT_PUBLIC_` prefix.

**Input sanitization.** Movie names are trimmed, length-validated (1–100 chars), and have double-quote characters replaced with single quotes before storage or use in the OpenAI prompt — preventing prompt injection via crafted input.

**Graceful handling of missing profile data.** Google accounts do not always return a name or photo. The dashboard renders a fallback initial avatar and falls back to email if name is null.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Unauthenticated request to any API route | 401 Unauthorized |
| Movie name missing or too long | 400 Bad Request with descriptive message |
| Generation already in progress | Return cached fact or 429 |
| OpenAI timeout (>10s) | Return cached fact if exists, otherwise 503 |
| OpenAI API error | Return cached fact if exists, otherwise 503 |
| Server crash during generation | Lock self-heals after 30s, user can retry |
| Missing Google photo | Fallback initial-letter avatar |
| Missing Google name | Falls back to email address |



## Key Tradeoffs

| Decision | Why | Cost |
|---|---|---|
| DB-level lock vs in-memory | Works across tabs and server instances | Extra DB write on every generation |
| Timestamp lock vs boolean | Self-healing on crash, no cron needed | Slightly more complex lock-age logic |
| Cache at DB layer vs Redis | No extra infrastructure required | Higher latency than Redis for cache reads |
| `Promise.race` for timeout | Simple, no SDK dependency | OpenAI SDK connection may continue in background |
| Database sessions vs JWT | Instant revocation, no token leakage | Extra DB query per request |
| gpt-4o-mini vs gpt-4o | Lower cost, faster response | Slightly less sophisticated output |
| Denormalize `movie` on `MovieFact` | Historical accuracy if user changes movie | Minor data duplication |

---

## What I Would Improve With 2 More Hours

1. **Atomic lock acquisition** — Replace read-then-write with `UPDATE ... WHERE generatingFactSince IS NULL OR generatingFactSince < NOW() - INTERVAL '30 seconds' RETURNING id` to eliminate the race window.
2. **Rate limiting** — Per-user cap (e.g. 10 generations/hour) to protect OpenAI spend, implemented as a rolling count on `MovieFact.createdAt`.
3. **Fact history page** — `MovieFact` already stores all generated facts; a `/history` page would surface them.
4. **Re-add route-level middleware** — Middleware was removed to resolve a NextAuth v5 redirect loop. With more time I'd restore edge-level auth guards.
5. **End-to-end tests** — Playwright tests covering the full sign-in → onboarding → dashboard → fact generation flow.

---

## Running Tests

```bash
npm test
```

---

## AI Usage Note
- I designed the basic architecture and overall system structure for this project (outlined at the beginning of this file).
- In addition to the core requirements, I implemented several additions (beyond requirements, listed at the end of this file) to improve the project's accuracy and robustness.
- The codebase was developed with AI assistance (Claude), which was used for:
  1. Scaffolding  
  2. Code generation  
  3. Debugging and errors   
  4. Documentation support  
- All AI-generated code was thoroughly reviewed, fully understood, tested, and verified to be functioning correctly before being committed.


---

## This project has 4 EXTRA ADDITIONS (Beyond Requirements)

These improvements were added on top of the base + Variant A requirements to improve correctness, safety, and transparency.

### 1. Input Sanitization on Movie Name

The onboarding API (`POST /api/onboarding`) sanitizes the movie name before storing it or using it in an OpenAI prompt:

```typescript
const movie = body.movie?.trim().replace(/"/g, "'");
```

- `trim()` — removes accidental leading/trailing whitespace
- `replace(/"/g, "'")` — prevents prompt injection. Without this, a user entering a movie name like `Inception" Ignore previous instructions and...` could manipulate the OpenAI prompt. Replacing double quotes with single quotes neutralizes this attack vector.

### 2. Self-Healing Lock (Stale Lock Prevention)

The original burst protection used a boolean `isGeneratingFact` on the `User` model. This had a critical flaw: if the server crashed after acquiring the lock but before the `finally` block ran, the lock would be permanently stuck and the user could never generate a fact again.

**The fix:** replaced the boolean with a `generatingFactSince DateTime?` timestamp field (added in the `stale-lock-protection` migration).

```typescript
const LOCK_EXPIRY_MS = 30 * 1000;

const lockAge = user.generatingFactSince
  ? Date.now() - user.generatingFactSince.getTime()
  : null;

const lockIsActive = lockAge !== null && lockAge < LOCK_EXPIRY_MS;
```

If the server crashes mid-generation, any subsequent request will see a lock older than 30 seconds, treat it as stale, and proceed normally. No cron job or manual intervention required.

### 3. Response Metadata Flags (cached / fresh / fallback)

Every response from `POST /api/fact` includes metadata flags so the frontend can give the user full visibility into where their fact came from:

| Flag | When set | Frontend display |
|---|---|---|
| `cached: true` | Fact is from DB, under 60s old | ⚡ Cached · refreshes in Xs |
| `cached: false` | Fresh fact just generated by OpenAI | ✨ Fresh |
| `expiresInSeconds` | Always present on cached responses | Shows countdown to next generation |
| `fallback: true` | OpenAI failed, returning last known fact | ⚠ OpenAI unavailable, showing last fact |
| `generating: true` | Another request holds the lock | Returned alongside cached fact |

This makes the caching behavior transparent to the user and observable — rather than silently returning a cached response with no indication, the system surfaces exactly what happened and when the cache will expire.

### 4. GET /api/fact Endpoint

A `GET /api/fact` endpoint was added alongside the `POST`. It returns the current cached fact without triggering a new generation — useful for loading the dashboard without side effects or burning the cache window.

```
GET /api/fact  → returns current fact + cache metadata, no OpenAI call
POST /api/fact → generates new fact (if cache expired) or returns cached
```

---