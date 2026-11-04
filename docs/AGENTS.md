<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# docs

## Purpose
VitePress documentation site, published to GitHub Pages at `https://agrathwohl.github.io/t140llm/` by `.github/workflows/deploy-docs.yml`.

## Key Files
| File | Description |
|------|-------------|
| `index.md` | Home page (`layout: home`, hero and action buttons). |
| `guide.md` | Overview, install, quick start, transport table. Shares text with `../README.md`. |
| `providers.md` | How to pass streams from OpenAI, Anthropic, Gemini, Mistral, Cohere, Ollama, and the Vercel AI SDK. |
| `api.md` | Reference for processing functions, transport factories, classes, and config options. |
| `types.md` | `RtpConfig`, `SrtpConfig`, `TransportStream`, metadata, and error types. |
| `steganography.md` | Optional steganography module guide. |
| `examples.md` | Index of the runnable demos in `../examples/`. |
| `.vitepress/config.mts` | Site config: title, `base: '/t140llm/'`, `cleanUrls`, nav, sidebar, local search, GitHub link. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `.vitepress/` | Site config plus generated `dist/` and `cache/`. Only `config.mts` is tracked. |

## For AI Agents

### Working In This Directory
- Internal links use clean URLs with anchors, for example `/types#rtpconfig`. Keep that form.
- Type and class names in prose link to their definitions (commit `cb19ffb`). Keep new references in the same style.
- When you change public API text in `guide.md`, make the same change in `../README.md`.
- Do not edit `.vitepress/dist/` or `.vitepress/cache/`. They are generated and git-ignored.

### Testing Requirements
- `npm run docs:build` must succeed. `npm run docs:dev` serves the site locally.

### Common Patterns
- Reference pages (`api.md`, `types.md`) start with a one-line summary and a bulleted table of contents.
- Code samples are TypeScript with double quotes.

## Dependencies

### Internal
- Documents the API in `../src/`.

### External
- `vitepress` (dev dependency)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
