# nextboyfriend-mcp

Model Context Protocol (MCP) server for [SocialAPI.ai](https://social-api.ai): list accounts, create and schedule posts, inbox/comments, usage, and replies.

## Docs

- **[Automation plan & action checklist](docs/AUTOMATION.md)** — GitHub Actions, Grok/xAI Imagine, HeyGen, SocialAPI, Claude, and gaps for “lights out” runs.

## Quick start

```bash
cp .env.example .env   # if present; otherwise set SOCAPI_KEY manually
npm install
npm run build
node dist/index.js     # stdio MCP; configure Cursor to run this with env
```

Required env: `SOCAPI_KEY` or `SOCIAL_API_KEY` (see [SocialAPI docs](https://docs.social-api.ai/)). Optional: `ANTHROPIC_API_KEY`, `HEYGEN_API_KEY` (see `.env.example`).

## Cursor MCP

This repo includes [`.cursor/mcp.json`](.cursor/mcp.json): **`npx -y tsx`** running **`src/index.ts`** with **`cwd`** set to the workspace. Open the folder in Cursor, enable MCP for the project, and reload if the server does not appear.

If `${workspaceFolder}` is not expanded in your Cursor version, replace it with the absolute path to this repo in `args` and `cwd`, or paste the same `command` / `args` into **Cursor Settings → MCP**.

## License

ISC
