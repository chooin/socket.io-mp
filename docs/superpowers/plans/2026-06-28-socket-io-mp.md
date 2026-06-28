# @chooin/socket.io-mp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布一个让官方 `socket.io-client` 能在微信/支付宝小程序里运行的 npm 包，通过注入一个继承 `engine.io-client` `Transport` 的小程序 transport 适配器实现。

**Architecture:** 不重写协议。我们写两个 `Transport` 子类（微信走 `wx.connectSocket`；支付宝走 `my` 全局 socket 事件 API），一个运行时平台探测，以及一个 `io()` 包装：它探测平台、把对应 transport 类塞进官方 `io(uri, { transports: [T] })` 并强制 websocket。握手/心跳/namespace/ACK/重连/二进制/多路复用全部由官方层完成。

**Tech Stack:** TypeScript · Vite (library mode) · vite-plugin-dts · Vitest (node) · pnpm@10 · 运行时依赖 `socket.io-client` / `engine.io-client` / `engine.io-parser`；E2E 用 `socket.io`(server) + `ws`。

## Global Constraints

每个任务都隐式包含以下项目级约束（值逐字取自 spec）：

- **协议**：对齐 socket.io v4（EIO4 / SIO5）。`socket.io-client >= 4.8`（自定义 transport 类是 4.8 起的官方能力）。
- **运行时依赖**：`socket.io-client` `^4.8.0`、`engine.io-client` `^6.6.0`、`engine.io-parser` `^5.2.0`，三者均直接 import → 均列入 `dependencies`；构建时**全部 `external`**（不内联）。
- **transport**：每个 transport 的 `name` getter 必须返回 `'websocket'`；`io()` 只允许 websocket，不做 polling/upgrade。
- **构建产物**：ESM(`.mjs`) + CJS(`.cjs`)，**不出 UMD**；`vite-plugin-dts` `rollupTypes: true` 产出单一 `dist/index.d.ts`。
- **编译**：`target: es2018`、`useDefineForClassFields: false`、`strict`、`moduleResolution: bundler`，`types` 含 `miniprogram-api-typings` / `@mini-types/alipay` / `node`。
- **包**：`@chooin/socket.io-mp`、`type: module`、`version: 0.1.0`、`sideEffects: false`；`exports` map 中 `types` 必须在 `import`/`require` 之前，且不写 `default` 字段。
- **包管理**：pnpm@10；测试用 vitest（`environment: 'node'`、`globals: true`）。
- **提交**：约定式提交（类型英文 + **中文描述**）。
- **发布**：GitHub Packages（`@chooin` scope）。

---

## File Structure

```
src/
  index.ts                  # io() 包装 + re-export（Task 5）
  types.ts                  # MpOptions / TransportCtor + 官方类型 re-export（Task 2）
  transports/
    base.ts                 # buildUri() / encodeQuery()（Task 2）
    detect.ts               # detectTransport()（Task 5）
    weixin.ts               # WeixinTransport（Task 3）
    alipay.ts               # AlipayTransport（Task 4）
tests/
  base.test.ts              # Task 2
  weixin-transport.test.ts  # Task 3
  alipay-transport.test.ts  # Task 4
  detect.test.ts            # Task 5
  index.test.ts             # Task 5
  e2e.test.ts               # Task 6
package.json / tsconfig.json / vite.config.ts / vitest.config.ts
.gitignore / .nvmrc / .npmrc / .editorconfig / LICENSE   # Task 1
README.md / AGENTS.md                                     # Task 7
```

---

## Spec Coverage Map

| spec 章节 | 落到任务 |
|---|---|
| §3 项目结构 / §6 package / §7 工具链 | Task 1 |
| §5.5 类型 / §4.2 base helpers | Task 2 |
| §5.3 WeixinTransport | Task 3 |
| §5.4 AlipayTransport | Task 4（v1 走全局事件式，见任务说明） |
| §5.2 detect / §5.1 io() | Task 5 |
| §8.3 真·E2E | Task 6 |
| §9 发布 / README / §10 开放点（小程序干净导入手验） | Task 7 |

---

## Task 1: 工程脚手架与工具链

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`, `.nvmrc`, `.npmrc`, `.editorconfig`, `LICENSE`, `src/index.ts`(占位)

**Interfaces:**
- Consumes: 无
- Produces: 可运行的 `pnpm install` / `pnpm typecheck` / `pnpm build` 环境；占位 `src/index.ts` 导出 `export {}`。

- [ ] **Step 1: 写 `package.json`**

```jsonc
{
  "name": "@chooin/socket.io-mp",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "sideEffects": false,
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "pnpm run typecheck && pnpm run test && pnpm run build"
  },
  "dependencies": {
    "engine.io-client": "^6.6.0",
    "engine.io-parser": "^5.2.0",
    "socket.io-client": "^4.8.0"
  },
  "devDependencies": {},
  "packageManager": "pnpm@10.8.0"
}
```

- [ ] **Step 2: 安装依赖（同时写入 devDependencies）**

Run:
```bash
pnpm add -D typescript vite vite-plugin-dts vitest @vitest/coverage-v8 \
  miniprogram-api-typings @mini-types/alipay @types/node @types/ws socket.io ws
pnpm add socket.io-client engine.io-client engine.io-parser
```
Expected: 安装成功，生成 `pnpm-lock.yaml`、`node_modules`。

- [ ] **Step 3: 校验三个运行时依赖版本一致（无重复树）**

Run: `pnpm why engine.io-client && pnpm why engine.io-parser`
Expected: `engine.io-client` / `engine.io-parser` 各只有一个版本（被 `socket.io-client` 与我们共用）。若出现多版本，用 `pnpm.overrides` 对齐到 `socket.io-client` 实际依赖的版本。

- [ ] **Step 4: 写 `tsconfig.json`**

```jsonc
{
  "compilerOptions": {
    "target": "es2018",
    "useDefineForClassFields": false,
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["ES2018", "DOM", "DOM.Iterable"],
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["miniprogram-api-typings", "@mini-types/alipay", "node", "vitest/globals"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 5: 写 `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [dts({ include: ['src'], rollupTypes: true })],
  build: {
    target: 'es2018',
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      external: ['socket.io-client', 'engine.io-client', 'engine.io-parser'],
    },
    minify: false,
    sourcemap: true,
  },
})
```

- [ ] **Step 6: 写 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['src/**/*.ts'] },
  },
})
```

- [ ] **Step 7: 写 `.gitignore` / `.nvmrc` / `.npmrc` / `.editorconfig` / `LICENSE`**

`.gitignore`:
```
node_modules
dist
coverage
.DS_Store
*.log
```
`.nvmrc`:
```
22
```
`.npmrc`:
```
@chooin:registry=https://npm.pkg.github.com
```
`.editorconfig`:
```
root = true

[*]
charset = utf-8
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
```
`LICENSE`（MIT，持有人 chooin，年份 2026）：写入标准 MIT 全文，首行 `MIT License`，版权行 `Copyright (c) 2026 chooin`。

- [ ] **Step 8: 写占位 `src/index.ts`**

```ts
export {}
```

- [ ] **Step 9: 验证工具链**

Run: `pnpm typecheck`
Expected: 退出码 0，无报错。

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "build: 初始化工程脚手架与工具链"
```

---

## Task 2: transport 基础工具与类型

**Files:**
- Create: `src/transports/base.ts`, `src/types.ts`
- Test: `tests/base.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `encodeQuery(query: Record<string, string>): string`
  - `buildUri(opts: { secure?: boolean; hostname?: string; port?: string | number; path?: string }, query?: Record<string, string>): string`
  - `type TransportCtor = new (opts: any) => import('engine.io-client').Transport`
  - `interface MpOptions extends Partial<ManagerOptions & SocketOptions> { transports?: TransportCtor[] }`

- [ ] **Step 1: 写失败测试 `tests/base.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildUri, encodeQuery } from '../src/transports/base'

describe('encodeQuery', () => {
  it('serializes and url-encodes key/values', () => {
    expect(encodeQuery({ EIO: '4', transport: 'websocket' })).toBe('EIO=4&transport=websocket')
  })
  it('encodes special characters', () => {
    expect(encodeQuery({ a: 'b c', d: 'e&f' })).toBe('a=b%20c&d=e%26f')
  })
  it('returns empty string for empty object', () => {
    expect(encodeQuery({})).toBe('')
  })
})

describe('buildUri', () => {
  const query = { EIO: '4', transport: 'websocket' }
  it('builds a ws url with explicit port', () => {
    expect(
      buildUri({ secure: false, hostname: 'localhost', port: '3000', path: '/socket.io/' }, query),
    ).toBe('ws://localhost:3000/socket.io/?EIO=4&transport=websocket')
  })
  it('uses wss and omits default port 443', () => {
    expect(
      buildUri({ secure: true, hostname: 'example.com', port: '443', path: '/socket.io/' }, query),
    ).toBe('wss://example.com/socket.io/?EIO=4&transport=websocket')
  })
  it('omits default port 80 for ws', () => {
    expect(
      buildUri({ secure: false, hostname: 'example.com', port: '80', path: '/socket.io/' }, query),
    ).toBe('ws://example.com/socket.io/?EIO=4&transport=websocket')
  })
  it('wraps IPv6 hostname in brackets', () => {
    expect(
      buildUri({ secure: false, hostname: '::1', port: '3000', path: '/socket.io/' }, query),
    ).toBe('ws://[::1]:3000/socket.io/?EIO=4&transport=websocket')
  })
  it('omits the query string when query is empty', () => {
    expect(buildUri({ secure: false, hostname: 'h', port: '', path: '/socket.io/' }, {})).toBe(
      'ws://h/socket.io/',
    )
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test base`
Expected: FAIL，报 `Failed to resolve import '../src/transports/base'` 或函数未定义。

- [ ] **Step 3: 写实现 `src/transports/base.ts`**

```ts
/** 把 query 对象序列化成 `k=v&k=v`（值做 URL 编码）。 */
export function encodeQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(query[key]))
    .join('&')
}

/** 复刻官方 websocket transport 的 uri() 构造逻辑：ws(s)://host[:port]/path?query */
export function buildUri(
  opts: { secure?: boolean; hostname?: string; port?: string | number; path?: string },
  query: Record<string, string> = {},
): string {
  const schema = opts.secure ? 'wss' : 'ws'
  let host = opts.hostname || 'localhost'
  if (host.indexOf(':') !== -1) host = '[' + host + ']' // IPv6

  const portStr = opts.port == null ? '' : String(opts.port)
  const needsPort =
    portStr !== '' &&
    !((schema === 'wss' && portStr === '443') || (schema === 'ws' && portStr === '80'))
  const port = needsPort ? ':' + portStr : ''

  const qs = encodeQuery(query)
  const path = opts.path || '/socket.io/'
  return schema + '://' + host + port + path + (qs ? '?' + qs : '')
}
```

- [ ] **Step 4: 写类型 `src/types.ts`**

```ts
import type { Transport } from 'engine.io-client'
import type { ManagerOptions, SocketOptions } from 'socket.io-client'

/** 一个可被官方 io() 接受的 transport 构造器。 */
export type TransportCtor = new (opts: ConstructorParameters<typeof Transport>[0]) => Transport

export interface MpOptions extends Partial<ManagerOptions & SocketOptions> {
  /** 覆盖自动探测；不传则按 wx/my 运行时选择。 */
  transports?: TransportCtor[]
}
```

- [ ] **Step 5: 运行测试确认通过 + 类型检查**

Run: `pnpm test base && pnpm typecheck`
Expected: base 测试全 PASS；typecheck 退出码 0。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: 新增 transport 基础工具与类型"
```

---

## Task 3: WeixinTransport（微信）

**Files:**
- Create: `src/transports/weixin.ts`
- Test: `tests/weixin-transport.test.ts`

**Interfaces:**
- Consumes: `buildUri` from `./base`；`Transport` from `engine.io-client`；`encodePacket` from `engine.io-parser`
- Produces: `class WeixinTransport extends Transport`（`get name(): 'websocket'`）

- [ ] **Step 1: 先确认基类真实签名（防止凭记忆出错）**

Read: `node_modules/engine.io-client/build/esm/transport.js`（或 `.d.ts`）
确认：构造器 `constructor(opts)`；需实现 `get name()`, `doOpen()`, `doClose()`, `write(packets)`；可调用 `this.onOpen()`, `this.onData(data)`, `this.onClose()`, `this.onError(reason, description?, context?)`；以及 `this.onData` 内部是否用 `this.socket.binaryType`。若签名与下方代码不符，按真实签名微调（如 `onError` 参数个数、`this.query` 字段名）。

- [ ] **Step 2: 写失败测试 `tests/weixin-transport.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { WeixinTransport } from '../src/transports/weixin'

function installFakeWx() {
  const h: Record<string, (arg?: any) => void> = {}
  const task = {
    onOpen: (cb: any) => { h.open = cb },
    onMessage: (cb: any) => { h.message = cb },
    onClose: (cb: any) => { h.close = cb },
    onError: (cb: any) => { h.error = cb },
    send: vi.fn(),
    close: vi.fn(),
  }
  const connectSocket = vi.fn(() => task)
  ;(globalThis as any).wx = { connectSocket }
  return { task, h, connectSocket }
}

function makeOpts(over: Record<string, any> = {}) {
  return {
    hostname: 'localhost',
    port: '3000',
    secure: false,
    path: '/socket.io/',
    query: { EIO: '4', transport: 'websocket' },
    socket: { binaryType: 'arraybuffer' },
    ...over,
  } as any
}

afterEach(() => {
  delete (globalThis as any).wx
  vi.restoreAllMocks()
})

describe('WeixinTransport', () => {
  it('name is "websocket"', () => {
    installFakeWx()
    expect(new WeixinTransport(makeOpts()).name).toBe('websocket')
  })

  it('doOpen connects with EIO=4 & transport=websocket in the url', () => {
    const { connectSocket } = installFakeWx()
    new WeixinTransport(makeOpts()).open()
    expect(connectSocket).toHaveBeenCalledTimes(1)
    const url = connectSocket.mock.calls[0][0].url as string
    expect(url).toContain('EIO=4')
    expect(url).toContain('transport=websocket')
  })

  it('emits "open" when the socket opens', () => {
    const { h } = installFakeWx()
    const t = new WeixinTransport(makeOpts())
    const opened = vi.fn()
    ;(t as any).on('open', opened)
    t.open()
    h.open()
    expect(opened).toHaveBeenCalled()
  })

  it('decodes an incoming text frame into a packet', () => {
    const { h } = installFakeWx()
    const t = new WeixinTransport(makeOpts())
    const onPacket = vi.fn()
    ;(t as any).on('packet', onPacket)
    t.open()
    h.open()
    h.message({ data: '4hello' }) // engine.io: "4" = message, payload "hello"
    expect(onPacket).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message', data: 'hello' }),
    )
  })

  it('write encodes a text packet, sends via task, then drains', () => {
    const { task } = installFakeWx()
    const t = new WeixinTransport(makeOpts())
    const drain = vi.fn()
    ;(t as any).on('drain', drain)
    t.open()
    ;(t as any).write([{ type: 'message', data: 'hi' }])
    expect(task.send).toHaveBeenCalledWith({ data: '4hi' })
    expect(drain).toHaveBeenCalled()
    expect((t as any).writable).toBe(true)
  })

  it('write sends an ArrayBuffer for a binary packet', () => {
    const { task } = installFakeWx()
    const t = new WeixinTransport(makeOpts())
    t.open()
    const buf = new Uint8Array([1, 2, 3]).buffer
    ;(t as any).write([{ type: 'message', data: buf }])
    const sent = task.send.mock.calls[0][0].data
    expect(sent).toBeInstanceOf(ArrayBuffer)
  })

  it('emits "close" when the socket closes', () => {
    const { h } = installFakeWx()
    const t = new WeixinTransport(makeOpts())
    const closed = vi.fn()
    ;(t as any).on('close', closed)
    t.open()
    h.open()
    h.close()
    expect(closed).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test weixin`
Expected: FAIL（无法解析 `../src/transports/weixin`）。

- [ ] **Step 4: 写实现 `src/transports/weixin.ts`**

```ts
import { Transport } from 'engine.io-client'
import { encodePacket } from 'engine.io-parser'
import type { Packet, RawData } from 'engine.io-parser'
import { buildUri } from './base'

export class WeixinTransport extends Transport {
  private task?: WechatMiniprogram.SocketTask

  get name(): 'websocket' {
    return 'websocket'
  }

  protected doOpen(): void {
    const query = (this.query ?? (this.opts as any).query ?? {}) as Record<string, string>
    const url = buildUri(this.opts as any, query)
    this.task = wx.connectSocket({
      url,
      header: (this.opts as any).extraHeaders,
    })
    this.task.onOpen(() => this.onOpen())
    this.task.onMessage((res) => this.onData(res.data as RawData))
    this.task.onClose(() => this.onClose())
    this.task.onError((err) =>
      this.onError('websocket error', err instanceof Error ? err : new Error(String(err))),
    )
  }

  protected doClose(): void {
    this.task?.close({})
    this.task = undefined
  }

  protected write(packets: Packet[]): void {
    this.writable = false
    let remaining = packets.length
    for (const packet of packets) {
      encodePacket(packet, true, (data) => {
        this.task?.send({ data: data as string | ArrayBuffer })
        if (--remaining === 0) {
          this.writable = true
          this.emit('drain')
        }
      })
    }
  }
}
```

- [ ] **Step 5: 运行测试确认通过 + 类型检查**

Run: `pnpm test weixin && pnpm typecheck`
Expected: 全 PASS；typecheck 退出码 0。（若 `protected` 方法可见性或 `onError` 参数报错，按 Step 1 读到的真实签名调整。）

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(weixin): 实现微信小程序 transport"
```

---

## Task 4: AlipayTransport（支付宝）

> **说明（对 spec §5.4 的务实收敛）**：v1 采用支付宝**全局事件式** WebSocket API（`my.connectSocket` + `my.onSocketOpen/Message/Close/Error` + `my.sendSocketMessage` + `my.closeSocket`）。它有文档、可对照 `@mini-types/alipay` 类型，且单连接对 socket.io 单引擎多路复用足够。task 式（`multiple:true`）留待后续。**限制**：支付宝同一时刻仅一条 socket 连接（多个 Manager 连不同服务端会冲突），需在 README/注释中说明。

**Files:**
- Create: `src/transports/alipay.ts`
- Test: `tests/alipay-transport.test.ts`

**Interfaces:**
- Consumes: `buildUri` from `./base`；`Transport` from `engine.io-client`；`encodePacket` from `engine.io-parser`
- Produces: `class AlipayTransport extends Transport`（`get name(): 'websocket'`）

- [ ] **Step 1: 确认 `@mini-types/alipay` 的 socket API 类型**

Read: `node_modules/@mini-types/alipay/`（搜索 `connectSocket` / `onSocketOpen` / `sendSocketMessage`）
确认方法名与回调入参形状（尤其 `onSocketMessage` 回调是否为 `{ data, isBuffer }`、`sendSocketMessage` 是否接受 `isBuffer`）。若与下方不符，按真实类型微调。

- [ ] **Step 2: 写失败测试 `tests/alipay-transport.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AlipayTransport } from '../src/transports/alipay'

function installFakeMy() {
  const h: Record<string, (arg?: any) => void> = {}
  const my = {
    connectSocket: vi.fn(),
    onSocketOpen: (cb: any) => { h.open = cb },
    onSocketMessage: (cb: any) => { h.message = cb },
    onSocketClose: (cb: any) => { h.close = cb },
    onSocketError: (cb: any) => { h.error = cb },
    offSocketOpen: vi.fn(),
    offSocketMessage: vi.fn(),
    offSocketClose: vi.fn(),
    offSocketError: vi.fn(),
    sendSocketMessage: vi.fn(),
    closeSocket: vi.fn(),
  }
  ;(globalThis as any).my = my
  return { my, h }
}

function makeOpts(over: Record<string, any> = {}) {
  return {
    hostname: 'localhost',
    port: '3000',
    secure: false,
    path: '/socket.io/',
    query: { EIO: '4', transport: 'websocket' },
    socket: { binaryType: 'arraybuffer' },
    ...over,
  } as any
}

afterEach(() => {
  delete (globalThis as any).my
  vi.restoreAllMocks()
})

describe('AlipayTransport', () => {
  it('name is "websocket"', () => {
    installFakeMy()
    expect(new AlipayTransport(makeOpts()).name).toBe('websocket')
  })

  it('doOpen registers global handlers and connects with the right url', () => {
    const { my } = installFakeMy()
    new AlipayTransport(makeOpts()).open()
    expect(my.connectSocket).toHaveBeenCalledTimes(1)
    const url = my.connectSocket.mock.calls[0][0].url as string
    expect(url).toContain('EIO=4')
    expect(url).toContain('transport=websocket')
  })

  it('emits "open" on global socket open', () => {
    const { h } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    const opened = vi.fn()
    ;(t as any).on('open', opened)
    t.open()
    h.open()
    expect(opened).toHaveBeenCalled()
  })

  it('decodes an incoming text frame into a packet', () => {
    const { h } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    const onPacket = vi.fn()
    ;(t as any).on('packet', onPacket)
    t.open()
    h.open()
    h.message({ data: '4hello', isBuffer: false })
    expect(onPacket).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message', data: 'hello' }),
    )
  })

  it('write sends a text packet with isBuffer=false then drains', () => {
    const { my } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    const drain = vi.fn()
    ;(t as any).on('drain', drain)
    t.open()
    ;(t as any).write([{ type: 'message', data: 'hi' }])
    expect(my.sendSocketMessage).toHaveBeenCalledWith({ data: '4hi', isBuffer: false })
    expect(drain).toHaveBeenCalled()
  })

  it('write sends a binary packet with isBuffer=true', () => {
    const { my } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    t.open()
    const buf = new Uint8Array([1, 2, 3]).buffer
    ;(t as any).write([{ type: 'message', data: buf }])
    const arg = my.sendSocketMessage.mock.calls[0][0]
    expect(arg.isBuffer).toBe(true)
    expect(arg.data).toBeInstanceOf(ArrayBuffer)
  })

  it('doClose closes the socket and unregisters handlers', () => {
    const { my } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    t.open()
    ;(t as any).doClose()
    expect(my.closeSocket).toHaveBeenCalled()
    expect(my.offSocketMessage).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test alipay`
Expected: FAIL（无法解析 `../src/transports/alipay`）。

- [ ] **Step 4: 写实现 `src/transports/alipay.ts`**

```ts
import { Transport } from 'engine.io-client'
import { encodePacket } from 'engine.io-parser'
import type { Packet, RawData } from 'engine.io-parser'
import { buildUri } from './base'

/**
 * 支付宝小程序 transport（全局事件式 API，单连接）。
 * 限制：支付宝同一时刻仅允许一条 socket，多个 Manager 连不同服务端会互相干扰。
 */
export class AlipayTransport extends Transport {
  get name(): 'websocket' {
    return 'websocket'
  }

  private readonly onAliOpen = () => this.onOpen()
  private readonly onAliMessage = (res: { data: string | ArrayBuffer }) =>
    this.onData(res.data as RawData)
  private readonly onAliClose = () => this.onClose()
  private readonly onAliError = (err: any) =>
    this.onError('websocket error', err instanceof Error ? err : new Error(String(err)))

  protected doOpen(): void {
    my.onSocketOpen(this.onAliOpen)
    my.onSocketMessage(this.onAliMessage as any)
    my.onSocketClose(this.onAliClose)
    my.onSocketError(this.onAliError)

    const query = (this.query ?? (this.opts as any).query ?? {}) as Record<string, string>
    my.connectSocket({ url: buildUri(this.opts as any, query) })
  }

  protected doClose(): void {
    my.closeSocket({})
    my.offSocketOpen?.(this.onAliOpen)
    my.offSocketMessage?.(this.onAliMessage as any)
    my.offSocketClose?.(this.onAliClose)
    my.offSocketError?.(this.onAliError)
  }

  protected write(packets: Packet[]): void {
    this.writable = false
    let remaining = packets.length
    for (const packet of packets) {
      encodePacket(packet, true, (data) => {
        const isBuffer = typeof data !== 'string'
        my.sendSocketMessage({ data: data as string | ArrayBuffer, isBuffer })
        if (--remaining === 0) {
          this.writable = true
          this.emit('drain')
        }
      })
    }
  }
}
```

- [ ] **Step 5: 运行测试确认通过 + 类型检查**

Run: `pnpm test alipay && pnpm typecheck`
Expected: 全 PASS；typecheck 退出码 0。（若 `@mini-types/alipay` 的方法签名不同，按 Step 1 调整，例如 `my.connectSocket` 入参或 `off*` 方法名。）

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(alipay): 实现支付宝小程序 transport"
```

---

## Task 5: 平台探测与 io() 包装

**Files:**
- Create: `src/transports/detect.ts`
- Modify: `src/index.ts`（替换占位）
- Test: `tests/detect.test.ts`, `tests/index.test.ts`

**Interfaces:**
- Consumes: `WeixinTransport`, `AlipayTransport`, `TransportCtor`, `MpOptions`
- Produces:
  - `detectTransport(): TransportCtor`
  - `io(uri: string, opts?: MpOptions): Socket`（具名 + default 导出）
  - re-export：`Manager`, `Socket`, `WeixinTransport`, `AlipayTransport`, `MpOptions`, `ManagerOptions`, `SocketOptions`

- [ ] **Step 1: 写失败测试 `tests/detect.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { detectTransport } from '../src/transports/detect'
import { WeixinTransport } from '../src/transports/weixin'
import { AlipayTransport } from '../src/transports/alipay'

afterEach(() => {
  delete (globalThis as any).wx
  delete (globalThis as any).my
})

describe('detectTransport', () => {
  it('returns WeixinTransport when wx.connectSocket exists', () => {
    ;(globalThis as any).wx = { connectSocket: () => ({}) }
    expect(detectTransport()).toBe(WeixinTransport)
  })
  it('returns AlipayTransport when only my.connectSocket exists', () => {
    ;(globalThis as any).my = { connectSocket: () => ({}) }
    expect(detectTransport()).toBe(AlipayTransport)
  })
  it('prefers Weixin when both exist', () => {
    ;(globalThis as any).wx = { connectSocket: () => ({}) }
    ;(globalThis as any).my = { connectSocket: () => ({}) }
    expect(detectTransport()).toBe(WeixinTransport)
  })
  it('throws a helpful error when neither exists', () => {
    expect(() => detectTransport()).toThrow(/wx\/my/)
  })
})
```

- [ ] **Step 2: 写失败测试 `tests/index.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { io } from '../src/index'
import { WeixinTransport } from '../src/transports/weixin'

afterEach(() => {
  delete (globalThis as any).wx
})

describe('io()', () => {
  it('throws when no platform transport is available and none injected', () => {
    expect(() => io('ws://localhost:3000', { autoConnect: false })).toThrow(/wx\/my/)
  })

  it('uses the detected transport (weixin) and forces websocket', () => {
    ;(globalThis as any).wx = { connectSocket: () => ({}) }
    const socket = io('ws://localhost:3000', { autoConnect: false })
    expect(socket.io.opts.transports).toEqual([WeixinTransport])
  })

  it('respects an injected transports override', () => {
    class FakeTransport {}
    const socket = io('ws://localhost:3000', {
      autoConnect: false,
      transports: [FakeTransport as any],
    })
    expect(socket.io.opts.transports).toEqual([FakeTransport])
  })
})
```

> 注：用 `autoConnect: false` 避免真实连接。若 `socket.io.opts.transports` 取不到（官方把它存在别处），改为断言 `socket.io.engine` 创建时使用的 transport，或读 `(socket.io as any).opts.transports`——以安装版本实际结构为准。

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test detect index`
Expected: FAIL（无法解析 `../src/transports/detect`；`io` 未定义）。

- [ ] **Step 4: 写实现 `src/transports/detect.ts`**

```ts
import type { TransportCtor } from '../types'
import { WeixinTransport } from './weixin'
import { AlipayTransport } from './alipay'

/** 运行时探测当前小程序平台，返回对应 transport 类。 */
export function detectTransport(): TransportCtor {
  if (typeof wx !== 'undefined' && typeof wx.connectSocket === 'function') {
    return WeixinTransport as unknown as TransportCtor
  }
  if (typeof my !== 'undefined' && typeof my.connectSocket === 'function') {
    return AlipayTransport as unknown as TransportCtor
  }
  throw new Error(
    '[socket.io-mp] 未检测到 wx/my 的 WebSocket API；请用 io(uri, { transports: [自定义Transport] }) 显式注入',
  )
}
```

- [ ] **Step 5: 写实现 `src/index.ts`（替换占位）**

```ts
import { io as baseIo, Manager, Socket } from 'socket.io-client'
import { detectTransport } from './transports/detect'
import type { MpOptions } from './types'

/**
 * 在微信/支付宝小程序里创建 socket.io 连接。
 * 自动探测平台并注入对应 transport，强制只走 websocket。
 * 其余行为与官方 socket.io-client 完全一致。
 */
export function io(uri: string, opts: MpOptions = {}): Socket {
  const transports = opts.transports ?? [detectTransport()]
  return baseIo(uri, { ...opts, transports } as never)
}

export default io
export { Manager, Socket }
export { WeixinTransport } from './transports/weixin'
export { AlipayTransport } from './transports/alipay'
export type { MpOptions, TransportCtor } from './types'
export type { ManagerOptions, SocketOptions } from 'socket.io-client'
```

- [ ] **Step 6: 运行测试确认通过 + 类型检查**

Run: `pnpm test detect index && pnpm typecheck`
Expected: 全 PASS；typecheck 退出码 0。

- [ ] **Step 7: 跑全量单测确保无回归**

Run: `pnpm test`
Expected: 所有测试（base/weixin/alipay/detect/index）PASS。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat: 新增平台探测与 io() 包装"
```

---

## Task 6: 真·E2E（真实 socket.io 服务端）

**Files:**
- Test: `tests/e2e.test.ts`

**Interfaces:**
- Consumes: `io` from `../src/index`；`socket.io`(server)、`ws`、`node:http`
- Produces: 端到端验证（无对外 API）

- [ ] **Step 1: 写 E2E 测试 `tests/e2e.test.ts`**

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server as IOServer } from 'socket.io'
import WS, { type RawData } from 'ws'
import { io } from '../src/index'

let http: HttpServer
let ioServer: IOServer
let port: number

beforeAll(async () => {
  http = createServer()
  ioServer = new IOServer(http)
  ioServer.on('connection', (socket) => {
    socket.on('echo', (data, cb) => {
      if (typeof cb === 'function') cb(data)
    })
    socket.on('shout', (msg) => socket.emit('shouted', String(msg).toUpperCase()))
    socket.on('bin', (buf, cb) => {
      if (typeof cb === 'function') cb(buf)
    })
  })
  ioServer.of('/admin').on('connection', (socket) => socket.emit('welcome', 'admin'))
  await new Promise<void>((resolve) => http.listen(0, resolve))
  port = (http.address() as AddressInfo).port
})

afterAll(async () => {
  ioServer.close()
  await new Promise<void>((resolve) => http.close(() => resolve()))
})

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

// 把 wx.connectSocket mock 成由 ws 驱动的真实连接，让 WeixinTransport 真正连上 server
beforeEach(() => {
  ;(globalThis as any).wx = {
    connectSocket({ url }: { url: string }) {
      const ws = new WS(url)
      ws.binaryType = 'arraybuffer'
      return {
        onOpen: (cb: any) => ws.on('open', () => cb({})),
        onMessage: (cb: any) =>
          ws.on('message', (data: RawData, isBinary: boolean) =>
            cb({ data: isBinary ? toArrayBuffer(data as Buffer) : data.toString() }),
          ),
        onClose: (cb: any) => ws.on('close', () => cb({})),
        onError: (cb: any) => ws.on('error', (e: Error) => cb(e)),
        send: ({ data }: { data: string | ArrayBuffer }) => ws.send(data),
        close: () => ws.close(),
      }
    },
  }
})

afterEach(() => {
  delete (globalThis as any).wx
})

describe('e2e against a real socket.io server', () => {
  it('★ connects and reports connected', async () => {
    const socket = io(`ws://localhost:${port}`, { forceNew: true })
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve())
      socket.on('connect_error', reject)
    })
    expect(socket.connected).toBe(true)
    socket.disconnect()
  })

  it('★ round-trips an ACK', async () => {
    const socket = io(`ws://localhost:${port}`, { forceNew: true })
    const resp = await new Promise((resolve) => {
      socket.on('connect', () => socket.emit('echo', { a: 1 }, resolve))
    })
    expect(resp).toEqual({ a: 1 })
    socket.disconnect()
  })

  it('receives a server-emitted event', async () => {
    const socket = io(`ws://localhost:${port}`, { forceNew: true })
    const shouted = await new Promise((resolve) => {
      socket.on('connect', () => {
        socket.on('shouted', resolve)
        socket.emit('shout', 'hi')
      })
    })
    expect(shouted).toBe('HI')
    socket.disconnect()
  })

  it('round-trips binary (ArrayBuffer)', async () => {
    const socket = io(`ws://localhost:${port}`, { forceNew: true })
    const out = new Uint8Array([1, 2, 3, 4])
    const echoed = await new Promise<ArrayBuffer>((resolve) => {
      socket.on('connect', () => socket.emit('bin', out.buffer, resolve))
    })
    expect(new Uint8Array(echoed)).toEqual(out)
    socket.disconnect()
  })

  it('connects to a namespace', async () => {
    const admin = io(`ws://localhost:${port}/admin`, { forceNew: true })
    const welcome = await new Promise((resolve) => admin.on('welcome', resolve))
    expect(welcome).toBe('admin')
    admin.disconnect()
  })
})
```

- [ ] **Step 2: 运行 E2E**

Run: `pnpm test e2e`
Expected: 全 PASS。
排障：若连接超时——确认 `buildUri` 产出的 path 是 `/socket.io/`（server 默认）；若二进制断言失败——检查 `this.socket.binaryType` 与 `ws.binaryType='arraybuffer'`；若类型报 `RawData`——以安装的 `ws` 版本类型为准。

- [ ] **Step 3: 跑全量测试 + 覆盖率**

Run: `pnpm run test:coverage`
Expected: 全 PASS；`src/transports/*` 行/分支 ≥ 95%，整包 ≥ 90%。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "test: 新增真实 socket.io 服务端的 E2E 测试"
```

---

## Task 7: 文档与发布前自查

**Files:**
- Create: `README.md`, `AGENTS.md`

**Interfaces:**
- Consumes: 全部已完成的功能
- Produces: 文档 + 通过发布前自查

- [ ] **Step 1: 写 `README.md`**

内容（中文）按以下骨架，逐块写实：

````markdown
# @chooin/socket.io-mp

微信 / 支付宝小程序的 socket.io 客户端：直接复用官方 `socket.io-client`，仅替换为小程序原生 WebSocket transport，API 与官方完全一致，严格对齐 socket.io v4。

## 特性

- 🚀 微信 / 支付宝双端，运行时自动探测 `wx` / `my`
- 🧩 基于官方 `socket.io-client`，协议 100% 对齐 v4（namespace / ACK / 重连 / 二进制 / 多路复用）
- 📇 TypeScript 编写，自带类型；产物 ESM + CJS
- 🔌 可注入自定义 transport（Taro / uni-app 等）

## 安装

```ini
# 项目根 .npmrc：@chooin 作用域指向 GitHub Packages
@chooin:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```
```bash
pnpm add @chooin/socket.io-mp socket.io-client
```

## 快速开始

```ts
import { io } from '@chooin/socket.io-mp'

const socket = io('wss://example.com', { auth: { token: 'xxx' } })
socket.on('connect', () => console.log('connected', socket.id))
socket.on('news', (data) => console.log(data))
socket.emit('msg', { a: 1 }, (ack) => console.log(ack)) // ACK
```

## 与官方的差异

- 只走 websocket（小程序无 polling）；其余 API 同官方。
- 小程序对 WebSocket 请求头支持有限，鉴权请用 `auth`（CONNECT 包）或 query，而非自定义 header。
- 需在小程序后台配置 socket 合法域名（wss）。
- 支付宝走全局单连接 API：同一时刻仅一条连接（多个不同服务端的 Manager 会冲突）。

## 平台支持

| 平台 | 连接 API |
| --- | --- |
| 微信小程序 | `wx.connectSocket` |
| 支付宝小程序 | `my.connectSocket`（全局事件式） |

## 高级：注入自定义 transport

```ts
import { io } from '@chooin/socket.io-mp'
import { MyTaroTransport } from './my-taro-transport'

io('wss://example.com', { transports: [MyTaroTransport] })
```
````

- [ ] **Step 2: 写 `AGENTS.md`**

```markdown
# AGENTS.md

本仓库是 `@chooin/socket.io-mp`：让官方 `socket.io-client` 在微信/支付宝小程序运行的适配包。

## 命令
- `pnpm test` 跑测试；`pnpm test <name>` 跑单个文件；`pnpm run test:coverage` 看覆盖率
- `pnpm typecheck` 类型检查；`pnpm build` 构建

包管理器是 **pnpm@10**，不要用 npm/yarn。

## 架构
- 不重写协议。协议能力全部来自官方 `socket.io-client` / `engine.io-client` / `engine.io-parser`（均为运行时依赖、构建时 external）。
- 我们只写 `src/transports/*`（微信/支付宝 `Transport` 子类）+ `src/transports/detect.ts` + `src/index.ts` 的 `io()` 包装。
- 每个 transport 子类必须实现 `get name()`(返回 `'websocket'`)、`doOpen`、`doClose`、`write`，并调用基类 `onOpen/onData/onClose/onError`。

## 约束
- target **es2018** + `useDefineForClassFields:false`；`strict`。
- 调用 `wx`/`my` 前用 `typeof wx !== 'undefined'` 守卫（见 `detect.ts`）。
- 支付宝为全局单连接 API；微信支持多连接。
- 提交用约定式提交 + 中文描述。
```

- [ ] **Step 3: 发布前自查（构建 + 打包内容）**

Run:
```bash
pnpm typecheck && pnpm test && pnpm build && pnpm pack --dry-run
```
Expected:
- `dist/index.mjs`、`dist/index.cjs`、`dist/index.d.ts` 生成；
- `pnpm pack --dry-run` 输出仅含 `dist/`、`README.md`、`LICENSE`、`package.json`。

- [ ] **Step 4: 验证产物未内联官方依赖（external 生效）**

Run: `grep -c "createConnection\|socket.io-parser" dist/index.mjs || true` 并人工查看 `dist/index.mjs` 顶部是否为 `import ... from "socket.io-client"`（而非把整个 socket.io-client 打进来）。
Expected: `dist/index.mjs` 通过 `import` 引用 `socket.io-client`/`engine.io-client`/`engine.io-parser`，不内联其源码。

- [ ] **Step 5: 记录手动验收项（无法自动化）**

在 README 或 issue 记录待办：**在微信开发者工具/真机里验证 `socket.io-client` 可干净导入并连通一次**（对应 spec §10 开放点）。这一步需真实小程序环境，CI/Node 测不到。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "docs: 补充 README/AGENTS 并完成发布前自查"
```

---

## 完成判定（对齐 spec §12）

- [ ] `pnpm install && pnpm build` 干净成功，产出 `dist/index.mjs`、`dist/index.cjs`、`dist/index.d.ts`
- [ ] `pnpm test` 全绿；覆盖率达标；E2E 的 ★ 契约（连接 / ACK）通过
- [ ] `pnpm pack --dry-run` 仅含 `dist/`、`README.md`、`LICENSE`、`package.json`
- [ ] `detect` 在 wx / my / 都无 三种情况行为正确
- [ ] README 含安装、快速开始、与官方差异、平台支持、合法域名提示
- [ ] 手动验收项（小程序干净导入）已登记
</content>
