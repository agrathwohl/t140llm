<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# .husky

## Purpose
Git hooks managed by husky.

## Key Files
| File | Description |
|------|-------------|
| `pre-commit` | Runs `npm run lint:src` (tslint over `src/**/*.ts` with `tslint.prod.json`). A lint error blocks the commit. |

## For AI Agents

### Working In This Directory
- Run `npm run lint:src` before you finish a change so the hook passes.
- Do not bypass the hook with `--no-verify`.
