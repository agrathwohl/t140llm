<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# claudedocs

## Purpose
Audit and analysis reports written by AI agents between January and March 2026. The directory is untracked in git. The reports are historical: they describe the code at the version named in each header, and later commits changed some of that code.

## Key Files
| File | Description |
|------|-------------|
| `UNSOLVED_BUGS.md` | Bugs found in v0.0.14 (2026-01-15) that were open at that time. |
| `audit-bugs.md` | Bugs and errors audit of v0.0.18 (2026-02-22). |
| `audit-maintainability.md` | Maintainability and readability audit of v0.0.18 (2026-02-22). |
| `audit-security-practices.md` | Security and bad-practice audit of v0.0.18 (2026-02-22). |
| `audit-workflow.md` | Remediation plan that consumes the three audits above (2026-02-22). |
| `async-iterator-workflow.md` | Implementation plan for `AsyncIterable` stream support (2026-02-23). |
| `latency-analysis.md` | Streaming latency analysis of v0.0.19 with implementation results (2026-03-11). |
| `steganography-extraction-analysis.md` | Feasibility study for moving steganography into a standalone library. |

## For AI Agents

### Working In This Directory
- Treat each finding as a hypothesis. Check the current `../src/` before you act on it. Many items were fixed after the report date.
- Do not add new reports here unless the user asks. The root `BRANCH-*.md` and `FIXES-MASTER-CATALOG.md` files hold the later remediation plan.

### Testing Requirements
- None. These are documents.

### Common Patterns
- Each report starts with a header block: date, scope, version.

## Dependencies

### Internal
- Describes `../src/` and `../tests/`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
