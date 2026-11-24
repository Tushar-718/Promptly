# CLAUDE.md — Rules for AI assistants on Promptly

**Read `implementation.md` first.** It is the source of truth for architecture, schema, API, limits and decisions.
It is imported below, so Claude Code loads it automatically in every session:

@implementation.md

## How we work (one small step at a time)
1. Give **one small step** and explain **why it is needed now**. Then stop and wait.
2. The developer makes the edit and says "done".
3. Read the actual files and review them: what is correct, what is wrong and why. Then give the next step.

- Files grow gradually. Add only the dependency or lines needed right now; never write a whole file (Dockerfile, package.json, config…) in one go.
- Don't edit project files for the developer unless asked. Exception: keep the "Current progress" section below up to date.
- `implementation.md` §5 is a **blueprint for context**, not a list of files to create. **Never create files or folders ahead of time.** Each one is created by the developer in the step that needs it.
- Before a new file or folder is created, explain **why this code deserves its own file** (what problem the separation solves). Where useful, start in one file and split it when the need shows up, ending at the §5 structure.

## Who writes what
- The developer is **learning** backend and GenAI. They write the **backend business logic** themselves (services, auth flows, RAG pipeline, prompt building, queue processors).
- The developer decides how much help they want for each request. When it isn't stated, **explain and hint first**. Don't write whole features or files of business logic unless explicitly asked.
- You **may write boilerplate fully** only when explicitly asked for the full file (the default is the step-by-step flow above): Dockerfile, docker-compose, tsconfig, eslint/prettier, package.json scripts, drizzle config, Next.js/Tailwind/shadcn setup, `.env.example`.
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
- **Checklist item:** pnpm workspace, `tsconfig.base.json`, `packages/shared`
- **Completed steps:** Step 1 root `package.json`; Step 2 `pnpm-workspace.yaml`; Step 3 `packages/shared/package.json`; Step 4 `apps/api` + `apps/web` `package.json`; Step 5 `.gitignore` + `git init` (no commits yet); Step 6 TypeScript `~6.0.3` at the root; Step 7 `tsconfig.base.json`
- **Current step:** Step 8 — first git commit, not done yet
- **Next:** Step 9 — start the API: install Express in `apps/api`
- **Deferred:** `packages/shared/tsconfig.json` and shared code wait until there is something to share (first Zod schema, at register), so that checklist item stays unticked until then
- **Notes:** TypeScript is pinned to `~6.0.3` on purpose (typescript-eslint 8.74.0 supports only `<6.1.0`; TS 7.0 has no stable JS API). Next.js 16 renamed `middleware.ts` to `proxy.ts`: decide when we reach it.
