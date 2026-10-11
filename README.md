# Universal Browser Control

Let AI models control your real browser through MCP. A Chromium extension plus an MCP server, with tools for tabs, pages, input and DevTools.

Works in Chromium-based browsers: Chrome, Edge, Brave, Opera, Vivaldi and others.

> [!WARNING]
> **This gives an AI model the same power over your browser that you have.** Read this before installing.
>
> A connected model can do anything you can do in the browser, on every site where you are logged in: read your email and messages, send them, buy things, move money, change passwords and settings, delete data, and read your cookies, history and saved page content. Nothing in this project asks you for confirmation before an action; whether a model asks first depends entirely on the client you connect.
>
> What can go wrong:
>
> - **Prompt injection.** Any page the model reads can contain text written to hijack it: a web page, an email, a comment, a search result, an ad, hidden text you cannot see. An injected model may follow those instructions instead of yours, for example by opening your mail, copying what it finds to an attacker's site, or acting on your accounts. There is no reliable defense against this today.
> - **Mistakes by the model.** Models misread pages, click the wrong button, fill the wrong field, submit forms early, and misunderstand what you asked. Weaker or cheaper models do this far more often. On a real account a wrong click can be a sent message, a placed order, a deleted file or a changed setting, and many of those cannot be undone.
> - **Data leaving your machine.** Everything the model reads (page text, screenshots, cookies, network traffic) is sent to the model's provider and may be logged there. That includes private pages, other people's personal data, and session cookies or tokens that give access to your accounts.
> - **Running code and raw DevTools access.** The `evaluate_js` and `cdp_send` tools let the model run arbitrary JavaScript in any page and send any DevTools command, which is enough to bypass most protections a site relies on.
> - **Downloads and uploads.** The model can download files to your computer and upload any file it is given a path for.
> - **Anything local can connect.** The MCP server only listens on your own machine, but any program running under your user account could use it to drive your browser.
>
> How to lower the risk:
>
> - If your client or provider offers an auto mode, where a separate classifier checks every action before it runs, use it instead of approving everything blindly or turning approvals off.
> - Use a separate browser profile with only the accounts the task needs, not your everyday profile.
> - Stay signed out of banking, payment, email and admin accounts in that profile unless the task needs them.
> - Use a capable model, keep your client's permission prompts on, and watch what it does; controlled tabs are outlined and labeled.
> - Turn control off in the extension popup when you are not using it.
> - Do not point it at pages you do not trust while sensitive accounts are open.
>
> You use this at your own risk; see [LICENSE](LICENSE).

## Install

Download the extension zip and the MCP server file from the latest release, or build them yourself:

```bash
npm install
npm run build
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select `packages/extension/dist` (or the unzipped release folder).
2. Add the MCP server to your client. For Claude Code:

```bash
claude mcp add universal-browser-control -- node /full/path/to/packages/mcp-server/dist/index.cjs
```

For other clients, the command is `node` and the argument is the full path to that `.cjs` file.

The extension connects to the server on its own within about 30 seconds; clicking its toolbar icon connects immediately.

## Tools

The tools cover tabs and windows, reading pages, interacting with them, DevTools access and browser data. All of them are listed with their parameters in [docs/tools.md](docs/tools.md).

Tabs the model opens go into a tab group named after the MCP client, and every tab it controls shows a colored outline with a "This tab is being controlled by …" label. The outline goes away after a minute without commands and comes back with the next one.

## Settings

- **Port:** 9234 by default. Change it with the `UBC_PORT` environment variable (or `--port`) on the server and in the extension popup; both must match.
- **Browser label:** set in the extension popup to tell browsers or profiles apart when several are connected.
- **On/off:** the checkbox in the extension popup turns control off entirely.

## Good to know

- While a tab is being controlled, the browser shows its "started debugging this browser" bar. The `debugger_detach` tool or the button in the popup ends it.
- Browser-internal pages (`chrome://`, the extension store, other extensions) cannot be controlled.
- Incognito tabs need "Allow in Incognito" turned on in the extension's details page.

## Development

```bash
npm run typecheck
npm test
npm run test:e2e
```

Tool definitions are in `packages/shared/src/tools.ts`; their implementations are in `packages/extension/src/background/handlers/`. How the pieces fit together is described in [docs/architecture.md](docs/architecture.md). Every push to `main` publishes a new release.

## License

Free to use, modify and redistribute, as long as the original author stays credited and the project is not presented as someone else's own. See [LICENSE](LICENSE).
