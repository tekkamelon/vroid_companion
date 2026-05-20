# VRoid AI Companion — Agent Guidance

A compact reference for coding sessions in this repository.

---

## Project Overview

Electron app that displays a VRoid Studio VRM model in a window, relays text input to an ACP-compatible agent (zeroclaw, opencode, goose, etc.) via JSON-RPC 2.0 over stdio, and controls facial expressions based on parsed emotion tags.

**Boundaries:**
- This app handles: VRM display/rendering, text I/O, ACP client over stdio, emotion tag parsing → BlendShape.
- The agent handles: memory, MCP, Discord, LLM communication directly.

---

## Tech Stack

| Component | Version / Spec |
|---|---|
| Node.js | v22 LTS (managed by fnm; no `.node-version` checked in) |
| Electron | ^42.0.0 |
| three.js | ^0.180.0 |
| @pixiv/three-vrm | ^3.5.2 |
| VRM format | VRM 1.0 (VRoid Studio 2.x default) |
| Agent protocol | ACP v1 (JSON-RPC 2.0 over stdio, NDJSON lines) |
| Config | `config/companion.toml` (TOML) |

---

## Developer Commands

```bash
npm start          # Launch app (production-like)
npm run dev        # Launch with --dev flag
npm run build      # Package with electron-builder (AppImage + deb on Linux)
```

**No test suite, no linter, no typechecker, no CI workflow.**

---

## Architecture & Entrypoints

```
src/main.js          Electron main process + ACP client lifecycle
src/preload.js       contextBridge exposing window.companion.*
src/renderer/app.js  Three.js scene, VRM load, chat UI, emotion control
src/renderer/index.html  Renderer page with CSP
config/companion.toml    Runtime config (agent command, VRM path, display size)
```

### IPC exposed via preload

```js
window.companion.sendMessage(text)   // -> invoke('acp:send')
window.companion.onResponse(cb)      // -> on('acp:response')
```

**Hard rule:** `contextIsolation: true`, `nodeIntegration: false`. Renderer must never call Node APIs directly or use `require()`.

---

## Key Conventions & Quirks

### Node modules referenced directly from renderer

Renderer JS uses relative imports into `node_modules`, **not** a bundler:

```js
import * as THREE from '../../node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '../../node_modules/@pixiv/three-vrm/lib/three-vrm.module.js';
```

This works because Electron loads via `file://` and node_modules is on-disk.

### VRM SpringBone requirement

Call `currentVrm.update(delta)` **every frame** inside the `requestAnimationFrame` loop. If omitted, SpringBone physics and expression updates stall silently.

### ACP line-buffering quirk

Agent stdout may contain `\r`. The ACP client implementation strips it before splitting on `\n`:

```js
this._buf += chunk.toString().replace(/\r/g, '');
```

### session/request_permission

Agents may request permission mid-session (e.g., for shell commands). The client **must respond** with an allow/deny JSON-RPC result. Implementations in flight may auto-allow as a placeholder.

### Emotion tag contract

The agent is expected (via system prompt) to append a single-line JSON tag at the end of its response:

```json
{"emotion":"happy","intensity":0.8}
```

Valid emotion keys (VRM 1.0 BlendShape): `neutral`, `happy`, `sad`, `angry`, `surprised`, `relaxed`.

### Linux / Wayland rendering

If rendering is garbled on Wayland, run with `--ozone-platform=x11`.

---

## Setup Prerequisites

1. Node.js v22 via fnm (setup script: `scripts/setup-dev-env.sh` bootstraps fnm + Node + system deps).
2. Place a VRM 1.0 model into `src/assets/models/model.vrm`.
3. Configure the agent command in `config/companion.toml`.
4. `npm install`, then `npm start`.

---

## Related Instruction Files

- `.agents/skills/vroid_companion/SKILL.md` — Detailed ACP client implementation reference, VRM code patterns, and security checklist.
- `docs/agent-handoff.md` — Full-phase implementation guide (Phases 1–5) and troubleshooting table.
- `docs/owner-overview.md` — High-level product overview and supported agent matrix.
