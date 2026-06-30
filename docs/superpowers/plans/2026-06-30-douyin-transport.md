# 抖音(字节跳动)小程序 transport 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `socket.io-mp` 新增一个抖音小程序(`tt` 全局)的 mini-program WebSocket transport,使官方 `socket.io-client` 能在所有字节系小程序里运行。

**Architecture:** 抖音走"微信模型"——`tt.connectSocket` 同步返回 `SocketTask`、二进制原生收发 `ArrayBuffer`。因此新增独立文件 `src/transports/douyin.ts`,逐项镜像 `WechatTransport`,只把全局对象 `wx` 换成 `tt`;`tt` 的类型用最小本地 ambient 声明(不引第三方依赖);`detectTransport` 追加 `tt` 探测分支。现有微信/支付宝代码零改动。

**Tech Stack:** TypeScript(es2018)、engine.io-client `Transport`、engine.io-parser `encodePacket`、Vitest、Vite library build。

## Global Constraints

逐条来自 spec / CLAUDE.md,**每个任务都隐含遵守**:

- 包管理器只用 **pnpm@11**(已 pin),不用 npm/yarn;Node 22(`engines >=18`)。
- **`target: es2018`** 且 **`useDefineForClassFields: false`**(tsconfig 与 vite.config 均是),不得破坏;`strict` 全开。
- 每一处 `wx` / `my` / `tt` 访问都必须用 `typeof xxx !== 'undefined'` 运行时守卫(这些全局在 Node/CI 不存在)。
- 小程序仅支持 `wss://`;鉴权走 socket.io `auth`(CONNECT 包)或 query,不用自定义 header。
- 提交遵循 **Conventional Commits + 中文描述**。
- `vitest` 只转译不类型检查 → 运行时不需要 `tt.d.ts`;`tt.d.ts` 仅供 `pnpm typecheck` / `pnpm build` 使用。
- 构建产物 `dist/` 不纳入提交。

## 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `src/transports/tt.d.ts` | `tt` 全局的最小 ambient 类型(`connectSocket` + `SocketTask` 子集) | 新建 |
| `src/transports/douyin.ts` | `DouyinTransport`,镜像 `WechatTransport`,用 `tt` | 新建 |
| `src/transports/detect.ts` | 运行时探测追加 `tt` 分支 + 报错文案 | 改 |
| `src/index.ts` | 导出 `DouyinTransport` | 改 |
| `tests/douyin-transport.test.ts` | `DouyinTransport` 单测(镜像微信单测) | 新建 |
| `tests/detect.test.ts` | 探测 `tt` 用例 | 改 |
| `tests/index.test.ts` | `io()` 经探测路由到 `DouyinTransport`、验证入口 re-export | 改 |
| `tests/e2e.test.ts` | 抽出 ws 驱动假 socket 工厂,补 `tt` 端到端(连接 + 二进制) | 改 |
| `CLAUDE.md` / `README.md` / `package.json` | 平台表、探测说明、keywords | 改 |

---

### Task 1: `DouyinTransport` + `tt` ambient 类型

**Files:**
- Create: `src/transports/douyin.ts`
- Create: `src/transports/tt.d.ts`
- Test: `tests/douyin-transport.test.ts`

**Interfaces:**
- Consumes: `Transport`(engine.io-client)、`encodePacket` / `Packet` / `RawData`(engine.io-parser)、`buildUri`(`./base`)。
- Produces: `export class DouyinTransport extends Transport`,公开 `get name(): 'websocket'`,实现受保护的 `doOpen()` / `doClose()` / `write(packets: Packet[])`。全局 ambient:`declare const tt`,命名空间 `DouyinMiniprogram.SocketTask`。

- [ ] **Step 1: 写失败测试 `tests/douyin-transport.test.ts`**

完整文件(镜像 `tests/wechat-transport.test.ts`,`wx`→`tt`、`WechatTransport`→`DouyinTransport`):

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DouyinTransport } from '../src/transports/douyin'

function installFakeTt() {
  const h: Record<string, (arg?: any) => void> = {}
  const task = {
    onOpen: (cb: any) => { h.open = cb },
    onMessage: (cb: any) => { h.message = cb },
    onClose: (cb: any) => { h.close = cb },
    onError: (cb: any) => { h.error = cb },
    send: vi.fn(),
    close: vi.fn(),
  }
  const connectSocket = vi.fn((_opts: any) => task)
  ;(globalThis as any).tt = { connectSocket }
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
  delete (globalThis as any).tt
  vi.restoreAllMocks()
})

describe('DouyinTransport', () => {
  it('name is "websocket"', () => {
    installFakeTt()
    expect(new DouyinTransport(makeOpts()).name).toBe('websocket')
  })

  it('doOpen connects with EIO=4 & transport=websocket in the url', () => {
    const { connectSocket } = installFakeTt()
    new DouyinTransport(makeOpts()).open()
    expect(connectSocket).toHaveBeenCalledTimes(1)
    const url = connectSocket.mock.calls[0][0].url as string
    expect(url).toContain('EIO=4')
    expect(url).toContain('transport=websocket')
  })

  it('emits "open" when the socket opens', () => {
    const { h } = installFakeTt()
    const t = new DouyinTransport(makeOpts())
    const opened = vi.fn()
    ;(t as any).on('open', opened)
    t.open()
    h.open()
    expect(opened).toHaveBeenCalled()
  })

  it('decodes an incoming text frame into a packet', () => {
    const { h } = installFakeTt()
    const t = new DouyinTransport(makeOpts())
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
    vi.useFakeTimers()
    const { task } = installFakeTt()
    const t = new DouyinTransport(makeOpts())
    const drain = vi.fn()
    ;(t as any).on('drain', drain)
    t.open()
    ;(t as any).write([{ type: 'message', data: 'hi' }])
    expect(task.send).toHaveBeenCalledWith({ data: '4hi' })
    // drain is deferred via setTimeout to prevent synchronous re-entry
    expect(drain).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(drain).toHaveBeenCalled()
    expect((t as any).writable).toBe(true)
    vi.useRealTimers()
  })

  it('write([]) does not leave the transport stuck non-writable', () => {
    const { h } = installFakeTt()
    const t = new DouyinTransport(makeOpts())
    t.open()
    h.open() // onOpen sets writable = true
    expect((t as any).writable).toBe(true)
    ;(t as any).write([])
    expect((t as any).writable).toBe(true)
  })

  it('write sends an ArrayBuffer for a binary packet', () => {
    const { task } = installFakeTt()
    const t = new DouyinTransport(makeOpts())
    t.open()
    const buf = new Uint8Array([1, 2, 3]).buffer
    ;(t as any).write([{ type: 'message', data: buf }])
    const sent = task.send.mock.calls[0][0].data
    expect(sent).toBeInstanceOf(ArrayBuffer)
  })

  it('emits "close" when the socket closes', () => {
    const { h } = installFakeTt()
    const t = new DouyinTransport(makeOpts())
    const closed = vi.fn()
    ;(t as any).on('close', closed)
    t.open()
    h.open()
    h.close()
    expect(closed).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test douyin-transport`
Expected: FAIL —— 无法解析 `../src/transports/douyin`(模块不存在)。

- [ ] **Step 3: 新建 `src/transports/douyin.ts`**

```ts
import { Transport } from 'engine.io-client'
import { encodePacket } from 'engine.io-parser'
import type { Packet, RawData } from 'engine.io-parser'
import { buildUri } from './base'

/**
 * 抖音(字节跳动)小程序 transport。
 *
 * 抖音与微信同构:`tt.connectSocket` 同步返回一个 SocketTask,二进制原生收发
 * ArrayBuffer(无需支付宝那套 base64,也无需 TypedArray→ArrayBuffer 的 slice 修正)。
 * `tt` 为整个字节系小程序(抖音 / 今日头条 / 西瓜 / 极速版等)共用,故本 transport
 * 一次性覆盖所有字节系宿主。
 */
export class DouyinTransport extends Transport {
  private task?: DouyinMiniprogram.SocketTask

  get name(): 'websocket' {
    return 'websocket'
  }

  protected doOpen(): void {
    const query = this.query as Record<string, string>
    const url = buildUri(this.opts as any, query)
    this.task = tt.connectSocket({
      url,
      header: (this.opts as any).extraHeaders,
    })
    this.task.onOpen(() => this.onOpen())
    this.task.onMessage((res) => this.onData(res.data as RawData))
    this.task.onClose(() => this.onClose())
    this.task.onError((res) => this.onError('websocket error', new Error(res.errMsg)))
  }

  protected doClose(): void {
    this.task?.close({})
    this.task = undefined
  }

  protected write(packets: Packet[]): void {
    if (packets.length === 0) return
    this.writable = false
    let remaining = packets.length
    for (const packet of packets) {
      encodePacket(packet, true, (data) => {
        this.task?.send({ data: data as string | ArrayBuffer })
        if (--remaining === 0) {
          // Defer drain so callers don't re-enter write() synchronously
          // (encodePacket callbacks fire sync; without this setTimeout the
          //  engine.io-client flush → write → drain → flush loop blows the stack)
          setTimeout(() => {
            this.writable = true
            this.emitReserved('drain')
          }, 0)
        }
      })
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test douyin-transport`
Expected: PASS（8 个用例全过；vitest 只转译不类型检查,`tt` 由测试在 `globalThis` 上注入,运行时可用）。

- [ ] **Step 5: 跑类型检查确认失败**

Run: `pnpm typecheck`
Expected: FAIL —— `src/transports/douyin.ts` 报 `Cannot find name 'tt'` 与 `Cannot find namespace 'DouyinMiniprogram'`(尚无 `tt` 类型声明)。

- [ ] **Step 6: 新建 `src/transports/tt.d.ts`**

```ts
/**
 * 抖音(字节跳动)小程序最小 ambient 类型声明。
 *
 * 抖音生态没有同等权威 / 稳定的官方 typings 包,这里只声明本 transport 实际用到的
 * `tt` API 子集,避免引入维护状况不明的第三方依赖。这些声明位于 tsconfig `include`
 * 的 `src` 目录内会被自动纳入;`tt` 与 `wx`(miniprogram-api-typings)/`my`
 * (@mini-types/alipay)无命名冲突。
 *
 * 来源:https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/api/network/web-socket/tt-connect-socket
 */
declare namespace DouyinMiniprogram {
  interface SocketTask {
    onOpen(cb: (res: { header?: Record<string, string> }) => void): void
    onMessage(cb: (res: { data: string | ArrayBuffer }) => void): void
    onClose(cb: (res: { code?: number; reason?: string }) => void): void
    onError(cb: (res: { errMsg: string }) => void): void
    send(opts: { data: string | ArrayBuffer }): void
    close(opts: { code?: number; reason?: string }): void
  }
  interface ConnectSocketOptions {
    url: string
    header?: Record<string, string>
    protocols?: string[]
  }
}

declare const tt: {
  connectSocket(opts: DouyinMiniprogram.ConnectSocketOptions): DouyinMiniprogram.SocketTask
}
```

- [ ] **Step 7: 跑类型检查确认通过**

Run: `pnpm typecheck`
Expected: PASS（无错误）。

- [ ] **Step 8: 提交**

```bash
git add src/transports/douyin.ts src/transports/tt.d.ts tests/douyin-transport.test.ts
git commit -m "feat: 新增抖音小程序 DouyinTransport 与 tt 类型声明"
```

---

### Task 2: `detectTransport` 追加 `tt` 探测

**Files:**
- Modify: `src/transports/detect.ts`
- Test: `tests/detect.test.ts`

**Interfaces:**
- Consumes: `DouyinTransport`(Task 1)、`typeof tt`(Task 1 的 ambient 声明)。
- Produces: `detectTransport()` 在 `wx`、`my` 之后新增 `tt` 分支,无平台时报错文案含 `wx/my/tt`。

- [ ] **Step 1: 在 `tests/detect.test.ts` 加失败用例**

把顶部 import 增补为(新增第 4 行):

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { detectTransport } from '../src/transports/detect'
import { WechatTransport } from '../src/transports/wechat'
import { AlipayTransport } from '../src/transports/alipay'
import { DouyinTransport } from '../src/transports/douyin'
```

把 `afterEach` 增补 `tt` 清理:

```ts
afterEach(() => {
  delete (globalThis as any).wx
  delete (globalThis as any).my
  delete (globalThis as any).tt
})
```

在 `describe('detectTransport', …)` 内、`throws` 用例之前,新增两个用例:

```ts
  it('returns DouyinTransport when only tt.connectSocket exists', () => {
    ;(globalThis as any).tt = { connectSocket: () => ({}) }
    expect(detectTransport()).toBe(DouyinTransport)
  })
  it('prefers Wechat over tt when both exist', () => {
    ;(globalThis as any).wx = { connectSocket: () => ({}) }
    ;(globalThis as any).tt = { connectSocket: () => ({}) }
    expect(detectTransport()).toBe(WechatTransport)
  })
```

> 现有 `throws a helpful error` 用例断言 `/wx\/my/`,新文案 `wx/my/tt` 仍含子串 `wx/my`,无需改动。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test detect`
Expected: FAIL —— `returns DouyinTransport when only tt…` 失败:当前无 `tt` 分支,`detectTransport()` 因无匹配而 `throw`,而非返回 `DouyinTransport`。

- [ ] **Step 3: 修改 `src/transports/detect.ts`**

完整新内容:

```ts
import type { TransportCtor } from '../types'
import { WechatTransport } from './wechat'
import { AlipayTransport } from './alipay'
import { DouyinTransport } from './douyin'

/** 运行时探测当前小程序平台，返回对应 transport 类。 */
export function detectTransport(): TransportCtor {
  if (typeof wx !== 'undefined' && typeof wx.connectSocket === 'function') {
    return WechatTransport as unknown as TransportCtor
  }
  if (typeof my !== 'undefined' && typeof my.connectSocket === 'function') {
    return AlipayTransport as unknown as TransportCtor
  }
  if (typeof tt !== 'undefined' && typeof tt.connectSocket === 'function') {
    return DouyinTransport as unknown as TransportCtor
  }
  throw new Error(
    '[socket.io-mp] 未检测到 wx/my/tt 的 WebSocket API；请用 io(uri, { transports: [自定义Transport] }) 显式注入',
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test detect`
Expected: PASS（含新增 2 例,共 6 例）。

- [ ] **Step 5: 提交**

```bash
git add src/transports/detect.ts tests/detect.test.ts
git commit -m "feat: detectTransport 支持抖音 tt 运行时探测"
```

---

### Task 3: 从入口导出 `DouyinTransport`

**Files:**
- Modify: `src/index.ts`
- Test: `tests/index.test.ts`

**Interfaces:**
- Consumes: `DouyinTransport`(Task 1);`io()` + `detectTransport()`(经 Task 2 可路由到 `tt`)。
- Produces: 公开具名导出 `DouyinTransport`(从 `socket.io-mp` 入口)。

- [ ] **Step 1: 在 `tests/index.test.ts` 加失败用例**

把顶部 import 增补为(新增第 3 行,从**入口**引入以验证 re-export):

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { io } from '../src/index'
import { DouyinTransport } from '../src/index'
import { WechatTransport } from '../src/transports/wechat'
```

把 `afterEach` 增补 `tt` 清理:

```ts
afterEach(() => {
  delete (globalThis as any).wx
  delete (globalThis as any).tt
})
```

在 `describe('io()', …)` 内新增用例:

```ts
  it('uses the detected transport (douyin) and forces websocket', () => {
    ;(globalThis as any).tt = { connectSocket: () => ({}) }
    const socket = io('ws://localhost:3000', { autoConnect: false })
    expect(socket.io.opts.transports).toEqual([DouyinTransport])
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test index`
Expected: FAIL —— `DouyinTransport` 未从入口导出,`import` 得到 `undefined`,`toEqual([undefined])` 与实际的 `[DouyinTransport]` 不符。

- [ ] **Step 3: 修改 `src/index.ts`**

在 `export { AlipayTransport } …` 一行之后新增一行:

```ts
export { WechatTransport } from './transports/wechat'
export { AlipayTransport } from './transports/alipay'
export { DouyinTransport } from './transports/douyin'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test index`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: 从入口导出 DouyinTransport"
```

---

### Task 4: 抖音端到端(e2e)

**Files:**
- Modify: `tests/e2e.test.ts`

**Interfaces:**
- Consumes: `io`(入口)、真实 in-process `socket.io` Server(文件内 `beforeAll` 已建)、`DouyinTransport`(经探测路由)。
- Produces: 一个 `tt` 驱动的 e2e describe;以及复用的模块级工厂 `wsBackedConnectSocket`(微信 / 抖音共用)。

> 说明:这些是**验证型**集成测试——Task 1/2 完成后即应通过(经由真实上游全栈跑通 `tt` 接线)。本任务同时做一次小重构:把原本顶层 `beforeEach` 里设的 `wx` 假实现移进各自 describe 作用域,避免顶层 hook 污染抖音用例。

- [ ] **Step 1: 新增模块级工厂 `wsBackedConnectSocket`**

在 `toArrayBuffer` 函数定义之后插入:

```ts
// 用一条真实 ws 连接驱动假的 connectSocket，让 transport 真正连上 in-process server。
// 微信与抖音同构(都返回 SocketTask、二进制原生 ArrayBuffer),共用同一份实现。
function wsBackedConnectSocket({ url }: { url: string }) {
  const ws = new WS(url)
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
}
```

- [ ] **Step 2: 删除顶层 `wx` 的 `beforeEach` / `afterEach`**

删掉这一整段(连同其上方 `// 把 wx.connectSocket mock 成…` 注释):

```ts
// 把 wx.connectSocket mock 成由 ws 驱动的真实连接，让 WechatTransport 真正连上 server
beforeEach(() => {
  ;(globalThis as any).wx = {
    connectSocket({ url }: { url: string }) {
      const ws = new WS(url)
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
```

- [ ] **Step 3: 把微信 describe 改名并加上作用域内 hook**

把 `describe('e2e against a real socket.io server', () => {` 这一行替换为下面这几行(改名 + 紧随其后的 `beforeEach` / `afterEach`):

```ts
describe('e2e against a real socket.io server (wechat)', () => {
  beforeEach(() => {
    ;(globalThis as any).wx = { connectSocket: wsBackedConnectSocket }
  })
  afterEach(() => {
    delete (globalThis as any).wx
  })
```

> 该 describe 内原有 5 个用例与闭合 `})` 全部保持不变。

- [ ] **Step 4: 在文件末尾新增抖音 describe**

在微信 describe 的闭合 `})` 之后追加:

```ts
describe('e2e against a real socket.io server (douyin)', () => {
  beforeEach(() => {
    ;(globalThis as any).tt = { connectSocket: wsBackedConnectSocket }
  })
  afterEach(() => {
    delete (globalThis as any).tt
  })

  it('★ connects and reports connected via tt', async () => {
    const socket = io(`ws://localhost:${port}`, { forceNew: true })
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve())
        socket.on('connect_error', reject)
      })
      expect(socket.connected).toBe(true)
    } finally {
      socket.disconnect()
    }
  })

  it('round-trips binary (ArrayBuffer) via tt', async () => {
    const socket = io(`ws://localhost:${port}`, { forceNew: true })
    const out = new Uint8Array([1, 2, 3, 4])
    try {
      const echoed = await new Promise<ArrayBuffer>((resolve, reject) => {
        socket.on('connect_error', reject)
        socket.on('connect', () => socket.emit('bin', out.buffer, resolve))
      })
      expect(new Uint8Array(echoed)).toEqual(out)
    } finally {
      socket.disconnect()
    }
  })
})
```

- [ ] **Step 5: 跑 e2e 全量确认通过**

Run: `pnpm test e2e`
Expected: PASS —— 微信 5 例 + 抖音 2 例全过。

- [ ] **Step 6: 提交**

```bash
git add tests/e2e.test.ts
git commit -m "test: 新增抖音 transport 的端到端用例"
```

---

### Task 5: 文档与元数据

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: 无(纯文档/元数据)。
- Produces: 对外文档与 npm keywords 反映抖音支持。

- [ ] **Step 1: `package.json` 增补 keywords**

把 keywords 数组里 `"alipay",` 之后增补三项:

```json
  "keywords": [
    "socket.io",
    "socket.io-client",
    "websocket",
    "miniprogram",
    "weapp",
    "wechat",
    "alipay",
    "douyin",
    "bytedance",
    "tt",
    "taro",
    "uni-app"
  ],
```

- [ ] **Step 2: `README.md` 更新(逐处替换)**

1) 徽章区(`![支付宝小程序]…` 那行之后)新增一行:

```md
![抖音小程序](https://img.shields.io/badge/抖音小程序-%E2%9C%93-000000.svg)
```

2) 简介行(原"微信 / 支付宝小程序的 socket.io 客户端…")替换为:

```md
微信 / 支付宝 / 抖音小程序的 socket.io 客户端：直接复用官方 `socket.io-client`，仅把底层 WebSocket transport 换成小程序原生实现，**API 与官方完全一致**，严格对齐 socket.io v4。
```

3) 「特性」首条(原"**双端**:微信 / 支付宝…")替换为:

```md
- **三端**：微信 / 支付宝 / 抖音(及今日头条等字节系),运行时自动探测 `wx` / `my` / `tt`,无需手动区分平台
```

4) 「二进制数据」段说明句(原"微信走原生 ArrayBuffer,支付宝内部用 base64 编解码,**对调用方透明**")替换为:

```md
直接 `emit` / 接收 `ArrayBuffer`（或 `TypedArray`）。微信、抖音走原生 ArrayBuffer，支付宝内部用 base64 编解码，**对调用方透明**：
```

5) 「平台支持」表在支付宝行之后新增一行:

```md
| 抖音小程序（字节系） | `tt.connectSocket`（返回 SocketTask） | 多连接 | 原生 ArrayBuffer |
```

并把该表下方说明句替换为:

```md
运行时通过 `wx` / `my` / `tt` 全局对象自动探测;`tt` 为整个字节系小程序（抖音 / 今日头条 / 西瓜 / 极速版等）共用。多端共存时优先级 微信 > 支付宝 > 抖音。
```

6) 「框架适配」首段(原"…如果运行时仍然存在 `wx` / `my` 全局…")把 `wx` / `my` 改为 `wx` / `my` / `tt`:

```md
在 Taro、uni-app 等框架里，如果运行时仍然存在 `wx` / `my` / `tt` 全局（编译到小程序端通常如此），可直接使用，无需额外配置。
```

并把其后"若运行在没有 `wx` / `my` 的环境"一句中的 `wx` / `my` 改为 `wx` / `my` / `tt`。
并把参考链接行追加抖音 transport:

```md
可直接参考仓库内的 [`src/transports/wechat.ts`](./src/transports/wechat.ts)、[`src/transports/alipay.ts`](./src/transports/alipay.ts)、[`src/transports/douyin.ts`](./src/transports/douyin.ts)。
```

7) 「导出」代码块在 `AlipayTransport,` 一行后新增:

```ts
  DouyinTransport, // 抖音 / 字节系 transport
```

8) 「常见问题」里 `报错 \`未检测到 wx/my 的 WebSocket API\`?` 一段:标题与正文的 `wx` / `my` 改为 `wx` / `my` / `tt`:

```md
**报错 `未检测到 wx/my/tt 的 WebSocket API`？**
说明当前运行环境没有 `wx` / `my` / `tt` 全局（例如在 H5、Node、纯浏览器里跑）。请在小程序端运行，或通过 `io(uri, { transports: [自定义Transport] })` 显式注入 transport。
```

- [ ] **Step 3: `CLAUDE.md` 更新(逐处替换)**

1) 「What this package is」首句(原"run inside WeChat (微信) and Alipay (支付宝) mini-programs")替换为:

```md
`socket.io-mp` lets the **official** `socket.io-client` run inside WeChat (微信), Alipay (支付宝) and
Douyin/ByteDance (抖音/字节跳动) mini-programs. It is an *adapter*, not a protocol reimplementation: every protocol capability
```

2) Architecture 代码块里 `detectTransport()` 子树补一项:

```
  └─ detectTransport()                src/transports/detect.ts — runtime-probes wx / my / tt globals
       ├─ WechatTransport             src/transports/wechat.ts
       ├─ AlipayTransport             src/transports/alipay.ts
       └─ DouyinTransport             src/transports/douyin.ts — mirrors WechatTransport (tt global)
```

3) 在「The platform asymmetry」表格之后、「Because Alipay's API…」段落之前,新增一段:

```md
**Douyin (`tt`) follows the WeChat model exactly** — `tt.connectSocket` returns a per-connection
`SocketTask`, binary is native `ArrayBuffer` end-to-end (no base64), up to 5 concurrent connections.
So `DouyinTransport` mirrors `WechatTransport` line-for-line, swapping only the `wx` global for `tt`.
The `tt` global is shared across the whole ByteDance mini-app platform (抖音/今日头条/西瓜/极速版),
so this one transport covers every ByteDance host. There is no canonical typings package for `tt`, so a
minimal ambient declaration of the used subset lives in `src/transports/tt.d.ts` (no new dependency).
```

4) 「Testing」→ Unit tests 列表项里把 `wechat-transport`, `alipay-transport`, `detect`, `base` 增补 `douyin-transport`,并把"install a fake `wx` / `my`"改为"install a fake `wx` / `my` / `tt`"。

5) 「Constraints」里"Guard every `wx` / `my` access"改为"Guard every `wx` / `my` / `tt` access";"these globals do not exist in Node/CI"保持不变。

- [ ] **Step 4: 跑类型检查与全量测试确认无回归**

Run: `pnpm typecheck && pnpm test`
Expected: PASS（文档/元数据改动不影响)。

- [ ] **Step 5: 提交**

```bash
git add README.md CLAUDE.md package.json
git commit -m "docs: README/CLAUDE/package 补充抖音小程序支持"
```

---

### Task 6: 全量验证(typecheck + test + build)

**Files:** 无(仅验证;`dist/` 不提交)。

- [ ] **Step 1: 复刻 `prepublishOnly` 门槛**

Run: `pnpm run typecheck && pnpm run test && pnpm run build`
Expected: 三者全绿;`pnpm test` 显示新增用例(douyin-transport 8 + detect +2 + index +1 + e2e +2)均通过;`pnpm build` 产出 `dist/index.mjs` / `dist/index.cjs` / `dist/index.d.ts`。

- [ ] **Step 2: 校验产物含 `DouyinTransport` 导出**

Run: `grep -c "DouyinTransport" dist/index.d.ts dist/index.mjs`
Expected: 两个文件均 `>= 1`(`.d.ts` 含 `DouyinTransport` 类型导出,`.mjs` 含其实现/导出)。

> 本任务无代码改动,通常不产生提交;`dist/` 不纳入版本库。

---

## Self-Review

**1. Spec coverage（逐条对照 spec):**
- 关键事实(微信模型 / 原生 ArrayBuffer / wss / 并发) → Task 1 实现 + Task 4 e2e 印证。✅
- 架构决策①独立文件 → Task 1。✅ ②本地 ambient 类型不引依赖 → Task 1 Step 6(`tt.d.ts`)。✅ ③命名 `DouyinTransport` → Task 1/3。✅ ④检测顺序 `wx→my→tt` → Task 2。✅
- `tt.d.ts` 字段(connectSocket / SocketTask 六方法 / opts) → Task 1 Step 6。✅
- `douyin.ts`(name/doOpen/doClose/write + 延迟 drain + 二进制原生透传) → Task 1 Step 3。✅
- `detect.ts` 分支 + 报错文案 → Task 2。✅
- `index.ts` 导出 → Task 3。✅
- 单测镜像微信 8 例 → Task 1 Step 1。✅ detect 加 `tt` 例 → Task 2。✅ e2e 复用工厂 + `tt` 连接/二进制 → Task 4。✅
- 文档(CLAUDE/README)+ keywords → Task 5。✅
- 验收标准 typecheck/test/build 全绿、零回归 → Task 6 + 各任务内 typecheck。✅
- 非目标(不抽基类 / 不引第三方类型 / 不特殊处理二进制 / 不做 polling) → 计划未触碰,符合。✅

**2. Placeholder scan:** 无 TBD/TODO;每个改代码的步骤均给出完整代码与确切命令、预期输出。✅

**3. Type consistency:**
- `DouyinTransport`(类名)在 Task 1/2/3/4 一致。✅
- `DouyinMiniprogram.SocketTask`(Task 1 Step 6 声明)= `douyin.ts`(Step 3)中 `private task?` 的类型,字段 `onOpen/onMessage/onClose/onError/send/close` 与 `douyin.ts` 调用一致;`onError` 回调用 `res.errMsg` 与声明 `{ errMsg: string }` 一致。✅
- `tt.connectSocket(opts): SocketTask` 的 `opts` 含 `url`/`header`,与 `douyin.ts` 调用(`{ url, header }`)一致。✅
- 测试里假 `task` 的方法集(`onOpen/onMessage/onClose/onError/send/close`)= 声明与实现使用的方法集。✅
- e2e `wsBackedConnectSocket` 返回对象的方法集同上,且 `send({ data })` / `close()` 形参与实现调用一致。✅
