# CLAUDE.md — Rules for AI assistants on Promptly

**Read `implementation.md` first.** It is the source of truth for architecture, schema, API, limits and decisions.
It is imported below, so Claude Code loads it automatically in every session:

@implementation.md

## How we work
**Two modes (changed 2026-11-26):**
- **Fast mode** (infrastructure and plumbing: config, error handling, Docker, connections, tooling setup): give **complete files with their code in chat**, plus the reason for each file. The developer adds them, then asks for review.
- **Guided mode** (from **database design** onward for schema, routes and business logic): follow the small steps below. The developer writes the code with hints.

In both modes: still no files created ahead of need, and don't edit project files unless asked.

### Guided mode steps
1. Give **one small step** and explain **why it is needed now**. Then stop and wait.
2. The developer makes the edit and says "done".
3. Read the actual files and review them: what is correct, what is wrong and why. Then give the next step.

- In guided mode, files grow gradually: add only the dependency or lines needed right now.
- Don't ask for a commit after every step. Mention a commit only at a meaningful milestone, as an optional one-liner.
- Don't edit project files for the developer unless asked. Exception: keep the "Current progress" section below up to date.
- `implementation.md` §5 is a **blueprint for context**, not a list of files to create. **Never create files or folders ahead of time.** Each one is created by the developer in the step that needs it.
- Before a new file or folder is created, explain **why this code deserves its own file** (what problem the separation solves). Where useful, start in one file and split it when the need shows up, ending at the §5 structure.

## Who writes what
- The developer is **learning** backend and GenAI. They write the **backend business logic** themselves (services, auth flows, RAG pipeline, prompt building, queue processors).
- The developer decides how much help they want for each request. When it isn't stated, **explain and hint first**. Don't write whole features or files of business logic unless explicitly asked.
- You **may write boilerplate fully** only when explicitly asked for the full file or in fast mode (see How we work): Dockerfile, docker-compose, tsconfig, eslint/prettier, package.json scripts, drizzle config, Next.js/Tailwind/shadcn setup, `.env.example`.
- When reviewing code: point out bugs, explain why, and suggest a direction. Don't silently rewrite the developer's code.

## Guardrails
- Don't change decisions in `implementation.md` §3 (stack, models, auth design, deployment) without asking. If a change is agreed, propose the matching update to `implementation.md`, including a row in the Decision Log (§15).
- Keep the layering: `routes → controller → service → db`. Services never touch `req`/`res`.
- Every DB query on user data is scoped by `user_id`.
- All input is validated with Zod schemas from `packages/shared`.
- Only `apps/api/src/llm/gemini.provider.ts` may import `@google/genai`.
- Never put secrets in client code or `NEXT_PUBLIC_*` variables. Never log passwords, tokens, cookies or API keys.
- Use the error format and codes from `implementation.md` §10.2.
- Don't add new dependencies or paid services without asking. The project must stay at ₹0 cost.
- Model IDs and free-tier limits change: tell the developer to verify them in Google AI Studio instead of hardcoding them from memory.

## Current phase
See the checklists in `implementation.md` §13. Work only on the current phase unless asked. Tick a checklist item there once it is finished and reviewed.

## Current progress
Update this after every reviewed step.

- **Phase:** 0 — Foundation & Auth
- **Checklist item:** Register / login / me / logout
- **Completed steps:** Step 1 root `package.json`; Step 2 `pnpm-workspace.yaml`; Step 3 `packages/shared/package.json`; Step 4 `apps/api` + `apps/web` `package.json`; Step 5 `.gitignore` + `git init`; Step 6 TypeScript `~6.0.3` at the root; Step 7 `tsconfig.base.json`; Step 8 first commit (pushed to `origin/main`); Step 9 Express 5 in `apps/api`; Step 10 `apps/api/src/server.ts` with `GET /health` + `"type": "module"`; Step 11 `apps/api/tsconfig.json` + `@types/express` (type check is clean); Step 12 `dev` script (`node --watch`), second commit; Step 13 `process.env.PORT` + `@types/node@^24` (not committed yet); Step 14 `.env`, `.env.example`, `--env-file` in `dev`; Step 15 `tsx` + `tsx watch` dev script, `allowBuilds: esbuild: false`; commit `de03bcf` (Steps 13-15); Step 16 Zod-validated env in `config/env.ts` (reviewed, works); commit `e5053b5`; Step 18 `pino` + `lib/logger.ts` + `LOG_LEVEL` (reviewed, works; not committed); Step 19 `pino-pretty` piped in `dev` (reviewed, works); Step 20 `request-id` middleware + `types/express.d.ts` (reviewed, works); Step 20b incoming ID validated by regex (reviewed, works); Step 21 `pino-http` with redaction (reviewed, works; `express.d.ts` removed for now); Step 22 split into `app.ts` + `server.ts`, `express.json()` added (reviewed, works); Step 23 `middleware/not-found.ts` in §10.2 shape (reviewed, works); Step 24 `middleware/error-handler.ts` (reviewed, works); commit `04b203e` (logging + error handling) pushed; `postman/` folders ignored; Step 25 `lib/errors.ts` `AppError`, single error formatter (reviewed, works); Step 26 `docker-compose.yml` postgres + redis, healthy, Postgres on host port 5433; commit `a467fce`; Step 27 Drizzle + `pg`, `db/client.ts`, `/api/v1/health` checks the DB, `skipLibCheck` (reviewed, works); Step 28 design of `users` and `oauth_accounts` (done after 4 rounds); Step 29 Drizzle `users` + `oauth_accounts` schema (reviewed, correct); Step 30 `drizzle-kit`, `drizzle.config.ts`, migration `0000_tense_mentallo` applied; Step 31 `refreshTokens` table, migration `0001_gorgeous_thaddeus_ross` applied (reviewed: table correct, no drift; not committed yet); commit `d773545` (Step 31); Step 32 `packages/shared` set up + `registerSchema` (reviewed, works; not committed); Step 33 `bcryptjs` + `lib/hash.ts` + 72-byte password check (reviewed, works; fixed a `cost: string` bug; not committed); Step 34 `register()` in `modules/auth/auth.service.ts` + `CONFLICT` code (reviewed; tested success, duplicate, concurrent requests; not committed)
- **Current step:** Step 35 (fast mode) — `lib/serialize-error.ts` so DB errors never log query params; used in `logger.ts` and `http-logger.ts` (`wrapSerializers: false`, because pino-http overrides the logger's serializers); code given, tested in scratch; not done yet
- **Next:** validate middleware, register controller/route, login (dummy-hash compare against timing attacks), me, logout. Before Google OAuth: request logs include `url`/`query`, which would log the OAuth `code`. Redis client + `redis` in health wait until rate limiting
- **Deferred:** `packages/shared/tsconfig.json` and shared code wait until there is something to share (first Zod schema, at register), so that checklist item stays unticked until then
- **Notes:** TypeScript is pinned to `~6.0.3` on purpose (typescript-eslint 8.74.0 supports only `<6.1.0`; TS 7.0 has no stable JS API). Next.js 16 renamed `middleware.ts` to `proxy.ts`: decide when we reach it. Express 5 forwards async errors by itself, so §5.3 `lib/async-handler.ts` is probably not needed: decide when we reach error handling. `@types/node` waits until we use `process.env`; install the major that matches Node (24), not the latest. The dev script uses `tsx watch` because TS 6 wants `./x.js` import paths and plain Node cannot resolve them to `.ts`. Production needs a build step (not decided yet; discuss at the Docker step).
