<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# workflows

## Purpose
GitHub Actions workflows for docs deployment and npm publishing.

## Key Files
| File | Description |
|------|-------------|
| `deploy-docs.yml` | Runs on push to `master` that touches `docs/**`, this file, or `package.json`, and on manual dispatch. Node 20, `npm install`, `npm run docs:build`, uploads `docs/.vitepress/dist`, deploys to GitHub Pages. Permissions: `contents: read`, `pages: write`, `id-token: write`. |
| `npm-publish.yml` | Runs when a GitHub release is created. Node 20, `npm i --legacy-peer-deps`, `npm publish` with `secrets.npm_token`. The package's `prepublishOnly` script runs `npm run lint:src` before publish. |

## For AI Agents

### Working In This Directory
- Neither workflow runs `npm test`. Run the tests locally before you create a release.
- The docs workflow only triggers on the listed paths. A change to `src/` alone does not redeploy the site.
- The publish workflow needs the `npm_token` repository secret.

### Testing Requirements
- Use `workflow_dispatch` on `deploy-docs.yml` to test a docs change without a push to `master`.

## Dependencies

### External
- `actions/checkout@v4`, `actions/setup-node@v4`, `actions/configure-pages@v4`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
