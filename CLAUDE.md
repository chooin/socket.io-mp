# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this package is

`socket.io-mp` lets the **official** `socket.io-client` run inside WeChat (微信), Alipay (支付宝) and
Douyin/ByteDance (抖音/字节跳动) mini-programs. It is an *adapter*, not a protocol reimplementation: every protocol capability
(namespaces, ACKs, reconnection, binary, multiplexing, timeouts) comes from the upstream
`socket.io-client` / `engine.io-client` / `engine.io-parser`. The only code here replaces engine.io's
lowest layer — the WebSocket `Transport` — so it calls the mini-program's native socket API instead of
the browser `WebSocket`. That single substitution is why a few hundred lines reach 100% socket.io v4
parity.

## Commands

Package manager is **pnpm@11** (pinned via the `packageManager` field, resolved by Corepack) — do not
use npm/yarn. Node 22 (`.nvmrc`; `engines` requires `>=18`).

- `pnpm test` — run all tests once (vitest)
- `pnpm test <name>` — run a single test file by substring, e.g. `pnpm test detect` or `pnpm test alipay`
- `pnpm run test:watch` — watch mode
- `pnpm run test:coverage` — v8 coverage report
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm build` — Vite library build → `dist/` (ESM `.mjs` + CJS `.cjs` + a rolled-up `.d.ts`)
- `pnpm run dev` — `vite build --watch`

`prepublishOnly` runs typecheck + test + build, so all three must pass before publish.

## Architecture

The public entry is `io()` in `src/index.ts`. It wraps the upstream `io()` but (a) forces `transports`
to a single mini-program transport and (b) lets that transport be auto-detected or user-injected
(`opts.transports ?? [detectTransport()]`). Everything downstream of the transport is unmodified
upstream code.

```
io(uri, opts)                         src/index.ts — wraps upstream io(), injects transport, forces websocket
  └─ detectTransport()                src/transports/detect.ts — runtime-probes wx / my / tt globals
       ├─ WechatTransport             src/transports/wechat.ts
       ├─ AlipayTransport             src/transports/alipay.ts
       └─ DouyinTransport             src/transports/douyin.ts — mirrors WechatTransport (tt global)
            └─ buildUri / encodeQuery src/transports/base.ts — replicates upstream ws URI building
  MpOptions / TransportCtor           src/types.ts — Partial<ManagerOptions & SocketOptions> + transports
```

All three transports `extend` engine.io-client's `Transport` and implement `get name()` (always
`'websocket'`), `doOpen`, `doClose`, `write`, calling the base class's `onOpen / onData / onClose /
onError` to feed received data back into the engine. `buildUri` reproduces upstream's websocket
`uri()` (schema from `secure`, IPv6 bracketing, dropping `:443`/`:80`, default path `/socket.io/`).

### The platform asymmetry (the core reason there are separate transports)

| | WeChat (`wx`) | Alipay (`my`) |
| --- | --- | --- |
| Connect API | `wx.connectSocket` returns a per-connection `SocketTask` | `my.connectSocket` + **global** `my.onSocket*` event handlers |
| Concurrency | multi-connection | **single connection only** (global event model — multiple Managers to different servers interfere) |
| Binary | native `ArrayBuffer` end-to-end | `my.arrayBufferToBase64` on send / `my.base64ToArrayBuffer` on receive, gated by the `isBuffer` flag; transparent to the user |

Because Alipay's API is a global singleton, `AlipayTransport` registers handlers as **arrow-function
class fields** (`onAliOpen`, etc.) so the *exact same reference* is passed to both `my.onSocket*` and
`my.offSocket*`. Registering with one closure and unregistering with another would make `off*` a no-op
and leak handlers across connections. Asserted in `tests/alipay-transport.test.ts`.

**Douyin (`tt`) follows the WeChat model exactly** — `tt.connectSocket` returns a per-connection
`SocketTask`, binary is native `ArrayBuffer` end-to-end (no base64), up to 5 concurrent connections.
So `DouyinTransport` mirrors `WechatTransport` line-for-line, swapping only the `wx` global for `tt`.
The `tt` global is shared across the whole ByteDance mini-app platform (抖音/今日头条/西瓜/极速版), so
this one transport covers every ByteDance host. There is no canonical typings package for `tt`, so a
minimal ambient declaration of the used subset lives in `src/transports/tt.d.ts` (no new dependency).

### Two non-obvious correctness details (don't "simplify" these away)

1. **Deferred drain.** In `write()`, after the last packet is sent, `writable = true` +
   `emitReserved('drain')` is wrapped in `setTimeout(…, 0)`. `encodePacket`'s callback fires
   synchronously; without the defer, engine.io-client's flush → write → drain → flush loop re-enters
   synchronously and blows the stack. Tested with fake timers in both transport test files.
2. **TypedArray vs ArrayBuffer on Alipay send.** A user `emit`-ing a `Uint8Array` yields a TypedArray,
   not a raw `ArrayBuffer`. `AlipayTransport.write` uses `ArrayBuffer.isView()` + `slice(byteOffset,
   byteOffset + byteLength)` to extract the exact backing bytes before base64 — passing the whole
   underlying buffer would corrupt views with a non-zero offset. (`WechatTransport` sends the
   `ArrayBuffer` natively and needs none of this.)

### Build strategy

`vite.config.ts` marks `socket.io-client`, `engine.io-client`, and `engine.io-parser` as `external`.
They are runtime `dependencies` (not bundled, not peer) so the consumer gets one copy and this package
stays tiny. `minify: false` keeps the output debuggable in mini-program devtools; `vite-plugin-dts`
(`rollupTypes`) emits a single `dist/index.d.ts`.

## Testing

Tests live in `tests/**/*.test.ts` (vitest, node environment, globals enabled — see
`vitest.config.ts`). There is no real mini-program runtime in CI, so the platform globals are faked:

- **Unit tests** (`wechat-transport`, `alipay-transport`, `douyin-transport`, `detect`, `base`): install
  a fake `wx` / `my` / `tt` on `globalThis` whose `on*` methods stash the callbacks in an `h` map, then drive the lifecycle by
  hand — `h.open()`, `h.message({ data: '4hello' })`, etc. (`'4'` is engine.io's "message" packet
  type.) Protected members are reached via `(t as any)`.
- **E2E** (`tests/e2e.test.ts`): the strongest signal. It fakes `wx` / `tt` `connectSocket` (via a
  shared `wsBackedConnectSocket` factory, one describe per platform), but backs it with a **real** `ws`
  connection to a **real** in-process `socket.io` `Server`, exercising connect / ACK round-trip /
  server-emit / binary / namespace through the full upstream stack. New tests there should
  `disconnect()` in a `finally`.

When adding a transport feature, add both a unit test (handler wiring / encoding) and, where it touches
the wire protocol, an e2e assertion.

## Constraints

- **`target: es2018`** and **`useDefineForClassFields: false`** in both `tsconfig.json` and
  `vite.config.ts` — mini-program runtimes need es2018, and `useDefineForClassFields: false` keeps
  class fields as assignments so subclassing engine.io's `Transport` (whose constructor wires things
  up) behaves correctly. `strict` is on.
- Guard every `wx` / `my` / `tt` access with `typeof wx !== 'undefined'` (see `detect.ts`) — these
  globals do not exist in Node/CI.
- Mini-programs only support `wss://` websocket (no HTTP polling) and have limited request-header
  support: authenticate via socket.io `auth` (CONNECT packet) or query string, not custom headers.
- Commits: Conventional Commits with **Chinese** descriptions.

## Release

Published as an **unscoped, public npm package** (`socket.io-mp`); `publishConfig.registry` points at
`registry.npmjs.org`. There is currently **no CI / release automation** (the GitHub Actions workflows
were removed) — publish manually: bump `version` in `package.json`, `npm login` (or export an npm
`NODE_AUTH_TOKEN`), then `pnpm publish`. `prepublishOnly` gates the publish on typecheck + test + build.

## Extending to other frameworks (Taro / uni-app)

A consumer can bypass auto-detection by passing `io(uri, { transports: [CustomTransport] })`. A custom
transport subclasses engine.io-client's `Transport` and implements the same four members (`get name()`
→ `'websocket'`, `doOpen`, `doClose`, `write`). This is the intended extension point — keep
`detectTransport` limited to first-party `wx` / `my` / `tt` and let everything else come in via injection.
