---
title: Use with agents
description: Give an agent a holo as a tool, serve it over MCP, or let an agent write the model.
available_in: "1.0-beta"
---
This guide covers three ways agents and holos meet. An agent can call a holo as a tool, an agent can reach it as a Model Context Protocol server, and an agent can write the model that becomes a holo. In every case the holo is checked before the first call.

What ships today is different: `asTool`, `holo.verify()` and the `@prism-code/mcp` package below are planned for 1.0-beta and are not on npm. Today `npx prism-code@latest init` writes a starter model and the Prism skill into the project, and an agent that reads the skill checks, proves and builds the app with the `prism-code` command alone. To give an agent a built holo as a tool now, wrap `load` and `app.dispatch` in a tool of your own.

## As a tool with the Vercel AI SDK

`asTool(holo)` returns a tool shaped for the Vercel AI SDK: an `inputSchema` taken from the holo's world and an `execute` that dispatches to a checked instance. The agent sees a typed tool. It cannot see or change the capability set:

```ts
import { generateText } from "ai";
import { load, asTool } from "prism-code";

const holo = await load("calculator@sha256:3f9c…");

const result = await generateText({
  model: languageModel,
  tools: { calculator: asTool(holo) },
  prompt: "What is 2 plus 3?",
});
```

```text
tool call    calculator  {"op": "add", "a": 2, "b": 3}
tool result  5
```

`asTool` runs `holo.verify()` before the first `execute` and throws `VerificationError` when the verdict is not a pass. Every call is recorded in the instance history, so an agent session replays like any other run. An input outside the schema is rejected before it reaches the instance.

## As an MCP server

`@prism-code/mcp` exposes a holo as a Model Context Protocol server. Each export in the world becomes one tool. Start it on standard input and output:

```bash
npx @prism-code/mcp calculator@sha256:3f9c…
```

```text
Checked calculator@sha256:3f9c…  Level: P3
MCP server on stdio.  Tools: calculate
```

Point any MCP client at it. For a client that reads a JSON configuration:

```json
{
  "mcpServers": {
    "calculator": {
      "command": "npx",
      "args": ["@prism-code/mcp", "calculator@sha256:3f9c…"]
    }
  }
}
```

The server refuses to start when the check fails, and it grants the instance exactly the capability set from the holo. The agent gets the tool description from the world, so it never guesses at the input shape.

## Let an agent write the model

An agent writes the app's LexLean model with the Prism skill that `npx prism-code@latest init` puts in the project: it starts from a content-addressed starter, runs `npx prism-code check` after every edit, and shows you the guarantees Lean proves. `check` reads the proof, not who wrote the model.

## Next steps

- [Write the model](/docs/guides/write-the-model)
- [Audit a holo](/docs/guides/audit)
- [Use a holo as a tool](/docs/api/as-tool)
