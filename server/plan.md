# Agent Plan

## Goal

`agent/` is a JavaScript universal Agent kernel.

- One Agent loop: message -> model -> tools -> model.
- Any model uses the OpenAI-compatible protocol.
- Built-in, global, workspace, and plugin tools extend behavior without registration.
- Messages are the single business truth and remain editable plaintext JSONL.
- Core exports only `Agent.send()` and `Agent.stop()`.

## Structure

```text
agent/
├── package.json
├── server.js
├── store.js
├── commands/
│   ├── auth.js
│   ├── config.js
│   ├── workspace.js
│   ├── session.js
│   └── agent.js
├── features/
│   ├── loop.js
│   ├── context.js
│   ├── compact.js
│   ├── permission.js
│   ├── checkpoint.js
│   ├── fork.js
│   └── plugin.js
├── utils/
│   ├── llm.js
│   ├── retry.js
│   ├── tool.js
│   └── path.js
├── tools/
│   ├── file.js
│   ├── edit.js
│   ├── shell.js
│   ├── grep.js
│   ├── glob.js
│   ├── web.js
│   └── control.js
└── plugins/
    ├── title/index.js
    ├── mcp/index.js
    ├── websearch/index.js
    └── cron/index.js
```

## Data

```js
store = {
  config: Config,
  workspaces: { [workspaceId]: Workspace },
  sessions: { [sessionId]: Session },
  runtimes: { [sessionId]: Runtime },
}

Config = {
  providers: [{ name, baseURL, key, models: [{ id, contextWindow, maxOutput }] }],
  prompts: { system, tool, summary },
  retry: { baseDelay, factor, maxDelay },
  context: { compactRatio, idleRounds },
  permission: [{ tool, match, action: 'allow' | 'ask' }],
  auth: { username, password },
  plugins: { [name]: { enabled, settings } },
}

Workspace = {
  id,
  path,
  sessions: [{ id, title, lastActiveAt }],
}

Session = {
  id,
  workspaceID,
  provider,
  model,
  messages: UIMessage[],
}

Runtime = {
  status: 'idle' | 'running',
  abortController,
  clients: Set<SSEClient>,
  processes: Set<Subprocess>,
  permission: Map<toolCallId, resolve>,
  events: UIMessageChunk[],
}

UIMessage = AI SDK UIMessage with optional { summary: true, usage }

Tool = {
  name,
  description,
  inputSchema,
  execute(input, context) => Promise<{ output, stop? }>,
}

ToolContext = { sessionID, messageID, partIndex, signal, receive, checkpoint, retry }
```

## Runtime Data

```text
~/.agent/
├── config.json
├── workspaces.json
├── tools/                     global custom tools
├── plugins/                   user plugins
└── sessions/<sessionId>/
    ├── meta.json
    ├── messages.jsonl
    ├── undo.jsonl              rollback 前的消息与文件状态
    └── undo/<sequence>

<workspace>/.agent/tools/      workspace custom tools
```

## Entry

### `server.js`

| Method | Input | Output |
|---|---|---|
| `start(port)` | `port?` | HTTP server |
| `shutdown()` | none | `Promise<void>` |

Startup calls `Store.load()` then `Plugin.load()`. Routes call commands or features directly. Every route is an Elysia schema-validated HTTP endpoint.

| Route | Method |
|---|---|
| `/health` | return `{ ok: true }` |
| `/login`, `/logout` | `Auth.login`, `Auth.logout` |
| `/config` | `Config.read`, `Config.save` |
| `/workspace` | `Workspace.list`, `Workspace.add`, `Workspace.remove` |
| `/session` | `Session.read`, `Session.create`, `Session.update`, `Session.remove` |
| `/agent/send`, `/agent/stop` | `Agent.send`, `Agent.stop` |
| `/session/events` | session SSE stream |
| `/permission/decide` | `Permission.decide` |
| `/session/compact` | `Compact.run` |
| `/checkpoint/rollback`, `/checkpoint/undo` | `Checkpoint.rollback`, `Checkpoint.undo` |
| `/session/fork` | `Fork.create` |
| `/plugin` | `Plugin.list`, `Plugin.load`, `Plugin.unload` |
| `/tool` | `Tool.list` |

### `store.js`

| Method | Input | Output |
|---|---|---|
| `Store.load()` | none | loaded `store` |
| `Store.save(domain)` | `'config' \| 'workspaces' \| sessionID` | `Promise<void>` |
| `Store.broadcast(sessionID, event)` | session id, UI message event | `Promise<void>` |

`Store.save()` writes config, workspace metadata, session metadata, or message JSONL. `Store.broadcast()` stores current runtime events and sends them to connected clients.

## Commands

### `commands/auth.js` - `Auth`

| Method | Input | Output |
|---|---|---|
| `login(username, password)` | credentials | cookie token or `null` |
| `logout(token)` | cookie token | `void` |
| `verify(token)` | cookie token | `boolean` |

### `commands/config.js` - `Config`

| Method | Input | Output |
|---|---|---|
| `read()` | none | `Config` |
| `save(patch)` | partial `Config` | updated `Config` |

### `commands/workspace.js` - `Workspace`

| Method | Input | Output |
|---|---|---|
| `list()` | none | `Workspace[]` |
| `add(path)` | workspace path | `Workspace` |
| `remove(id)` | workspace id | `boolean` |

### `commands/session.js` - `Session`

| Method | Input | Output |
|---|---|---|
| `read(id)` | session id | `Session \| null` |
| `create(workspaceID, provider, model)` | ids and model names | `Session` |
| `update(id, patch)` | session id, `{ provider?, model?, title? }` | `Session` |
| `remove(id)` | session id | `boolean` |
| `append(id, message)` | session id, `UIMessage` | `Promise<void>` |
| `rewrite(id)` | session id | `Promise<void>` |
| `listen(id)` | session id | SSE `ReadableStream` |

### `commands/agent.js` - `Agent`

| Method | Input | Output |
|---|---|---|
| `send(sessionID, message)` | session id, text or `UIMessage` | accepted user `UIMessage` |
| `stop(sessionID)` | session id | `boolean` |

`send()` stops a running session first, appends the user message, then starts `Loop.run(sessionID)`. `stop()` aborts model work and current tool processes.

## Features

### `features/loop.js` - `Loop`

| Method | Input | Output |
|---|---|---|
| `run(sessionID)` | session id | `Promise<void>` |

Loop builds context, streams one model response, appends it, executes all tool calls in parallel, and repeats. It stops only when user stops, a tool returns `stop`, or configured idle rounds are reached.

### `features/context.js` - `Context`

| Method | Input | Output |
|---|---|---|
| `build(sessionID)` | session id | `{ messages, tools, instructions }` |
| `count(messages)` | `UIMessage[]` | token count |

Context shape after a summary is: first three messages + three messages before summary + summary + every message after summary.

### `features/compact.js` - `Compact`

| Method | Input | Output |
|---|---|---|
| `run(sessionID)` | session id | summary `UIMessage` |

Compact appends an assistant message with `summary: true`. It never removes original messages.

### `features/permission.js` - `Permission`

| Method | Input | Output |
|---|---|---|
| `request(sessionID, callID, tool, input)` | tool call information | `Promise<boolean>` |
| `decide(sessionID, callID, action, scope)` | `deny \| allow`, `once \| always` | `boolean` |

`request()` waits without timeout when a rule asks. `decide()` supports deny once, allow once, and allow always.

### `features/checkpoint.js` - `Checkpoint`

| Method | Input | Output |
|---|---|---|
| `save(sessionID, position, path)` | session id, `{ messageID, partIndex }`, file path | `Promise<void>` |
| `rollback(sessionID, position)` | session id, message part position | restored `Session` |
| `undo(sessionID)` | session id | rollback 前的 `Session \| null` |

Checkpoint copies a file before a write tool changes it. Rollback first records the current messages and files, then restores files and truncates messages at the target part. Undo cancels the latest rollback and restores the exact messages and files that existed before that rollback.

### `features/fork.js` - `Fork`

| Method | Input | Output |
|---|---|---|
| `create(sessionID, position)` | source id, `{ messageID, partIndex }` | forked `Session` |

### `features/plugin.js` - `Plugin`

| Method | Input | Output |
|---|---|---|
| `load(name?)` | optional plugin name | loaded plugin names |
| `unload(name)` | plugin name | `boolean` |
| `list()` | none | plugin names |
| `tools()` | none | `{ [name]: Tool }` |
| `emit(event, data)` | hook name, hook data | transformed hook data |
| `setAPI(api)` | kernel API object | `void` |

Plugin API contains `{ Agent, Session, LLM, Store }`. Built-in and user plugins use the same factory format.

## Utilities

### `utils/llm.js` - `LLM`

| Method | Input | Output |
|---|---|---|
| `stream(request, options)` | provider, model, messages, tools, instructions, signal | `{ message, usage }` |

### `utils/retry.js` - `Retry`

| Method | Input | Output |
|---|---|---|
| `run(operation, signal)` | async operation, optional abort signal | operation result |

Retries network errors, 408, 429, and 5xx forever with configured exponential delay. Permanent errors return immediately.

### `utils/tool.js` - `Tool`

| Method | Input | Output |
|---|---|---|
| `list(workspacePath)` | workspace path | `{ [name]: Tool }` |
| `register(tool)` | plugin `Tool` | `void` |
| `execute(name, input, context)` | name, input, `ToolContext` | `{ output, stop? }` |

Tool scans `tools/`, `~/.agent/tools/`, and `<workspace>/.agent/tools/`. A matching file export is immediately usable.

### `utils/path.js` - `Path`

| Method | Input | Output |
|---|---|---|
| `root()` | none | agent data root |
| `config()` | none | config file path |
| `workspaces()` | none | workspace file path |
| `session(id)` | session id | session directory |
| `meta(id)` | session id | metadata path |
| `messages(id)` | session id | JSONL path |
| `undo(id)` | session id | undo directory |
| `plugins()` | none | user plugin directory |
| `tools()` | none | global tool directory |
| `workspaceTools(path)` | workspace path | workspace tool directory |

## Tools

Every `tools/*.js` file exports one `Tool` object or an array of `Tool` objects.

| File | Exported tools | Input | Output |
|---|---|---|---|
| `file.js` | `file_read`, `file_write`, `file_list` | path, content when writing | text, file data, or list |
| `edit.js` | `edit` | path, old text, new text | changed file text |
| `shell.js` | `shell` | command, cwd | stdout and stderr |
| `grep.js` | `grep` | pattern, path | matches |
| `glob.js` | `glob` | pattern, path | paths |
| `web.js` | `web_fetch` | url | page content |
| `control.js` | `finish`, `ask_user` | result or question | `{ output, stop: true }` |

## Plugins

Every plugin exports:

```js
api => ({ name, hooks, tools, unload })
```

| Plugin | Hooks or tools | Purpose |
|---|---|---|
| `title` | `message.append` | generate title after first user message |
| `mcp` | prefixed MCP tools | connect stdio or HTTP MCP servers |
| `websearch` | `web_search` | register web search tool |
| `cron` | timer -> `Agent.send` | trigger scheduled Agent work |

## Dependency Direction

```text
server
  -> commands
  -> features
  -> utils
  -> store

tools -> utils
plugins -> injected { Agent, Session, LLM, Store }
```

No route contains business logic. No utility contains one-time business logic. New tools and plugins are discovered from their directories without editing other files.
