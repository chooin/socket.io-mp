# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` (terse rules, 中文) and `README.md` (user-facing docs) also exist; this file is the superset.

## What this package is

`socket.io-mp` lets the **official** `socket.io-client` run inside WeChat (微信) and
Alipay (支付宝) mini-programs. It is an *adapter*, not a protocol reimplementation: every protocol
capability (namespaces, ACKs, reconnection, binary, multiplexing, timeouts) comes from the upstream
`socket.io-client` / `engine.io-client` / `engine.io-parser`. The only thing this package writes is a
replacement for engine.io's lowest layer — the WebSocket `Transport` — that calls the mini-program's
native socket API instead of the browser `WebSocket`. This is why the package can claim 100% parity
with socket.io v4 from a few hundred lines of code.

## Commands

Package manager is **pnpm@10** — do not use npm/yarn.

- `pnpm test` — run all tests once (vitest)
- `pnpm test <name>` — run a single test file, e.g. `pnpm test detect`
- `pnpm run test:watch` — watch mode
- `pnpm run test:coverage` — coverage report (v8)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm build` — Vite library build → `dist/` (ESM `.mjs` + CJS `.cjs` + rolled-up `.d.ts`)
- `pnpm run dev` — `vite build --watch`

`prepublishOnly` runs typecheck + test + build, so all three must pass before publish.

## Release

Publishing targets the **public npm registry** (unscoped package `socket.io-mp`) and is
**tag-triggered** by `.github/workflows/release.yml` (`on: push: tags`). `.github/workflows/ci.yml`
runs typecheck/test/build on pushes to `master` and on PRs.

- The release job publishes the `version` field in `package.json`, **not** the tag string — bump
  `version` and tag together or you ship a mismatched version.
- One-time setup: add a repo secret `NPM_TOKEN` — an **npmjs.com Automation access token** with
  publish rights to this package; the job passes it as `NODE_AUTH_TOKEN`. (Same secret *name* as the
  old GitHub Packages setup, but a different credential — an npm token, not a GitHub PAT.)
- What routes the publish: `publishConfig.registry` (→ `registry.npmjs.org`) in `package.json` and
  the workflow's `setup-node` `registry-url` (which generates the auth `.npmrc` in CI). The package
  is unscoped, so npm publishes it publicly by default — no `.npmrc` is committed.
- Cut a release: bump `version` → commit → `git tag vX.Y.Z` → `git push --follow-tags`.

## Architecture

The public entry is `io()` in `src/index.ts`. It wraps the upstream `io()` but (a) forces
`transports` to a single mini-program transport and (b) lets that transport be auto-detected or
user-injected. Everything downstream of the transport is unmodified upstream code.

```
io(uri, opts)                         src/index.ts — wraps upstream io(), injects transport
  └─ detectTransport()                src/transports/detect.ts — runtime-probes wx / my globals
       ├─ WechatTransport             src/transports/wechat.ts
       └─ AlipayTransport             src/transports/alipay.ts
            └─ buildUri / encodeQuery src/transports/base.ts — replicates upstream ws URI building
```

Both transports `extend` engine.io-client's `Transport` and must implement `get name()` (always
returns `'websocket'`), `doOpen`, `doClose`, `write`, calling the base class's
`onOpen / onData / onClose / onError` to feed received data back into the engine.

### The platform asymmetry (the core reason there are two transports)

| | WeChat (`wx`) | Alipay (`my`) |
| --- | --- | --- |
| Connect API | `wx.connectSocket` returns a per-connection `SocketTask` | `my.connectSocket` + **global** `my.onSocket*` event handlers |
| Concurrency | multi-connection | **single connection only** (global event model — multiple Managers to different servers interfere) |
| Binary | native `ArrayBuffer` end-to-end | must `arrayBufferToBase64` on send / `base64ToArrayBuffer` on receive (`isBuffer` flag); transparent to the user |

Because Alipay's API is a global singleton, `AlipayTransport` registers handlers as **arrow-function
class fields** (`onAliOpen`, etc.) so the exact same reference is passed to both `my.onSocket*` and
`my.offSocket*` — registering with one closure and unregistering with another would make `off*` a
no-op and leak handlers across connections. This is asserted in `tests/alipay-transport.test.ts`.

### Two non-obvious correctness details (don't "simplify" these away)

1. **Deferred drain.** In `write()`, after the last packet is sent, the `writable = true` +
   `emitReserved('drain')` is wrapped in `setTimeout(…, 0)`. `encodePacket`'s callback fires
   synchronously; without the defer, engine.io-client's flush → write → drain → flush loop re-enters
   synchronously and blows the stack. Tested with fake timers in both transport test files.
2. **TypedArray vs ArrayBuffer on Alipay send.** A user `emit`-ing a `Uint8Array` yields a TypedArray,
   not a raw `ArrayBuffer`. `AlipayTransport.write` uses `ArrayBuffer.isView()` + `slice(byteOffset,
   byteOffset + byteLength)` to extract the exact backing bytes before base64 — passing the whole
   underlying buffer would corrupt views with a non-zero offset.

### Build strategy

`vite.config.ts` marks `socket.io-client`, `engine.io-client`, and `engine.io-parser` as `external`
(rollupOptions). They are runtime `dependencies` (not bundled, not peer) so the consumer gets one
copy and this package stays tiny. `minify: false` keeps the output debuggable in mini-program
devtools. `vite-plugin-dts` rolls all types into a single `dist/index.d.ts`.

## Testing

Tests live in `tests/**/*.test.ts` (vitest, node environment, globals enabled). There is no real
mini-program runtime in CI, so the platform globals are faked:

- **Unit tests** (`wechat-transport`, `alipay-transport`, `detect`): install a fake `wx` / `my` on
  `globalThis` whose `on*` methods stash the callbacks in an `h` map, then drive the lifecycle by
  hand — `h.open()`, `h.message({ data: '4hello' })`, etc. (`'4'` is engine.io's "message" packet
  type.) Protected members are reached via `(t as any)`.
- **E2E test** (`tests/e2e.test.ts`): the strongest signal. It still fakes `wx.connectSocket`, but
  backs it with a **real** `ws` connection to a **real** in-process `socket.io` `Server`, exercising
  connect / ACK round-trip / server-emit / binary / namespace through the full upstream stack. New
  tests there should always `disconnect()` in a `finally`.

When adding a transport feature, add both a unit test (handler wiring / encoding) and, where it
touches the wire protocol, an e2e assertion.

## Constraints

- **`target: es2018`** and **`useDefineForClassFields: false`** in both `tsconfig.json` and
  `vite.config.ts` — mini-program runtimes need es2018, and `useDefineForClassFields:false` keeps
  class fields as assignments so subclassing engine.io's `Transport` (whose constructor wires things
  up) behaves correctly. `strict` is on.
- Guard every `wx` / `my` access with `typeof wx !== 'undefined'` (see `detect.ts`) — these globals
  do not exist in Node/CI.
- Mini-programs only support `wss://` websocket (no HTTP polling) and have limited request-header
  support: authenticate via socket.io `auth` (CONNECT packet) or query string, not custom headers.
- Published unscoped to the **public npm registry** (`socket.io-mp`).
- Commits: Conventional Commits with **Chinese** descriptions.

## Extending to other frameworks (Taro / uni-app)

A consumer can bypass auto-detection by passing `io(uri, { transports: [CustomTransport] })`. A custom
transport subclasses engine.io-client's `Transport` and implements the same four members
(`get name()` → `'websocket'`, `doOpen`, `doClose`, `write`). This is the intended extension point —
keep `detectTransport` limited to first-party `wx` / `my` and let everything else come in via injection.
