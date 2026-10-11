# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately, not in a public issue.

Open the repository's **Security** tab on GitHub and click **Report a vulnerability**. This sends a private report that only the maintainer can see.

Include what you can of the following:

- what the vulnerability allows an attacker to do
- the steps or a proof of concept to reproduce it
- the release version, browser and operating system you tested with

You will get a reply once the report has been reviewed. Please give the maintainer a reasonable amount of time to release a fix before disclosing the issue publicly.

## Supported versions

Only the latest release receives security fixes.

## What counts as a vulnerability

Examples of issues that should be reported:

- a web page or another origin connecting to the MCP server, or driving the browser without an MCP client asking for it
- bypassing the `Origin` check or the token check on the server's WebSocket endpoints
- the extension acting on tabs or data while control is turned off in its popup
- the on-page indicator being suppressed or spoofed by a web page
- a web page reading data from, or injecting code into, the extension itself

## What does not

The following are known properties of the tool, described in the [README](README.md), and are not treated as vulnerabilities:

- prompt injection: content on a page convincing the connected model to take actions
- a connected model making mistakes or taking unwanted actions
- an MCP client that has been given access using the tools as designed, including `evaluate_js` and `cdp_send`
- other software running under the same user account connecting to the local server
