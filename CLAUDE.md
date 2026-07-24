# CLAUDE.md — shift-scheduler-ai

This file provides guidance for Claude (claude-code-action) when working in this repository.

---

## Repository Purpose and Scope

`info-mnml/shift-scheduler-ai` is an AI-powered shift scheduling system for MNML's retail/service operations. It manages multi-tenant shift planning, staff preferences collection (via LINE), and payroll analytics across multiple stores and business entities.

**Core capabilities:**
- Multi-tenant shift management (multiple companies → businesses → stores)
- AI-assisted shift generation using OpenAI GPT-4 / Anthropic Claude
- Dashboard with sales, labor cost, and profit analytics
- LINE integration for collecting staff shift preferences
- CSV/PDF export and SharePoint backup

**Directory layout:**
```
shift-scheduler-ai/
├── frontend/       # React 19 + Vite SPA (deployed to Vercel)
├── backend/        # Node.js + Express API (deployed to Railway)
├── scripts/        # DB setup, migration, debug, and backup scripts
├── docs/           # Architecture docs, design docs, guides
└── fixtures/       # Demo/test data (CSV)
```

---

## MNML Organization

This repository is owned and operated by the **shift M-layer** (`info-mnml/shift`), which is responsible for staff scheduling and payroll across MNML's stores.

| M-layer | Role |
|---|---|
| **shift** | **Owner of this repo** — shift scheduling, payroll analytics |
| thebotch | Originally forked from here; still referenced in some package metadata |
| chief / ba / consulting / web / events / sns | Other M-layers; unrelated to this repo's domain |

When changes touch business logic or deployment, coordinate with the shift M-layer before merging.

---

## claude-code-action Operation Rules

### How Claude is triggered

- Mention `@claude` in a GitHub Issue body to trigger `claude-code-action`.
- Claude creates a branch `claude/issue-<num>-<date>-<time>` and opens a PR.
- Claude updates a single comment in the Issue to report progress; it does **not** post multiple comments.

### Auto-merge

- Add the `auto-merge` label to a PR to enable automatic merging once all CI checks pass.
- Without the label, a human reviewer (shift M-layer) must approve before merging.

### PR titles and commit messages

- **Always in English.** (Issue bodies may be in Japanese; titles/commits must be English.)
- Follow conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`.
- Include the co-author trailer:
  ```
  Co-authored-by: claude[bot] <claude[bot]@users.noreply.github.com>
  ```

### CI must pass

Before a PR is merged, the following checks defined in `.github/workflows/ci.yml` must all pass:

| Check | Command |
|---|---|
| Frontend ESLint | `cd frontend && npm run lint` |
| Frontend Prettier | `cd frontend && npm run format:check` |
| Frontend tests | `cd frontend && npm run test -- --run` |
| Frontend build | `cd frontend && npm run build` |
| Backend tests | `cd backend && npm run test -- --run` |
| Backend syntax | `cd backend && node --check src/server.js` |

Always run linting and tests before committing when touching `frontend/` or `backend/`.

---

## Issue / PR Template Expectations

Issues and PRs should contain the following sections (in Japanese is fine):

```markdown
## 経緯
<!-- Background / why this change is needed -->

## 要件
<!-- Requirements / what needs to be done -->

## 受け入れ条件
<!-- Acceptance criteria — checkboxes preferred -->
```

Claude will read these sections to understand the task scope and acceptance criteria.

---

## Coding Standards

### Frontend (`frontend/`) — React 19 + Vite

- **Package manager**: pnpm (`pnpm install`, `pnpm run dev`)
- **Linter**: ESLint v9 (flat config at `frontend/eslint.config.js`)
  - Plugins: `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`
  - Run: `cd frontend && npm run lint` (or `npm run lint:fix` to auto-fix)
- **Formatter**: Prettier (config at `frontend/.prettierrc`)
  - Run: `cd frontend && npm run format:check` / `npm run format`
- **Testing**: Vitest + Testing Library (`cd frontend && npm run test -- --run`)
- **UI**: Tailwind CSS v4, Radix UI primitives, shadcn/ui components
- **State**: React hooks only — no external state library
- **Routing**: React Router v6
- **Date handling**: Always use `YYYY-MM-DD` string format. **Never** use `new Date()` for date arithmetic (causes JST/UTC offset bugs). Use `dateUtils.js` helpers.
- **No comments** explaining what the code does — only add a comment when the *why* is non-obvious.

### Backend (`backend/`) — Node.js ESM + Express

- **Runtime**: Node.js ≥18, ESM (`"type": "module"`)
- **No dedicated linter** — keep style consistent with existing code (single quotes, no semicolons at file level, 2-space indent).
- **Testing**: Vitest + supertest (`cd backend && npm run test -- --run`)
- **DB queries**: Use `node-postgres` (`pg`) directly. No ORM. Parameterized queries only — never string-interpolate user input into SQL.
- **Store filtering in shift queries**: Filter by `sh.store_id` (the shift's store), not `staff.store_id` (the staff's home store) — this supports cross-store coverage shifts.

### Scripts (`scripts/`) — Node.js ESM `.mjs`

- Scripts generate SQL files or perform one-shot operations. Claude should **not** execute database-connecting scripts directly; generate the script and let the operator run it.

---

## Prohibited Files — Never Commit

The following must never appear in commits:

- `.env` files (any directory)
- `credentials*.json`, `service-account*.json`
- `.tokens*.json`
- Any file containing raw API keys, database URLs, or private keys

These are already covered by `.gitignore`. If you accidentally stage one, remove it immediately with `git rm --cached`.

---

## Branch and Merge Rules

| Rule | Detail |
|---|---|
| `main` | Production branch — **no direct push**. Only merged via PR with CI passing. |
| `staging` | Staging branch — integration testing before production release. |
| `claude/issue-<num>-*` | Branches created by claude-code-action for Issue-driven work. |
| `feature/<desc>` / `fix/<desc>` / `docs/<desc>` / `refactor/<desc>` / `chore/<desc>` | Human-created branches — cut from `staging` unless it's a hotfix. |
| `hotfix/<desc>` | Cut from `main` for emergency production fixes; backport to `staging` after merge. |

Merge flow: feature branch → `staging` (review + integration test) → `main` (production release).

---

## Staging Verification Flow

**Zero-production-impact principle**: every change must be verified on the staging environment before it reaches production. The full runbook is the source of truth:

→ [`docs/operations/staging-verification-flow.md`](docs/operations/staging-verification-flow.md)

Key points:

- Branch → environment: `feature/* · fix/*` → Vercel Preview (on PR) / `staging` → Railway staging (backend + DB) + Vercel staging (frontend) / `main` → production (production DB).
- Pushing to `staging` deploys automatically; promotion `staging` → `main` is a **manual PR** gated on the verification checklist.
- Verification checklist (run on staging, required before merging to `main`):
  1. `GET {staging}/api/health` → 200, `database.connected: true`, `database.host` contains `switchyard` — **abort immediately if `mainline` (production DB) appears**.
  2. Main screens render (top / shift calendar / dashboard).
  3. One successful shift generation (small tenant, one month).
  4. Visual check of the changed functionality.
- PRs targeting `main` must fill in the "staging 検証結果" section of `.github/pull_request_template.md` with URLs, JST timestamps, and results. Docs-only changes may state a reason for skipping instead.

---

## Deployment

| Target | Platform | Notes |
|---|---|---|
| Frontend SPA | Vercel | Config: `frontend/vercel.json` |
| Backend API | Railway | `backend/vercel.json` is legacy — the API no longer deploys to Vercel (verified via `/api/health`) |
| Database | Railway (PostgreSQL 15+) | Connection via `DATABASE_URL` env var |
| DB Backup | SharePoint | Via `scripts/backup/` + GitHub Actions workflow |

### Deployment Environments

| Component | Staging | Production |
|---|---|---|
| Frontend (React SPA) | Vercel Preview / staging alias | Vercel Production |
| Backend API (Express) | Railway staging (`shift-scheduler-ai` staging env) | Railway production (`shift-scheduler-ai-production.up.railway.app`) |
| Database (PostgreSQL) | Railway staging (`humble-manifestation` / `switchyard:26491`) | Railway production (`lucky-appreciation` / `mainline:50142`) |

---

## Local Development

```bash
# Backend
cd backend && npm install && npm run dev   # http://localhost:3001

# Frontend
cd frontend && pnpm install && pnpm run dev  # http://localhost:5173
```

Environment variables: copy `.env.example` → `.env` in the relevant directory and fill in values.

---

## Key Conventions from `.claude/instructions.md`

The `.claude/instructions.md` file contains additional project-specific rules established before claude-code-action was adopted. Key points that remain valid:

- **Do not connect to the database directly.** Generate SQL/scripts; let the operator execute them.
- **No debug code in commits.** Remove all `// DEBUG:` comments before committing.
- **Date arithmetic**: string-based `YYYY-MM-DD` only — no `new Date()`.
- **Store filtering**: always `sh.store_id`, not `staff.store_id`, in shift queries.
