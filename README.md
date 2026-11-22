# note-remote-mcp

An experimental **unofficial note.com remote MCP server** (TypeScript + Streamable HTTP + Browserbase cloud browser). It aims to support drafts, cover and inline images, hashtags, paid preview boundaries and controlled publishing.

> **Experimental:** The code has not been verified end-to-end with an authenticated note.com account. Browser UI changes can break these tools. This repository is not affiliated with note.com. **Do not use with important content without reviewing the result.**

## MCP connection information (ChatGPT / Codex / Claude / Muse)

This repository contains **server source code**, not a publicly hosted MCP service. Before connecting a client, **deploy this server to your own HTTPS hosting** (Node.js 22+ or Docker) and configure its secrets.

| Setting | Value | Notes |
| --- | --- | --- |
| MCP URL | `https://YOUR_HOST/mcp` | Replace `YOUR_HOST` with **your deployed domain**. GitHub repository URLs cannot be used as MCP URLs. |
| Transport | `Streamable HTTP` | Not stdio or legacy SSE |
| HTTP header | `Authorization: Bearer YOUR_MCP_ACCESS_TOKEN` | The token must match the server-side `MCP_ACCESS_TOKEN` |
| Health endpoint | `https://YOUR_HOST/health` | Public lightweight status check; not the MCP endpoint |
| Authentication | Static Bearer token | **OAuth 2.1 is not implemented.** If a client requires OAuth and cannot send a custom Bearer header, this implementation will not connect. |
| Availability | Not deployed | No working public URL is provided by this repository |

**Never put a real access token into Git, a shared configuration, a screenshot or a chat message.** Use distinct secrets for Browserbase (`BROWSERBASE_API_KEY`) and MCP clients (`MCP_ACCESS_TOKEN`). Each connected client using the same bearer token gets the same note account access. Rotate it if exposed.

### 1. ChatGPT (web): integration prerequisites

**Compatibility warning (current build): ChatGPT cannot use this server's static Bearer-token authentication directly.** The ChatGPT custom-server connection currently offers OAuth, unauthenticated, or mixed OAuth/unauthenticated flows rather than arbitrary `Authorization` headers. **Do not remove authentication or publish your access token to make it connect.** To support ChatGPT safely, add MCP OAuth 2.1 authentication or place a properly secured OAuth-capable gateway in front of this server.

Additionally, **write-enabled custom MCP support** in ChatGPT is currently limited to eligible Business and Enterprise/Edu workspaces. A personal **Plus** plan does not provide the equivalent write-enabled custom MCP access. Consult the current plan requirements before attempting setup.

After the server supports a compatible authentication flow and the workspace allows custom MCP:

1. Open **ChatGPT on the web → Plugins → + → Add custom MCP server**.
2. Name it `note-remote-mcp`; set the server URL to `https://YOUR_HOST/mcp`.
3. Configure the supported **OAuth** authentication (not a static Bearer header).
4. Review the permissions and create/install the plugin. Refresh its tool list after server updates.
5. Invoke tools by selecting `@note-remote-mcp`. Confirm any write action before execution.

These are **future-compatible setup instructions**; this repository does **not** currently include the OAuth server required for ChatGPT web access.

Official: [OpenAI: Custom MCP server connection](https://developers.openai.com/api/docs/guides/custom-mcp-server), [OpenAI: Custom MCP availability](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).

### 2. Codex CLI / IDE

Codex supports HTTP MCP endpoints and environment-sourced bearer tokens. Store a real token in the **environment of the process launching Codex**, not in Git.

```bash
# Supply a strong token securely in your shell/secret manager first.
# The example assumes NOTE_MCP_TOKEN is already exported.
codex mcp add note-remote-mcp \
  --url https://YOUR_HOST/mcp \
  --bearer-token-env-var NOTE_MCP_TOKEN
```

Equivalent `~/.codex/config.toml`:

```toml
[mcp_servers.note-remote-mcp]
url = "https://YOUR_HOST/mcp"
bearer_token_env_var = "NOTE_MCP_TOKEN"
```

Run `codex mcp list` or `/mcp` to check connectivity. Codex's CLI and IDE extension share MCP configuration. **No local note/browser server installation is required by the client.**

Official: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp) and [Config reference](https://learn.chatgpt.com/docs/config-file/config-reference).

### 3. Claude Code (CLI)

Claude Code supports remote Streamable HTTP and custom Authorization headers:

```bash
# Assumes NOTE_MCP_TOKEN is already set in the invoking shell.
claude mcp add --transport http --scope user \
  note-remote-mcp https://YOUR_HOST/mcp \
  --header "Authorization: Bearer ${NOTE_MCP_TOKEN}"
claude mcp list
```

**Important:** The CLI may store the expanded token in local Claude configuration. To avoid embedding the token directly, use a private/untracked MCP configuration with environment-variable expansion instead:

```json
{
  "mcpServers": {
    "note-remote-mcp": {
      "type": "http",
      "url": "https://YOUR_HOST/mcp",
      "headers": {
        "Authorization": "Bearer ${NOTE_MCP_TOKEN}"
      }
    }
  }
}
```

Load it as a local/user MCP configuration (for example, a private `.mcp.json`), not a committed file with real credentials. Inspect status using `/mcp` in Claude Code.

Official: [Claude Code MCP](https://code.claude.com/docs/en/mcp).

### 4. Claude (claude.ai / Claude Desktop remote connector)

For supported Claude plans, go to **Customize → Connectors → Add → Custom/Web** (labels vary by client). Enter your own `https://YOUR_HOST/mcp`. In **Request headers**, supply `Authorization` with value `Bearer YOUR_MCP_ACCESS_TOKEN`, if the UI provides this option. Finish adding the connector and enable it in your conversation.

This is different from the Claude Code CLI configuration. The Claude-hosted connector needs an internet-accessible HTTPS endpoint; it cannot reach `localhost`. **Do not choose an OAuth sign-in flow for this bearer-only server.**

Official: [Claude remote MCP custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

### 5. Muse Code (Meta)

Muse Code declares MCP servers under `mcp_servers` in its settings JSON. Use the **remote** `streamable_http` transport, a URL and headers (not `stdio` or an executable command):

```json
{
  "mcp_servers": {
    "note-remote-mcp": {
      "transport": "streamable_http",
      "url": "https://YOUR_HOST/mcp",
      "headers": {
        "Authorization": "Bearer ${NOTE_MCP_TOKEN}"
      },
      "enabled": true,
      "mode": "optional"
    }
  }
}
```

Set `NOTE_MCP_TOKEN` in the environment running Muse Code; Muse documents `${VAR}` interpolation in server settings. Inspect available tools with `/mcp`. `muse mcp login <server>` is for **OAuth** servers and is **not applicable** to this bearer-only server.

Official: [Meta Muse Code — Extending and automating](https://dev.meta.ai/docs/muse-code/extending).

### Verify connectivity

After deployment, confirm the server answers on HTTPS:

```bash
curl --fail https://YOUR_HOST/health
# Expected: {"ok":true,"name":"note-remote-mcp"}
```

The MCP HTTP handler accepts up to **16 MiB per request** (including Base64 overhead); a batch of many large Base64 images can exceed this limit. Prefer allowlisted HTTPS image URLs for large batches.

A valid `GET /health` does **not** prove the MCP endpoint or authenticated note.com operations work. A `401` from `/mcp` usually means the bearer token is missing or invalid. Successful tool discovery still does not imply note's current editor UI is compatible.

## Server owner setup

1. Create a Browserbase project, API key and dedicated persistent browser context for your own note.com account.
2. Configure server-side secrets using the template `.env.example`: `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `BROWSERBASE_CONTEXT_ID`, `MCP_ACCESS_TOKEN`, optionally `IMAGE_ALLOWED_HOSTS`. Never commit actual secret values.
3. Keep `ENABLE_PUBLISH=false` until draft/cover/body-image/paid-line behavior is verified manually.
4. Deploy the Dockerfile to an HTTPS-accessible container host with a long-lived server process. Ensure `PORT` maps to the host's listening port.
5. Use the cloud-browser Live View for **manual note.com login**; never supply note passwords directly to the MCP tool.
6. Connect the clients using the instructions above. Login and publish flows are experimental and may require selector fixes.

## Tool overview

| MCP tool | Intent |
| --- | --- |
| `note_login_start` / `note_login_finish` | Cloud-browser interactive login |
| `note_session_check` | Validate existing session |
| `note_create_draft` | Save draft with title, body blocks, optional cover |
| `note_set_cover_image` | Upload article cover image |
| `note_insert_body_image` | Insert body image |
| `note_set_hashtags` | Set hashtags |
| `note_paid_preview` | Offline validation of free/paid blocks |
| `note_prepare_paid_article` | Prepare price and paid boundary for manual review |
| `note_review_article` | Open review Live View |
| `note_publish_review_session` | Explicitly confirmed, opt-in publishing |
| `note_close_review_session` | Close without publication |

The implementation and browser selectors are **not E2E tested** with note.com. Client config snippets describe **intended integration**, not confirmed live connections. Browserbase and hosting may incur usage charges.

## Development

```bash
npm install
npm run check
npm run build
npm test
```

## 日本語

本リポジトリは、note.com向けの非公式TypeScript製**リモートMCPサーバー（実験版）**です。ChatGPT / Codex / Claude / Meta Muse Codeの接続設定を上記に記載しました。**接続先URLはホスティング完了後に確定**します。noteのログイン、記事投稿、トップ画像・本文画像、有料ラインの設定は実アカウントでの動作確認が済んでいません。公開前には必ずご自身で確認してください。

## License

MIT
