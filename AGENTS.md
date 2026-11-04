<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# t140llm

## Purpose
`t140llm` is a Node.js/TypeScript library (npm package `t140llm`, v0.0.19, MIT) that converts LLM streaming responses into ITU-T T.140 real-time text. It accepts an `EventEmitter` or an `AsyncIterable` from any LLM SDK and sends each chunk as it arrives over WebSocket, RTP over UDP, SRTP, a Unix SEQPACKET socket, or a user-supplied `TransportStream`. It can also multiplex several LLM streams into one RTP stream, apply T.140 backspace rules per grapheme cluster, and forward LLM metadata (tool calls, reasoning).

## Key Files
| File | Description |
|------|-------------|
| `package.json` | Package manifest. Scripts: `build`, `lint`, `lint:src`, `test`, `test:watch`, `test:coverage`, `docs:dev`, `docs:build`, `docs:preview`. Entry `dist/index`. Node >= 16. |
| `tsconfig.json` | Base TypeScript config (extends `@reallyland/tsconfig`). CommonJS, `rootDir: src`, `outDir: dist`. Used by `npm run ts` and by tslint. |
| `tsconfig.prod.json` | Config for `npm run build`. Excludes only `src/test/` and `src/demo/`. The steganography module is compiled to `dist/steganography`. |
| `tslint.json` / `tslint.prod.json` | TSLint rules (extends `@reallyland/tslint-config`). Prod adds `no-debugger`. |
| `jest.config.js` | Jest config: node environment, `tests/**/*.test.ts`, babel-jest transform. No module mapping; suites import real modules. |
| `babel.config.js` | Babel presets (`preset-env` for current Node, `preset-typescript`) used by jest. |
| `README.md` | User-facing overview, quick start, transport table, links to docs. |
| `CLAUDE.md` | Build/test commands and code style rules for AI agents. |
| `LICENSE` | MIT. |
| `logo.gif` | README logo. |
| `.editorconfig` | 2-space indent, LF, UTF-8, final newline. |
| `.gitignore` | Ignores `dist/`, `coverage/`, `node_modules/`, `*.mjs`, `*.env`, `*.d.ts`, `docs/.vitepress/dist`, `docs/.vitepress/cache`. |
| `.npmrc` | npm client settings (`package-lock=true`). |
| `package-lock.json`, `pnpm-lock.yaml` | Lockfiles. Both are tracked. |

The untracked files `AUDIT_STRATEGY.md`, `BRANCH-*.md`, `FIXES-MASTER-CATALOG.md`, `REMEDIATION-PLAN-README.md`, `codebase-audit.prose`, and `fix-remaining-issues.prose` are audit/remediation working notes. They are not part of the package.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `src/` | Library source (see `src/AGENTS.md`) |
| `tests/` | Jest test suites (see `tests/AGENTS.md`) |
| `docs/` | VitePress documentation site (see `docs/AGENTS.md`) |
| `examples/` | Runnable Node.js demos (see `examples/AGENTS.md`) |
| `claudedocs/` | AI-generated audit and analysis reports, untracked (see `claudedocs/AGENTS.md`) |
| `.github/` | GitHub Actions workflows (see `.github/AGENTS.md`) |
| `.husky/` | Git hooks (see `.husky/AGENTS.md`) |
| `scripts/` | Empty. |
| `dist/` | Build output. Generated and git-ignored. |
| `coverage/` | Jest coverage output. Generated and git-ignored. |
| `.remember/`, `.omc/`, `.serena/`, `.claude/` | Local tool state. Not part of the package. |

## For AI Agents

### Working In This Directory
- Follow `CLAUDE.md`: 2-space indent, semicolons, single quotes, kebab-case file names, PascalCase interfaces/classes, camelCase members, ALL_CAPS constants, JSDoc on public APIs.
- Make the smallest change that meets the goal. Do not add files, abstractions, or fallback code that the task does not need.
- Do not commit or push without explicit permission from the user.
- `npm run build` uses `tsconfig.prod.json` and compiles all of `src/`, including `src/steganography/` into `dist/steganography`. `npm run ts` compiles with `tsconfig.json`. babel-jest strips types without checking them, so run `npx tsc --noEmit -p tsconfig.json` as well as the tests.
- Steganography is an optional module. `src/index.ts` does not re-export it; consumers import `t140llm/dist/steganography`. It needs the `@agrathwohl/llm-steg` optional dependency, which lives on GitHub Packages and needs a token with the `read:packages` scope. `.npmrc` holds the scope registry and reads the token from `NODE_AUTH_TOKEN`.

### Testing Requirements
- `npm test` runs all suites. `npx jest tests/<name>.test.ts` runs one suite.
- `npm run lint:src` must pass. The husky pre-commit hook runs it.

### Common Patterns
- The public API is a set of `processAIStream*` functions plus `create*Transport` factories in `src/processors/`.
- Transports extend `EventEmitter` and emit `'error'` with a typed `T140RtpError`.
- Redundancy (`redEnabled`) is on by default, so every RTP packet is text/red (payload type 98) and the text is not at offset 12. Read it with `extractT140Text`.
- All protocol constants (ports, payload types, header offsets, rate limits) live in `src/utils/constants.ts`.

## Dependencies

### External
- `werift-rtp`: SRTP session and RTP packet types
- `werift-dtls`: DTLS-SRTP handshake for automatic SRTP key management. Import it through `werift-dtls/lib/dtls/src`: the package declares a `main` file it does not ship.
- `ws`: WebSocket client and server
- `node-unix-socket`: Unix SEQPACKET socket bindings
- `debug`: namespaced logging (`t140llm:*`)
- Optional: `@agrathwohl/llm-steg` for the steganography module
- Dev: `jest`, `babel-jest`, `ts-jest`, `typescript` 4.9, `tslint`, `vitepress`, `@anthropic-ai/sdk`, `dotenv`, `shx`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
