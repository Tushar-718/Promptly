# Promptly — Implementation Plan

> **Source of truth** for the developer and any AI assistant working on this repo.
> If code and this document disagree, stop and resolve it: either fix the code or update this doc (and the Decision Log in §15).

- **Owner:** solo developer (frontend background: React, Next.js, React Native; learning backend + GenAI)
- **Started:** 2026-11-24
- **Status:** Planning

---

## 1. What is Promptly?

An AI text assistant. A user pastes text, picks an operation (summarize, rewrite, translate…), and gets an AI-generated result, inside a chat thread where they can refine it with follow-ups. Later, users upload TXT/PDF files and ask questions answered from the document's content (RAG), with citations.

### 1.1 Learning goals (why this project exists)

| Area | Concepts |
|---|---|
| GenAI basics | LLM API calls, system vs user prompts, temperature, tokens, context window, structured (JSON) output |
| GenAI product | Streaming (SSE), prompt templates, conversation context, regenerate/versions, token usage & cost thinking, caching |
| RAG | Text extraction, chunking, embeddings, vector search (pgvector), grounded answers, citations |
| Agents (optional) | Tool/function calling, agent loop, guardrails |
| Backend | Auth (password + Google OAuth), JWT + refresh rotation, RBAC, Redis rate limiting & caching, BullMQ background jobs, Drizzle ORM, structured logging |
| DevOps | Docker, docker-compose, monorepo, free-tier deployment |

### 1.2 Hard constraints

- **₹0 cost** for development and deployment (free tiers only).
- **The developer writes the backend business logic.** AI assistants help with explanations, hints, reviews and boilerplate (see `CLAUDE.md`).
- **The API is client-agnostic**: a React Native client may be added later.

---

## 2. Features by phase (summary)

| Phase | Scope |
|---|---|
| **0 — Foundation & Auth** | Monorepo, Docker, Express + Next skeleton, DB, logging, errors, email/password + Google sign-in, refresh rotation, RBAC (user/admin) |
| **1 — AI Text Assistant (stateless)** | Enter text → pick operation → backend calls the LLM → show the result. No persistence yet. Rate limiting. |
| **2 — Product features** | Chat threads with follow-ups, streaming, history, custom prompt templates, regenerate with versions, copy, caching, token usage page, admin page |
| **3 — Documents (RAG)** | Upload TXT/PDF, background processing, embeddings in pgvector, semantic search, Q&A with citations |
| **4 — Agent (optional)** | Tool calling: the model decides which tools to use |

Detailed checklists are in §13.

---

## 3. Tech stack & decisions

| Concern | Choice | Why |
|---|---|---|
| Repo | **pnpm workspaces monorepo** | Share Zod schemas, types, constants between web and api |
| Language | **TypeScript** everywhere | — |
| Frontend | **Next.js (App Router)** + **Tailwind** + **shadcn/ui**, dark mode | Familiar; shadcn makes dark mode cheap |
| Data fetching | **TanStack Query** | Caching, polling (document status), mutations |
| Backend | **Express** | Familiar |
| Validation | **Zod** (shared package) | Same schema validates on client and server |
| ORM | **Drizzle ORM** + drizzle-kit migrations | Close to SQL; native pgvector support (Prisma needs raw SQL for vectors) |
| Database | **PostgreSQL + pgvector**: Docker locally, **Neon** in production | Vectors live next to relational data |
| Cache / queue | **Redis**: Docker locally, managed Redis in production (see §14 risks) | Rate limiting, caching, OAuth state, BullMQ |
| Background jobs | **BullMQ** | Document processing off the request path |
| LLM provider | **Google Gemini API** (free tier) via **`@google/genai`** SDK, behind our own `LLMProvider` interface | Free; the raw SDK teaches what happens underneath; the interface allows swapping (e.g. Groq) |
| Chat model | Gemini **Flash / Flash-Lite** family, set by env `LLM_MODEL` | Free-tier friendly. **Copy the exact model ID from Google AI Studio**: IDs change often. |
| Embedding model | **`gemini-embedding-001`**, `outputDimensionality = 768` | 3072 is the default, but 768 saves storage and fits pgvector's HNSW limit (≤ 2000 dims). **Locked**: changing it means re-embedding everything. |
| Password hashing | **bcryptjs** (cost 12) | Pure JS: no native build problems inside Docker |
| Auth | JWT access token (15 min) + opaque refresh token (7 days, rotated, hashed in Postgres, reuse detection) in **httpOnly cookies** | Practice; secure for the web |
| OAuth | Google OAuth 2.0 authorization-code flow, implemented by hand (no auth library) | Learning |
| RBAC | Roles `user` and `admin` | Small admin page |
| PDF text extraction | **`unpdf`** (per-page text) | Maintained, serverless-friendly; per-page text enables page citations |
| File upload | **Multer** (memory storage) | Files are never stored, only their extracted text |
| Logging | **pino** + **pino-http**, request ID on every log line | Debuggability |
| Testing | **Vitest**, minimal (pure utilities) | Chunker, template renderer, token helpers |
| Deploy: web | **Vercel** | Free, fast, native Next.js |
| Deploy: api + worker | **Render**, from the API **Docker image**; the worker runs **in the same process** (`RUN_WORKER_IN_PROCESS=true`) | Free tier has no free separate worker service |
| Browser → API | **Next.js rewrites** `/api/*` → Express | Browser sees ONE domain, so cookies are first-party (no cross-site cookie / SameSite bugs) |

**Not used (by decision):** file storage (Cloudinary/Supabase/R2), local LLMs (Ollama), email service (v1), LangChain or other AI frameworks.

---

## 4. Architecture

### 4.1 Local development

```
Browser ──► Next.js dev server (localhost:3000, run with pnpm, NOT in Docker)
                │  rewrites /api/* ─────────────────────────────┐
                ▼                                               ▼
        (pages, UI)                        ┌──────────── docker compose ────────────┐
                                           │  api     (Express, :4000)              │
                                           │  worker  (BullMQ worker, same image)   │
                                           │  postgres (pgvector/pgvector, :5432)   │
                                           │  redis   (:6379)                       │
                                           └────────────────────────────────────────┘
                                                         │
                                                         ▼
                                                 Gemini API (internet)
```

- The web app runs outside Docker for fast hot-reload.
- pgAdmin connects to `localhost:5432`.

### 4.2 Production

```
Browser ──► Vercel (Next.js)  ── rewrite /api/* ──►  Render (Docker image: API + in-process worker)
                                                         │          │           │
                                                         ▼          ▼           ▼
                                                      Neon      Redis       Gemini API
                                                   (Postgres+  (managed)
                                                    pgvector)
```

### 4.3 Request flows

**Text operation (Phase 2 shape)**
```
UI → POST /api/v1/threads/:id/messages (SSE)
   → auth → rate limit (Redis) → validate (Zod)
   → load template + last N messages → build prompt
   → cache check (only for the first message of a new thread)
   → LLMProvider.stream() → forward deltas as SSE events
   → save assistant message version + token usage → "done" event
```

**Document upload (Phase 3)**
```
UI → POST /api/v1/documents (multipart)
   → Multer (memory, 5 MB) → type check → extract text per page (unpdf)
   → reject if scanned (no text layer) → INSERT document (status=pending, pages)
   → enqueue BullMQ job { documentId } → 202 Accepted
Worker → status=processing → chunk → embed (batches) → INSERT chunks
       → status=ready (or failed + error)
UI polls GET /documents/:id until ready/failed
```

**Document question (Phase 3)**
```
question → embed (RETRIEVAL_QUERY) → pgvector cosine search (top-k, this document only)
        → prompt with numbered context [1]..[k] → stream answer → save citations
```

---

## 5. Monorepo structure

Phase tags: `[P0]`–`[P4]` show when a file is first needed. Don't create everything up front.

### 5.1 Root

```
promptly/
├─ apps/
│  ├─ web/                          # Next.js frontend            (§5.2)
│  └─ api/                          # Express API + worker        (§5.3)
├─ packages/
│  └─ shared/                       # @promptly/shared            (§5.4)
├─ .env.example                     # all variables, documented (§6)
├─ .gitignore
├─ .dockerignore                    # root, because the Docker build context is the repo root
├─ docker-compose.yml               # postgres, redis, api, worker (dev)
├─ package.json                     # root scripts: dev, build, lint, test, db:*
├─ pnpm-workspace.yaml              # apps/*, packages/*
├─ tsconfig.base.json               # shared compiler options
├─ eslint.config.mjs
├─ .prettierrc
├─ README.md
├─ implementation.md                # this file
└─ CLAUDE.md                        # rules for AI assistants
```

Env files: the root `.env` is used by docker-compose and the API. The web app uses `apps/web/.env.local` (only `API_URL`). Both are git-ignored.

### 5.2 `apps/web` (Next.js App Router)

```
apps/web/
├─ app/
│  ├─ layout.tsx                    [P0] root layout: ThemeProvider, QueryProvider, Toaster
│  ├─ page.tsx                      [P0] redirect → /assistant or /login
│  ├─ globals.css                   [P0]
│  ├─ (auth)/                       # public pages
│  │  ├─ layout.tsx                 [P0] centered card layout
│  │  ├─ login/page.tsx             [P0]
│  │  └─ register/page.tsx          [P0]
│  └─ (app)/                        # protected pages
│     ├─ layout.tsx                 [P0] sidebar + header
│     ├─ assistant/
│     │  ├─ page.tsx                [P1] new conversation (Phase 1: stateless form)
│     │  └─ [threadId]/page.tsx     [P2] thread view
│     ├─ documents/
│     │  ├─ page.tsx                [P3] upload + list
│     │  └─ [documentId]/page.tsx   [P3] chat with a document
│     ├─ templates/page.tsx         [P2]
│     ├─ usage/page.tsx             [P2]
│     └─ admin/page.tsx             [P2] admin only
├─ components/
│  ├─ ui/                           [P0] shadcn-generated (button, input, select, dialog…). Don't hand-edit much.
│  ├─ providers/
│  │  ├─ theme-provider.tsx         [P0] dark mode (next-themes)
│  │  └─ query-provider.tsx         [P0] TanStack Query client
│  ├─ layout/
│  │  ├─ app-sidebar.tsx            [P0] nav + thread history (P2)
│  │  ├─ header.tsx                 [P0]
│  │  ├─ theme-toggle.tsx           [P0]
│  │  └─ user-menu.tsx              [P0] logout, logout all devices
│  ├─ auth/
│  │  ├─ login-form.tsx             [P0]
│  │  ├─ register-form.tsx          [P0]
│  │  └─ google-button.tsx          [P0]
│  ├─ assistant/
│  │  ├─ composer.tsx               [P1] textarea + char counter + submit
│  │  ├─ operation-select.tsx       [P1]
│  │  ├─ operation-options.tsx      [P1] tone / length / format / language dropdowns
│  │  ├─ result-panel.tsx           [P1] Phase 1 output
│  │  ├─ message-list.tsx           [P2]
│  │  ├─ message-bubble.tsx         [P2]
│  │  ├─ version-switcher.tsx       [P2] ‹ 2/3 ›
│  │  ├─ copy-button.tsx            [P2]
│  │  ├─ stop-button.tsx            [P2]
│  │  ├─ template-picker.tsx        [P2]
│  │  └─ thread-list.tsx            [P2]
│  ├─ documents/
│  │  ├─ upload-dropzone.tsx        [P3]
│  │  ├─ document-list.tsx          [P3]
│  │  ├─ status-badge.tsx           [P3] pending / processing / ready / failed
│  │  └─ citation.tsx               [P3] [1] → snippet + page
│  ├─ templates/
│  │  ├─ template-form.tsx          [P2]
│  │  └─ template-list.tsx          [P2]
│  ├─ usage/usage-summary.tsx       [P2]
│  └─ admin/users-table.tsx         [P2]
├─ hooks/
│  ├─ use-auth.ts                   [P0] current user (GET /auth/me)
│  ├─ use-generate.ts               [P1]
│  ├─ use-stream.ts                 [P2] runs an SSE request, exposes text/status/abort
│  ├─ use-threads.ts                [P2]
│  ├─ use-templates.ts              [P2]
│  └─ use-documents.ts              [P3] includes polling while processing
├─ lib/
│  ├─ api-client.ts                 [P0] fetch wrapper, error parsing, single-flight refresh on 401
│  ├─ sse.ts                        [P2] parse SSE events from a ReadableStream
│  ├─ query-keys.ts                 [P0]
│  └─ utils.ts                      [P0] cn() etc.
├─ middleware.ts                    [P0] redirect to /login when no auth cookies
├─ next.config.ts                   [P0] rewrites /api/* → API_URL
├─ components.json                  [P0] shadcn config
├─ postcss.config.mjs               [P0]
├─ tsconfig.json
└─ package.json
```

**Frontend rule:** pages stay thin. Data fetching lives in `hooks/`, HTTP details in `lib/api-client.ts`, and components receive data via props.

### 5.3 `apps/api` (Express)

```
apps/api/
├─ src/
│  ├─ app.ts                        [P0] builds the express app: middleware order + routes
│  ├─ server.ts                     [P0] starts HTTP; starts workers if RUN_WORKER_IN_PROCESS
│  ├─ worker.ts                     [P3] standalone worker entry (docker-compose "worker")
│  ├─ config/
│  │  └─ env.ts                     [P0] Zod-validated env, crash on invalid
│  ├─ types/
│  │  └─ express.d.ts               [P0] adds req.id, req.user
│  ├─ db/
│  │  ├─ client.ts                  [P0] drizzle + pg pool
│  │  ├─ schema/
│  │  │  ├─ index.ts                [P0] re-exports all tables
│  │  │  ├─ enums.ts                [P0] user_role, operation, thread_type, statuses…
│  │  │  ├─ users.ts                [P0]
│  │  │  ├─ auth.ts                 [P0] oauth_accounts, refresh_tokens
│  │  │  ├─ templates.ts            [P2] prompt_templates
│  │  │  ├─ threads.ts              [P2] threads, messages, message_versions
│  │  │  ├─ usage.ts                [P2] usage_events
│  │  │  └─ documents.ts            [P3] documents, document_chunks (vector)
│  │  ├─ migrations/                [P0] generated by drizzle-kit. Commit; never edit after applying.
│  │  └─ seed.ts                    [P0] admin user (P0), default templates (P2)
│  ├─ lib/
│  │  ├─ logger.ts                  [P0] pino instance
│  │  ├─ redis.ts                   [P0] ioredis client
│  │  ├─ errors.ts                  [P0] AppError class + helpers (notFound, forbidden…)
│  │  ├─ async-handler.ts           [P0] forwards async errors to the error handler
│  │  ├─ cookies.ts                 [P0] set/clear auth cookies (flags in one place)
│  │  ├─ tokens.ts                  [P0] sign/verify JWT, generate opaque refresh token
│  │  ├─ hash.ts                    [P0] bcrypt + sha256 helpers
│  │  └─ sse.ts                     [P2] init SSE response, send event, heartbeat
│  ├─ middleware/
│  │  ├─ request-id.ts              [P0]
│  │  ├─ http-logger.ts             [P0] pino-http
│  │  ├─ authenticate.ts            [P0] Bearer header first, then cookie → req.user
│  │  ├─ require-role.ts            [P0]
│  │  ├─ rate-limit.ts              [P0] Redis counters (auth: P0, AI: P1)
│  │  ├─ validate.ts                [P0] validate(body/query/params, zodSchema)
│  │  ├─ upload.ts                  [P3] multer memory + size + type + magic bytes
│  │  ├─ not-found.ts               [P0]
│  │  └─ error-handler.ts           [P0] AppError/Zod/Multer → §10.2 format
│  ├─ llm/
│  │  ├─ types.ts                   [P1] LLMProvider interface + request/result types
│  │  ├─ gemini.provider.ts         [P1] the ONLY file importing @google/genai
│  │  ├─ index.ts                   [P1] exports the active provider
│  │  ├─ retry.ts                   [P1] backoff for 429/503
│  │  └─ prompts/
│  │     ├─ render-template.ts      [P1] {{placeholders}} (unit tested)
│  │     ├─ operation-prompts.ts    [P1] Phase 1 built-in prompts (moved to seed in P2)
│  │     ├─ build-messages.ts       [P2] template + thread history → LLM messages
│  │     ├─ context-window.ts       [P2] trim history to budget (unit tested)
│  │     └─ rag-prompt.ts           [P3] numbered context + answer rules
│  ├─ cache/
│  │  └─ generation-cache.ts        [P2] key building + get/set (§8.6)
│  ├─ rag/
│  │  ├─ extract.ts                 [P3] PDF/TXT → pages[], scanned check
│  │  ├─ chunk.ts                   [P3] pages → chunks with page ranges (unit tested)
│  │  ├─ embed.ts                   [P3] batching + L2 normalize
│  │  └─ retrieve.ts                [P3] pgvector top-k query
│  ├─ queue/
│  │  ├─ connection.ts              [P3] BullMQ Redis connection
│  │  ├─ documents.queue.ts         [P3] queue + addProcessDocumentJob()
│  │  ├─ documents.processor.ts     [P3] job handler: chunk → embed → save
│  │  └─ start-workers.ts           [P3] used by worker.ts and server.ts
│  ├─ modules/                      # one folder per feature: <name>.routes / .controller / .service
│  │  ├─ health/health.routes.ts    [P0]
│  │  ├─ auth/
│  │  │  ├─ auth.routes.ts          [P0]
│  │  │  ├─ auth.controller.ts      [P0]
│  │  │  ├─ auth.service.ts         [P0] register, login, logout
│  │  │  ├─ refresh.service.ts      [P0] rotation + reuse detection
│  │  │  └─ google.service.ts       [P0] OAuth state, code exchange, account linking
│  │  ├─ users/users.service.ts     [P0]
│  │  ├─ generate/                  [P1] stateless POST /generate (routes, controller, service)
│  │  ├─ templates/                 [P2] routes, controller, service
│  │  ├─ threads/                   [P2] routes, controller, service
│  │  ├─ messages/                  [P2] routes, controller, service, stream.service.ts
│  │  ├─ usage/                     [P2] routes, controller, service (+ recordUsage())
│  │  ├─ admin/                     [P2] routes, controller, service
│  │  └─ documents/                 [P3] routes, controller, service
│  └─ agent/                        [P4] optional
│     ├─ tools/                     # one file per tool: schema + handler
│     └─ agent-loop.ts
├─ test/
│  ├─ render-template.test.ts       [P1]
│  ├─ context-window.test.ts        [P2]
│  ├─ chunk.test.ts                 [P3]
│  └─ embed-normalize.test.ts       [P3]
├─ drizzle.config.ts                [P0]
├─ vitest.config.ts                 [P1]
├─ Dockerfile                       [P0] multi-stage (dev + prod targets)
├─ tsconfig.json
└─ package.json
```

### 5.4 `packages/shared`

```
packages/shared/
├─ src/
│  ├─ index.ts                      # re-exports everything
│  ├─ constants.ts                  [P0] LIMITS, OPERATIONS, TONES, LANGUAGES, SUMMARY_*
│  ├─ error-codes.ts                [P0] ERROR_CODES (§10.2)
│  ├─ schemas/                      # Zod, used by BOTH web forms and API validation
│  │  ├─ auth.schema.ts             [P0]
│  │  ├─ generate.schema.ts         [P1]
│  │  ├─ templates.schema.ts        [P2]
│  │  ├─ threads.schema.ts          [P2]
│  │  ├─ messages.schema.ts         [P2]
│  │  └─ documents.schema.ts        [P3]
│  └─ types/
│     ├─ api.ts                     # response DTOs (UserDto, ThreadDto…)
│     └─ sse.ts                     [P2] SSE event types (meta, delta, done, error)
├─ tsconfig.json
└─ package.json                     # "name": "@promptly/shared"
```

### 5.5 Conventions

- **File names:** kebab-case. API module files: `<module>.<layer>.ts` (e.g. `threads.service.ts`).
- **Layering (API):** `routes → controller (HTTP only: parse req, send res) → service (business logic) → db`. Services never touch `req`/`res`, so they can be reused by workers and the agent.
- **Imports:** apps import shared code only via `@promptly/shared`. `web` never imports from `api` (and vice versa).
- **Middleware order in `app.ts`:** request-id → http-logger → helmet → cors → json/cookie parsers → routes → not-found → error-handler.

---

## 6. Environment variables

`.env.example` (never commit real `.env`):

```bash
# ---------- api ----------
NODE_ENV=development
PORT=4000
LOG_LEVEL=debug
WEB_ORIGIN=http://localhost:3000          # used for redirects after OAuth
DATABASE_URL=postgres://promptly:promptly@localhost:5432/promptly
REDIS_URL=redis://localhost:6379

JWT_ACCESS_SECRET=change-me-long-random   # access token signing
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=7

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/auth/google/callback   # NOTE: web origin (goes through the rewrite)

GEMINI_API_KEY=
LLM_MODEL=                                # copy exact ID from Google AI Studio (Flash / Flash-Lite)
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIM=768

RUN_WORKER_IN_PROCESS=false               # true in production (Render)
ADMIN_EMAIL=                              # seed script promotes this user to admin

# ---------- web ----------
API_URL=http://localhost:4000             # server-side only; target of Next.js rewrites
```

- The API validates env at startup with Zod and **crashes immediately** on missing or invalid values.
- `GEMINI_API_KEY` exists only on the server. Never prefix secrets with `NEXT_PUBLIC_`.

---

## 7. Database schema (Drizzle / Postgres)

All IDs are `uuid` (default `gen_random_uuid()`). All tables have `created_at timestamptz default now()`. Required extensions: `pgcrypto` (if needed for uuid), `vector`.

### 7.1 Auth & users

**users**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| email | text UNIQUE NOT NULL | stored lowercased |
| password_hash | text NULL | NULL for Google-only accounts |
| name | text | |
| avatar_url | text NULL | |
| role | enum `user_role` (`user`,`admin`) default `user` | |
| updated_at | timestamptz | |

**oauth_accounts**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users ON DELETE CASCADE | |
| provider | text | `google` |
| provider_account_id | text | Google `sub` |
| | UNIQUE(provider, provider_account_id) | |

**refresh_tokens**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users CASCADE | |
| token_hash | text UNIQUE | SHA-256 of the opaque token (never store the raw token) |
| family_id | uuid | all rotations from one login share a family |
| expires_at | timestamptz | |
| revoked_at | timestamptz NULL | |
| replaced_by_id | uuid NULL | the token that replaced this one |
| user_agent | text NULL | |
| ip | text NULL | |

### 7.2 Assistant

**prompt_templates**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid NULL FK → users CASCADE | **NULL = built-in default** (seeded) |
| name | text | |
| operation | enum `operation` | see §8.1 |
| system_prompt | text | |
| user_prompt | text | must contain `{{input}}` |
| version | int default 1 | bump on edit (part of the cache key) |
| updated_at | timestamptz | |

**threads**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users CASCADE | |
| type | enum `thread_type` (`text`,`document`) | |
| document_id | uuid NULL FK → documents CASCADE | required when type=`document` |
| title | text NULL | generated after the first reply (structured output) |
| updated_at | timestamptz | for sorting the history sidebar |

**messages**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| thread_id | uuid FK → threads CASCADE | |
| role | enum (`user`,`assistant`) | |
| content | text NULL | user messages only |
| operation | enum `operation` NULL | user messages only |
| options | jsonb NULL | e.g. `{ "tone": "formal" }`, `{ "length": "short", "format": "bullets" }`, `{ "targetLanguage": "hi" }` |
| template_id | uuid NULL FK → prompt_templates SET NULL | |
| active_version_id | uuid NULL | assistant messages: which version is shown and used as context |

**message_versions** (assistant outputs; regenerate = new version)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| message_id | uuid FK → messages CASCADE | |
| version_number | int | 1, 2, 3… UNIQUE(message_id, version_number) |
| content | text | |
| status | enum (`streaming`,`completed`,`failed`,`aborted`) | |
| citations | jsonb NULL | RAG: `[{ n, chunkId, pageStart, pageEnd, snippet }]` |
| model | text | |
| input_tokens | int NULL | |
| output_tokens | int NULL | |
| from_cache | boolean default false | |

### 7.3 Documents (Phase 3)

**documents**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users CASCADE | |
| filename | text | |
| mime_type | text | `application/pdf` / `text/plain` |
| size_bytes | int | |
| page_count | int | TXT = 1 |
| pages | jsonb | `string[]`, extracted text per page (kept so documents can be re-chunked) |
| status | enum (`pending`,`processing`,`ready`,`failed`) | |
| error | text NULL | user-safe message |
| chunk_count | int default 0 | |
| updated_at | timestamptz | |

**document_chunks**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| document_id | uuid FK → documents CASCADE | |
| user_id | uuid | denormalized for safe filtering |
| chunk_index | int | |
| content | text | |
| page_start / page_end | int | for citations |
| embedding | `vector(768)` | normalized |
| | INDEX: HNSW `embedding vector_cosine_ops` | |
| | INDEX: (document_id) | |

### 7.4 Usage

**usage_events**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users CASCADE | |
| kind | enum (`generation`,`embedding`,`title`) | |
| model | text | |
| input_tokens | int | |
| output_tokens | int default 0 | |
| message_version_id | uuid NULL | |
| document_id | uuid NULL | |
| | INDEX (user_id, created_at) | monthly totals |

---

## 8. AI design

### 8.1 Operations

| operation | options | notes |
|---|---|---|
| `summarize` | `length`: short / medium / long; `format`: paragraph / bullets | |
| `rewrite` | — | Rephrase for clarity and flow, same meaning |
| `change_tone` | `tone`: formal / casual / professional / friendly | |
| `translate` | `targetLanguage`: `en` / `hi` | Source auto-detected. Phase 1 uses **structured output**: `{ detectedLanguage, translation }` |
| `fix_grammar` | — | Fix grammar/spelling only; keep wording otherwise |
| `custom` | — | Uses a user's custom template |
| `followup` | — | Free-text instruction inside a thread ("make it shorter") |
| `document_qa` | — | Question about a document (RAG) |

### 8.2 `LLMProvider` interface (apps/api/src/llm)

```ts
interface LLMProvider {
  generate(req: GenerateRequest): Promise<GenerateResult>;            // Phase 1
  stream(req: GenerateRequest, signal: AbortSignal): AsyncIterable<StreamEvent>; // Phase 2
  generateJson<T>(req: GenerateRequest, schema: ZodSchema<T>): Promise<T>;       // structured output
  embed(texts: string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]>; // Phase 3
}
// GenerateRequest: { system: string; messages: {role, content}[]; temperature?: number; maxOutputTokens?: number }
// GenerateResult:  { text; usage: { inputTokens; outputTokens }; finishReason; model }
// StreamEvent:     { type: 'delta', text } | { type: 'done', usage, finishReason }
```

- Only `llm/gemini.provider.ts` imports `@google/genai`. Nothing else knows which vendor is used.
- **Retries:** exponential backoff on 429 / 503 (max 3 attempts), never on 400.
- **Timeouts:** abort non-streaming calls after 60 s.
- **Client disconnect:** abort the stream (`AbortController`) and save the partial version with status `aborted`.

### 8.3 Prompt rules

- Templates use placeholders: `{{input}}`, `{{tone}}`, `{{length}}`, `{{format}}`, `{{targetLanguage}}`. A pure, unit-tested `renderTemplate()` fails on unknown or missing placeholders.
- User text is wrapped in delimiters (`<input>…</input>`), and the system prompt says to treat it as **data, not instructions** (basic prompt-injection defense).
- Default temperatures: grammar/translate 0.2, summarize 0.3, rewrite/tone 0.7.
- Built-in templates are **seeded** in the DB (`user_id = NULL`); code never hardcodes prompt text except in the seed file.

### 8.4 Thread context (follow-ups)

- Context sent to the model = system prompt + the last messages of the thread (user messages + **active version** of assistant messages), newest first, until a budget of **~6,000 input tokens** (estimate `chars / 4`) or **10 messages**, whichever comes first. Older messages are dropped.
- Regenerate is allowed **only on the last assistant message** of a thread (keeps the context consistent).

### 8.5 Thread titles (structured output)

After the first assistant reply, call `generateJson` with schema `{ title: string (≤ 60 chars) }`. On failure, fall back to the first 40 characters of the input. Recorded as usage kind `title`.

### 8.6 Caching (Redis)

- Only for the **first message of a new text thread** (follow-ups depend on history, so they're not cacheable).
- Key: `cache:gen:` + sha256(`model | operation | options(sorted JSON) | templateId:version | input`). TTL 24 h.
- **Regenerate always bypasses the cache.**
- Cached results create a version with `from_cache = true` and **no usage event** (0 tokens spent).

### 8.7 RAG parameters

| parameter | value |
|---|---|
| Chunk size | ~1,200 characters, split at paragraph → sentence boundaries |
| Overlap | ~200 characters |
| Page tracking | each chunk keeps `page_start` / `page_end` |
| Embedding batch | 50 texts per request (configurable) |
| Normalization | L2-normalize every vector (required for reduced dimensions) |
| Retrieval | cosine distance (`<=>`), **filtered by document_id AND user_id**, top-k = 5 |
| Scanned PDF check | reject if extracted text < ~100 chars total or very low chars-per-page → error `SCANNED_PDF` |
| Answer rules | answer only from the context; cite sources as `[n]`; if not in context, say "I couldn't find that in this document" |
| Stretch | rewrite follow-up questions into standalone questions before retrieval ("what about the second point?") |

---

## 9. Auth design

### 9.1 Tokens & cookies

| | access token | refresh token |
|---|---|---|
| Format | JWT (HS256) `{ sub, role }` | 32 random bytes (base64url), **opaque** |
| TTL | 15 min | 7 days |
| Storage (server) | — | SHA-256 hash in `refresh_tokens` |
| Cookie | `access_token`, path `/` | `refresh_token`, path `/api/v1/auth` |
| Flags | httpOnly, `SameSite=Lax`, `Secure` in prod | same |

- The auth middleware reads `Authorization: Bearer` **first**, then the `access_token` cookie (keeps the API ready for a React Native client later).
- Express: `app.set('trust proxy', 1)` in production (behind Render/Vercel proxies: needed for correct IPs and secure cookies).

### 9.2 Refresh rotation with reuse detection

On `POST /auth/refresh`:
1. Hash the cookie token → look it up. Not found → 401.
2. Already **revoked** → **reuse detected** → revoke the **entire family** → 401 (someone may have stolen the token).
3. Expired → 401.
4. Otherwise, **in one transaction**: revoke the current token (`revoked_at`, `replaced_by_id`), insert a new token in the **same family**, issue a new access token, set both cookies.

- **Logout:** revoke the current token, clear cookies.
- **Logout all devices:** revoke all of the user's tokens. Accepted trade-off: already-issued access tokens stay valid for ≤ 15 min.

### 9.3 Google OAuth (authorization code flow)

1. `GET /auth/google` → generate `state`, store `oauth:state:{state}` in Redis (TTL 10 min) → redirect to Google.
2. `GET /auth/google/callback` → check and **delete** the state (single use) → exchange the code for tokens → verify the ID token → read `sub`, `email`, `email_verified`, `name`, `picture`.
3. Account resolution:
   - `oauth_accounts` has (google, sub) → log in that user.
   - Else, a user with the same email exists **and `email_verified` is true** → link (insert oauth_account) → log in.
   - Else → create the user (no password) + oauth_account.
4. Issue tokens, set cookies, redirect to `WEB_ORIGIN`.

- The redirect URI points at the **web origin** (`…:3000/api/v1/auth/google/callback`) so cookies are set on the web domain through the rewrite. Register exactly this URI in Google Cloud Console (and the production one later).
- A Google-only user trying password login gets the generic "invalid email or password" error.

### 9.4 Passwords

- bcryptjs, cost 12. Min length 8. Emails lowercased and trimmed.
- Login errors are always generic ("invalid email or password"): never reveal whether an email exists.

### 9.5 RBAC

- `requireRole('admin')` middleware guards `/api/v1/admin/*`.
- The first admin is created by the seed script (`ADMIN_EMAIL`).
- **Every** resource query is scoped by `user_id` (ownership check). Never fetch by ID alone.

---

## 10. API reference (`/api/v1`)

All request bodies are validated with Zod schemas from `packages/shared`.

### Auth
| method | path | notes |
|---|---|---|
| POST | `/auth/register` | `{ email, password, name }` |
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/refresh` | uses the refresh cookie |
| POST | `/auth/logout` | |
| POST | `/auth/logout-all` | |
| GET | `/auth/me` | current user |
| GET | `/auth/google` | redirect to Google |
| GET | `/auth/google/callback` | |

### Phase 1 (stateless, removed or kept as internal in Phase 2)
| POST | `/generate` | `{ operation, options, input }` → `{ output, usage }` (JSON) |

### Templates
| GET | `/templates` | defaults + mine |
| POST | `/templates` | create (private) |
| PATCH | `/templates/:id` | own only; bumps `version` |
| DELETE | `/templates/:id` | own only |

### Threads & messages
| GET | `/threads?type=text\|document&cursor=` | history sidebar, paginated |
| POST | `/threads` | `{ type, documentId? }` |
| GET | `/threads/:id` | thread + messages + active versions |
| PATCH | `/threads/:id` | rename |
| DELETE | `/threads/:id` | |
| POST | `/threads/:id/messages` | **SSE stream**. `{ operation, options?, templateId?, content }` |
| POST | `/messages/:id/regenerate` | **SSE stream**; last assistant message only |
| GET | `/messages/:id/versions` | list versions |
| PATCH | `/messages/:id/active-version` | `{ versionId }` (flip 1/3, 2/3) |

### Documents (Phase 3)
| POST | `/documents` | multipart `file` → 202 `{ document }` |
| GET | `/documents` | mine |
| GET | `/documents/:id` | includes `status`, `error` (polled) |
| DELETE | `/documents/:id` | cascades chunks + threads |

### Usage & admin
| GET | `/usage/me?month=YYYY-MM` | token totals by kind |
| GET | `/admin/users` | admin only, paginated |
| GET | `/admin/usage?month=` | admin only, per-user totals |
| GET | `/health` | `{ ok, db, redis }` |

### 10.1 SSE event format

`EventSource` only supports GET, so the frontend reads the stream with **`fetch` + `ReadableStream`**.

```
event: meta    data: {"messageId":"…","versionId":"…"}
event: delta   data: {"text":"partial text"}
event: done    data: {"usage":{"inputTokens":120,"outputTokens":340},"citations":[…]}
event: error   data: {"code":"LLM_RATE_LIMITED","message":"…"}
```

Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. Call `res.flushHeaders()`. Send a heartbeat comment (`: ping`) every 15 s.

### 10.2 Error format

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human readable", "details": {}, "requestId": "…" } }
```

| code | HTTP |
|---|---|
| `VALIDATION_ERROR` | 400 |
| `UNAUTHENTICATED` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 (also used for "exists but not yours") |
| `CONFLICT` (e.g. email taken) | 409 |
| `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `SCANNED_PDF`, `DOCUMENT_LIMIT_REACHED`, `INPUT_TOO_LONG` | 413 / 415 / 422 |
| `RATE_LIMITED` | 429 + `Retry-After` |
| `LLM_RATE_LIMITED`, `LLM_UNAVAILABLE` | 503 |
| `INTERNAL_ERROR` | 500 (no stack traces in responses) |

---

## 11. Limits & rate limiting

Values live in `packages/shared/constants.ts` (single place to change them).

| limit | value | enforced where |
|---|---|---|
| AI requests (messages, regenerate, document questions, `/generate`) | **20 / hour / user** | Redis `rl:ai:{userId}` |
| Auth attempts (login/register) | 10 / 15 min / IP | Redis `rl:auth:{ip}` |
| Text input | **10,000 characters** | Zod |
| File size | **5 MB** | Multer `limits.fileSize` |
| Documents per user | **5** | service check before insert |
| File types | PDF, TXT (checked by mimetype **and** magic bytes `%PDF-`) | upload middleware |

Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

### Redis key map
| key | purpose | TTL |
|---|---|---|
| `rl:ai:{userId}` | AI rate limit counter | 1 h window |
| `rl:auth:{ip}` | auth rate limit | 15 min |
| `cache:gen:{hash}` | generation cache | 24 h |
| `oauth:state:{state}` | OAuth CSRF state | 10 min |
| `bull:documents:*` | BullMQ (managed by BullMQ) | — |

---

## 12. Docker, logging, security, testing

### 12.1 Docker
- **`docker-compose.yml` (dev):** `postgres` (`pgvector/pgvector` image, named volume), `redis`, `api` (dev target, source mounted, `tsx watch`), `worker` (same image, runs `worker.ts`).
- **`apps/api/Dockerfile`:** multi-stage (deps → build → slim runtime), pnpm workspace-aware, runs as a non-root user, `NODE_ENV=production`.
- Production runs **one container**: API + worker in-process (`RUN_WORKER_IN_PROCESS=true`).
- Migrations: `drizzle-kit` generates SQL files (committed). They run as an explicit step (`pnpm db:migrate`), not automatically on every boot.

### 12.2 Logging
- pino + pino-http; `x-request-id` header is reused or generated; every log line has `requestId` (and `userId` when known). The request ID is returned in error responses.
- `pino-pretty` in dev only.
- **Never log** passwords, tokens, cookies, API keys or full user text. Log lengths and IDs instead.

### 12.3 Security checklist
- helmet; JSON body limit (100 kb); CORS allowlist (mainly for local tools, since the browser uses rewrites).
- Zod validation on every input; ownership (`user_id`) checks on every query.
- Gemini key only on the server.
- Generic auth error messages; auth rate limiting.
- Uploaded files are never written to disk or served back.

### 12.4 Testing (Vitest, minimal)
- `renderTemplate()`: placeholders, missing values, unknown placeholders.
- Chunker: sizes, overlap, page tracking, empty input.
- Context-window trimmer (§8.4).
- Vector normalization helper.
- Refresh-rotation decision logic (if extracted as a pure function).

---

## 13. Roadmap & checklists

### Phase 0 — Foundation & Auth
**Learn:** monorepo, Docker Compose, Drizzle migrations, middleware design, JWT + refresh rotation, OAuth flow, RBAC.
- [ ] pnpm workspace, `tsconfig.base.json`, `packages/shared`
- [ ] `docker-compose.yml` (postgres+pgvector, redis, api, worker)
- [ ] Express skeleton: env validation, pino + request ID, error handler, `/health`
- [ ] Drizzle setup, `users`, `oauth_accounts`, `refresh_tokens` migrations
- [ ] Register / login / me / logout
- [ ] Refresh rotation + reuse detection + logout-all
- [ ] Google OAuth + account linking
- [ ] Roles + `requireRole` + seed admin
- [ ] Auth rate limiting (Redis)
- [ ] Next.js app: Tailwind, shadcn/ui, dark mode, rewrites, login/register pages, Google button
- [ ] Frontend API client: on 401, call `/auth/refresh` **once** (single-flight) and retry; redirect to login on failure
- [ ] Next.js middleware: redirect to `/login` when no auth cookies (the real check is always done by the API)

### Phase 1 — AI Text Assistant (stateless)
**Learn:** LLM API call shape, system prompts, temperature, tokens, structured output, LLM error handling.
- [ ] `LLMProvider` interface + Gemini implementation (`generate`, `generateJson`)
- [ ] Prompt builder per operation (summarize, rewrite, change_tone, translate, fix_grammar)
- [ ] Translate via structured output `{ detectedLanguage, translation }` validated with Zod
- [ ] `POST /generate` + Zod validation + 10k char limit
- [ ] AI rate limiting 20/hour/user
- [ ] Retries/backoff on 429/503 + friendly errors
- [ ] UI: text area + char counter, operation selector, option dropdowns (tone/length/format/language), result panel, loading + error states
- [ ] Log token usage from responses (console/pino for now)

### Phase 2 — Product features
**Learn:** SSE streaming, conversation context, prompt templating, versioning, caching, cost tracking.
- [ ] Tables: `prompt_templates` (+ seed defaults), `threads`, `messages`, `message_versions`, `usage_events`
- [ ] Threads CRUD + history sidebar (paginated)
- [ ] `POST /threads/:id/messages` with **SSE streaming**; frontend stream reader (fetch + ReadableStream)
- [ ] Abort on client disconnect + "Stop generating" button
- [ ] Follow-up messages with context trimming (§8.4)
- [ ] Thread title via structured output
- [ ] Regenerate → new version; version switcher (1/3 ‹ ›)
- [ ] Copy button
- [ ] Custom templates CRUD (private) + template picker in UI
- [ ] Redis generation cache (§8.6)
- [ ] Usage events + "Usage this month" page
- [ ] Admin page: users list + per-user usage
- [ ] **Early check:** streaming works through Vercel rewrites + Render (see §14)

### Phase 3 — Documents (RAG)
**Learn:** extraction, chunking, embeddings, vector search, grounding, citations, background jobs.
- [ ] Enable `vector` extension; `documents`, `document_chunks` + HNSW index
- [ ] Upload endpoint: Multer memory, 5 MB, type + magic bytes, 5-doc limit
- [ ] Per-page extraction (unpdf) + scanned-PDF rejection
- [ ] BullMQ queue `documents`, job `{ documentId }`, `jobId = documentId`, 3 attempts, exponential backoff
- [ ] Worker: chunk → embed (batched, `RETRIEVAL_DOCUMENT`, 768, normalized) → insert in a transaction (delete old chunks first, so retries are idempotent) → `ready` / `failed`
- [ ] Documents page: upload, list, status badge (polling while pending/processing), delete
- [ ] Document thread: question → embed (`RETRIEVAL_QUERY`) → top-5 search → grounded prompt → stream → citations
- [ ] Citations UI: `[1]` markers → show snippet + page
- [ ] Usage events for embeddings
- [ ] Stretch: standalone-question rewriting for follow-ups

### Phase 4 — Agent (optional)
**Learn:** tool/function calling, agent loop, guardrails.
- [ ] Tools: `search_document`, `summarize_text`, `translate_text`, `get_my_usage`
- [ ] Each tool: JSON schema for the model + Zod validation of the model's arguments + permission check
- [ ] Agent loop with max 5 steps; show tool calls in the UI ("Searched document…")
- [ ] Log every step (tool name, args, duration)

### Later / backlog
- Email verification + forgot password (needs an email service)
- OCR for scanned PDFs
- Q&A across all of a user's documents; hybrid (keyword + vector) search
- Small evaluation set for RAG answers (question → expected facts)
- React Native client (API is already client-agnostic; needs the token-in-body option for mobile)
- Export a thread as Markdown

---

## 14. Known risks & things to verify

| # | Risk | Plan |
|---|---|---|
| R1 | **Gemini free-tier limits and model IDs change.** Free-tier data may be used by Google to improve products. | Check AI Studio for live limits and model IDs; keep the model in env; don't upload private documents. |
| R2 | **SSE through Vercel rewrites** may buffer or time out on long responses. | Test early in Phase 2 with a deployed hello-stream endpoint. Fallback: call the API directly for streaming routes (needs CORS + cookie config). |
| R3 | **Render free instance sleeps.** The first request after idle can take ~1 min and the Vercel proxy may time out. | Show a "waking up server" state in the UI; health ping on app load. |
| R4 | **BullMQ on a free managed Redis** (e.g. Upstash) can use many Redis commands even when idle and exhaust the free quota. | At deploy time, compare free Redis options (Upstash vs Render Key Value); tune worker settings (`drainDelay`, `stalledInterval`). |
| R5 | **Neon free storage is small**; vectors grow fast (768 floats ≈ 3 KB per chunk + text). | Enforce the 5-doc / 5 MB limits; delete chunks on document delete; watch the size in the Neon dashboard. |
| R6 | **512 MB RAM** on the free instance: PDF parsing + worker in-process. | 5 MB file limit, worker concurrency = 1, process pages sequentially. |

---

## 15. Decision log

Add a row whenever a decision in §3 changes.

| date | decision | reason |
|---|---|---|
| 2026-11-24 | Gemini (free tier) via `@google/genai` behind `LLMProvider` | ₹0 cost; learn raw SDK; swappable |
| 2026-11-24 | `gemini-embedding-001` @ 768 dims | Storage + HNSW ≤ 2000 dims |
| 2026-11-24 | No file storage; keep extracted per-page text only | Not needed for RAG; ₹0 |
| 2026-11-24 | Drizzle over Prisma | Native pgvector |
| 2026-11-24 | Vercel (web) + Render Docker (API + in-process worker) + Neon | Free; fast frontend; single-domain cookies via rewrites |
| 2026-11-24 | Chat threads with follow-ups for text ops; regenerate keeps versions | Learn context management |
| 2026-11-24 | Translation EN ↔ HI only, source auto-detected | Scope |
| 2026-11-24 | Refresh tokens: opaque, hashed, rotated, reuse detection, in Postgres | Practice + security |
| 2026-11-24 | No local LLM (Ollama) | Low RAM |

---

## 16. Common pitfalls to watch for (learning notes)

These are bugs you'll likely meet. They're listed so you recognize them, not so you avoid learning them.

- **Two tabs refresh at the same time** → the second request uses an already-rotated token → false "reuse detected" → user logged out. (Think: single-flight refresh on the client, or a short grace period on the server.)
- **Forgetting `user_id` in a WHERE clause** → user A can read user B's thread by guessing an ID (IDOR).
- **SSE responses buffered** by compression middleware or proxies → the text appears all at once at the end.
- **Not handling client disconnect** → the LLM keeps generating (and spending tokens) after the user closes the tab.
- **Multer errors** (file too large) skip your normal error flow unless handled explicitly.
- **BullMQ job retried after partial success** → duplicate chunks (that's why the worker deletes old chunks first).
- **Embedding the question with the wrong task type or different dimensions** than the chunks → poor or failing search.
- **Context window grows forever** in long threads → slower, more expensive, eventually errors.
- **Hindi text uses more tokens per character** than English → budgets based on characters are rough.
- **Cookies not set in production** → missing `trust proxy`, a wrong `Secure`/`SameSite` combination, or the OAuth redirect URI on the wrong domain.
- **Caching a follow-up message** → wrong answers, because the cache key ignores the conversation history.
- **Drizzle migrations edited after being applied** → schema drift between local and Neon.
