# Universal Browser Control

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js (MCP server), Chromium extension service worker (Manifest V3)
- **Monorepo:** npm workspaces (`packages/shared`, `packages/mcp-server`, `packages/extension`)
- **MCP:** `@modelcontextprotocol/sdk` over stdio
- **Server ↔ extension transport:** WebSocket on `127.0.0.1` (`ws`)
- **Browser control:** Chrome DevTools Protocol through `chrome.debugger`, plus `chrome.*` extension APIs
- **Schemas:** Zod
- **Bundler:** esbuild
- **Tests:** Vitest (unit), Puppeteer with Chrome for Testing (end-to-end)
- **CI / releases:** GitHub Actions

## Project Rules

- Every file in the repository is written in English: code, identifiers, user-facing strings, documentation and commit messages.
- Commit messages follow Conventional Commits: `type(scope): description`, with types such as `feat`, `fix`, `chore`, `docs`, `refactor`, `test` and `ci`. Mark breaking changes with `!` after the type. Keep the subject line short and make it the best single description of the change; put the details in the commit body, written out in full.
- Commits, pull requests and anything else published to the repository carry only the repository owner's name and email. Never add AI or tool attribution: no `Co-Authored-By` trailers, no "Generated with" lines, no assistant names as author or committer.
- Do not write comments. Every hand-written file (anything that is not auto-generated) stays free of code comments, including config files such as YAML and `.gitattributes`.
- Whenever something is added to, changed in, or removed from the project, every `.md` file that references it must be updated in the same change.

