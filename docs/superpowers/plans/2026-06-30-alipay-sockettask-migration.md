# 支付宝 Transport 迁移到 SocketTask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `AlipayTransport` 从已废弃的全局 `my.onSocket*` 事件 API 迁移到 `my.connectSocket({multiple:true})` 返回的 per-connection `SocketTask`,根除全局 handler 泄漏、解除单连接限制、停用废弃 API。

**Architecture:** `SocketTask` 与微信同构(per-connection,handler 绑 task 随 GC 释放)。迁移后 `AlipayTransport` 结构趋同 `WechatTransport`,唯一差异是二进制仍走 base64 + `isBuffer`(支付宝 `send` 只接受 string)。对外 socket.io v4 行为不变。

**Tech Stack:** TypeScript（es2018, strict）、engine.io-client `Transport` 基类、engine.io-parser `encodePacket`、vitest。

## Global Constraints

- `target: es2018` 且 `useDefineForClassFields: false`（`tsconfig.json` / `vite.config.ts`）；`strict` 开启。
- 不修改 `WechatTransport`、`base.ts`、`detect.ts`、`index.ts`、`types.ts`。
- 不引入抖音支持、不提取共享基类（YAGNI）。
- 二进制保留 base64 + `isBuffer` 等价语义；**本次不做真机验证**，代码注释标注 `isBuffer` 待验证。
- `doOpen` 不传 `header`（与当前支付宝行为一致）。
- 提交：约定式提交 + 中文描述 + 模型署名 footer。
- 包管理器 pnpm；命令 `pnpm typecheck` / `pnpm test`。

---

## File Structure

- **Modify（整体重写）**：`src/transports/alipay.ts` — 改为 SocketTask 实现；新增局部 `AliSocketTask` 接口;移除 `onAliOpen/onAliMessage/onAliClose/onAliError` 箭头字段与 `cleanup()`。
- **Modify（整体重写）**：`tests/alipay-transport.test.ts` — `installFakeMy` 改为返回 fake `task`（与 `tests/wechat-transport.test.ts` 同款）;测试用例改为断言 SocketTask 行为;删除"全局 handler 反注册"两条测试。
- **Modify（局部）**：`README.md` — 支付宝单连接相关三处改为多连接 / SocketTask。
- **Modify（局部）**：`CLAUDE.md` — 平台不对称表支付宝列 + 全局单例段改写。

---

## Task 1: 迁移 AlipayTransport 实现与测试到 SocketTask

**Files:**
- Modify: `src/transports/alipay.ts`（整体重写）
- Test: `tests/alipay-transport.test.ts`（整体重写）

**Interfaces:**
- Consumes: engine.io-client `Transport` 基类的 `onOpen() / onData(data) / onClose() / onError(reason, desc) / emitReserved(ev)`、属性 `query / opts / writable`;engine.io-parser `encodePacket(packet, supportsBinary, cb)`;`./base` 的 `buildUri(opts, query)`;全局 `my.connectSocket / my.arrayBufferToBase64 / my.base64ToArrayBuffer`。
- Produces: `AlipayTransport`（导出类，被 `src/index.ts` 与 `detect.ts` 引用，类名和构造签名不变）。

- [ ] **Step 1: 整体重写测试文件为 SocketTask fake**

把 `tests/alipay-transport.test.ts` 全文替换为下面内容（`installFakeMy` 改为返回 fake `task`，删除全局 handler 反注册相关测试，新增 `doClose 关闭 task`）：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AlipayTransport } from '../src/transports/alipay'

function installFakeMy() {
  const h: Record<string, (arg?: any) => void> = {}
  const task = {
    onOpen: (cb: any) => { h.open = cb },
    onMessage: (cb: any) => { h.message = cb },
    onClose: (cb: any) => { h.close = cb },
    onError: (cb: any) => { h.error = cb },
    send: vi.fn(),
    close: vi.fn(),
  }
  const my = {
    connectSocket: vi.fn((_opts: any) => task),
    // Alipay sends/receives binary as base64 strings; the platform provides these.
    arrayBufferToBase64: vi.fn((_buf: ArrayBuffer) => 'BASE64'),
    base64ToArrayBuffer: vi.fn((_s: string) => new Uint8Array([1, 2, 3]).buffer),
  }
  ;(globalThis as any).my = my
  return { my, task, h }
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

  it('doOpen connects in SocketTask mode (multiple:true) with EIO=4 & transport=websocket', () => {
    const { my } = installFakeMy()
    new AlipayTransport(makeOpts()).open()
    expect(my.connectSocket).toHaveBeenCalledTimes(1)
    const arg = my.connectSocket.mock.calls[0][0]
    expect(arg.multiple).toBe(true)
    expect(arg.url).toContain('EIO=4')
    expect(arg.url).toContain('transport=websocket')
  })

  it('emits "open" when the socket opens', () => {
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

  it('base64-decodes an incoming binary frame before handing it to the engine', () => {
    const { my, h } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    const onPacket = vi.fn()
    ;(t as any).on('packet', onPacket)
    t.open()
    h.open()
    h.message({ data: 'BASE64', isBuffer: true })
    expect(my.base64ToArrayBuffer).toHaveBeenCalledWith('BASE64')
    expect(onPacket).toHaveBeenCalledWith(expect.objectContaining({ type: 'message' }))
  })

  it('write sends a text packet with isBuffer=false then drains', () => {
    vi.useFakeTimers()
    const { task } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    const drain = vi.fn()
    ;(t as any).on('drain', drain)
    t.open()
    ;(t as any).write([{ type: 'message', data: 'hi' }])
    expect(task.send).toHaveBeenCalledWith({ data: '4hi', isBuffer: false })
    expect(drain).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(drain).toHaveBeenCalled()
    expect((t as any).writable).toBe(true)
    vi.useRealTimers()
  })

  it('write base64-encodes a binary packet and sets isBuffer=true', () => {
    const { my, task } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    t.open()
    const buf = new Uint8Array([1, 2, 3]).buffer
    ;(t as any).write([{ type: 'message', data: buf }])
    expect(my.arrayBufferToBase64).toHaveBeenCalledWith(buf)
    expect(task.send).toHaveBeenCalledWith({ data: 'BASE64', isBuffer: true })
  })

  it('write converts a TypedArray binary packet to ArrayBuffer before base64', () => {
    const { my } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    t.open()
    ;(t as any).write([{ type: 'message', data: new Uint8Array([9, 8, 7]) }])
    expect(my.arrayBufferToBase64).toHaveBeenCalled()
    expect(my.arrayBufferToBase64.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer)
  })

  it('write([]) does not leave the transport stuck non-writable', () => {
    const { h } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    t.open()
    h.open() // onOpen sets writable = true
    expect((t as any).writable).toBe(true)
    ;(t as any).write([])
    expect((t as any).writable).toBe(true)
  })

  it('emits "close" when the socket closes', () => {
    const { h } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    const closed = vi.fn()
    ;(t as any).on('close', closed)
    t.open()
    h.open()
    h.close()
    expect(closed).toHaveBeenCalled()
  })

  it('doClose closes the task', () => {
    const { task } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    t.open()
    ;(t as any).doClose()
    expect(task.close).toHaveBeenCalled()
  })

  it('doOpen 在 connectSocket 抛错时发出 error 事件而非向上抛出', () => {
    const { my } = installFakeMy()
    my.connectSocket = vi.fn(() => {
      throw new Error('connect failed')
    }) as any
    const t = new AlipayTransport(makeOpts())
    const errored = vi.fn()
    ;(t as any).on('error', errored)
    expect(() => t.open()).not.toThrow()
    expect(errored).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败（实现仍是旧的全局 API）**

Run: `pnpm test alipay`
Expected: FAIL。旧实现 `doOpen` 调用 `my.onSocketOpen(...)`，而新 fake 的 `my` 没有该方法 → 报 `my.onSocketOpen is not a function`（连接类用例全红）。这证明测试在驱动尚未迁移的实现。

- [ ] **Step 3: 整体重写 `src/transports/alipay.ts` 为 SocketTask 实现**

把 `src/transports/alipay.ts` 全文替换为：

```ts
import { Transport } from 'engine.io-client'
import { encodePacket } from 'engine.io-parser'
import type { Packet, RawData } from 'engine.io-parser'
import { buildUri } from './base'

/**
 * 支付宝小程序 transport（SocketTask 模式，per-connection）。
 *
 * 用 my.connectSocket({ multiple: true }) 返回的 SocketTask 管理连接,handler 绑在
 * task 上(随实例 GC 释放),不再使用已废弃的全局 my.onSocket* 事件,因而天然没有
 * 跨连接的 handler 泄漏,也不再受"单连接"限制。
 *
 * 二进制差异:支付宝 send 只接受 string,二进制需 my.arrayBufferToBase64 编码后配合
 * isBuffer:true 发送;接收端 isBuffer 为 true 时 data 是 base64,用 my.base64ToArrayBuffer
 * 还原成 ArrayBuffer 再交给 engine。
 */

/**
 * 我们依赖的 SocketTask 契约子集。显式定义而非复用 @mini-types/my 的全局 SocketTask
 * 类型:其全局命名空间类型的引用方式随版本而变,局部接口可保证可编译;并补上 send 的
 * isBuffer——官方类型漏标,但接收端 onMessage 的 isBuffer 已存在,对称推断发送端亦支持
 * (待真机验证)。
 */
interface AliSocketTask {
  onOpen(cb: () => void): void
  onMessage(cb: (res: { data: string | ArrayBuffer; isBuffer: boolean }) => void): void
  onClose(cb: () => void): void
  onError(cb: (res: { errorMessage?: string; error?: number }) => void): void
  send(opt: { data: string; isBuffer?: boolean }): void
  close(opt?: { code?: number; reason?: string }): void
}

export class AlipayTransport extends Transport {
  private task?: AliSocketTask

  get name(): 'websocket' {
    return 'websocket'
  }

  protected doOpen(): void {
    try {
      const query = this.query as Record<string, string>
      // multiple:true 启用 SocketTask 模式;不传 header(与历史支付宝行为一致,平台 header 支持有限)。
      this.task = my.connectSocket({
        url: buildUri(this.opts as any, query),
        multiple: true,
      }) as unknown as AliSocketTask
      this.task.onOpen(() => this.onOpen())
      this.task.onMessage((res) => {
        const data: RawData = res.isBuffer
          ? my.base64ToArrayBuffer(res.data as string)
          : (res.data as string)
        this.onData(data)
      })
      this.task.onClose(() => this.onClose())
      this.task.onError((res) =>
        this.onError('websocket error', new Error(res?.errorMessage ?? 'websocket error')),
      )
    } catch (err) {
      // 建连失败转成 transport error 事件,交给 engine.io 走重连/降级,而非让异常逃逸。
      this.onError('websocket error', err as Error)
    }
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
      // 第二参恒传 true,不可改成 this.supportsBinary:supportsBinary=false 时
      // engine.io-parser 会用 `new Blob()` + FileReader 把二进制编码成 base64,而小程序
      // 无 Blob/FileReader 会运行时崩溃。二进制改由下方 isBuffer 分支经 arrayBufferToBase64 处理。
      encodePacket(packet, true, (data) => {
        if (typeof data === 'string') {
          this.task?.send({ data, isBuffer: false })
        } else {
          // 二进制可能是 ArrayBuffer,也可能是 TypedArray;取底层精确字节再 base64,
          // 避免把非零 offset 的 view 当整个 buffer 误传。
          const ab = ArrayBuffer.isView(data)
            ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
            : (data as ArrayBuffer)
          // isBuffer 为支付宝 send 的二进制标志(@mini-types 漏标,见 AliSocketTask 注释);待真机验证。
          this.task?.send({ data: my.arrayBufferToBase64(ab), isBuffer: true })
        }
        if (--remaining === 0) {
          // 延迟 drain,避免 encodePacket 同步回调导致 flush→write→drain→flush 同步重入爆栈。
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

- [ ] **Step 4: 运行支付宝测试，确认全部通过**

Run: `pnpm test alipay`
Expected: PASS（12 个用例全绿）。

- [ ] **Step 5: 全量 typecheck 与测试，确认无回归**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck 无输出（通过）；测试全绿（微信、base、detect、e2e、index 不受影响）。

- [ ] **Step 6: 提交**

```bash
git add src/transports/alipay.ts tests/alipay-transport.test.ts
git commit -F - <<'EOF'
refactor(alipay): 迁移 transport 到 SocketTask 模式

- 用 my.connectSocket({multiple:true}) 返回的 SocketTask 替换全局事件 API
- handler 绑 task 随 GC 释放:根除全局 handler 泄漏、解除单连接限制、停用废弃 API
- 二进制保留 base64+isBuffer 语义(isBuffer 为 @mini-types 漏标,待真机验证)
- 测试改为 fake connectSocket 返回 task(与微信同款),移除全局 handler 反注册用例

BREAKING CHANGE: 支付宝端需支持 SocketTask multiple 模式的基础库版本

🤖 Generated with Claude Opus 4.8

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
```

---

## Task 2: 同步文档（README + CLAUDE.md）

**Files:**
- Modify: `README.md`（三处支付宝单连接描述）
- Modify: `CLAUDE.md`（平台不对称表支付宝列 + 全局单例段）

**Interfaces:**
- Consumes: Task 1 已完成的 SocketTask 迁移（文档需与之一致）。
- Produces: 无代码接口。

> 注意：README / CLAUDE.md 已含抖音内容（用户在建）。本任务**只改支付宝相关行，不得增删抖音相关内容**。若下列 old 文本因用户编辑而略有出入，按当前文件实际文本定位、保持等价改动。

- [ ] **Step 1: 更新 `README.md` 平台支持表的支付宝行**

把（约第 167 行）：

```md
| 支付宝小程序 | `my.connectSocket`（全局事件式） | **单连接** | base64 编解码（对调用方透明） |
```

改为：

```md
| 支付宝小程序 | `my.connectSocket({ multiple: true })`（返回 SocketTask） | 多连接 | base64 编解码（对调用方透明） |
```

- [ ] **Step 2: 更新 `README.md` 「与官方的差异」表，移除单连接行**

删除（约第 158 行）整行：

```md
| 支付宝单连接 | 支付宝是全局事件式 API，同一时刻仅一条连接；同时连接多个不同服务端的 Manager 会互相干扰 |
```

- [ ] **Step 3: 更新 `README.md` 常见问题，移除单连接 FAQ**

删除该 FAQ 条目（约第 235-236 行，含问句与答句两行及其后的空行）：

```md
**支付宝里开了多个连接互相干扰？**
支付宝的 socket 是全局事件式、单连接模型，同一时刻只能有一条连接。请复用同一个 socket，避免同时创建多个连不同服务端的 Manager。
```

- [ ] **Step 4: 更新 `CLAUDE.md` 平台不对称表的支付宝两格**

把表中 Connect API 行的支付宝格：

```
`my.connectSocket` + **global** `my.onSocket*` event handlers
```

改为：

```
`my.connectSocket({multiple:true})` returns a per-connection `SocketTask`
```

把 Concurrency 行的支付宝格：

```
**single connection only** (global event model — multiple Managers to different servers interfere)
```

改为：

```
multi-connection (`multiple:true`)
```

- [ ] **Step 5: 改写 `CLAUDE.md` 的「全局单例」段**

把这一段（约第 59-62 行）：

```md
Because Alipay's API is a global singleton, `AlipayTransport` registers handlers as **arrow-function
class fields** (`onAliOpen`, etc.) so the *exact same reference* is passed to both `my.onSocket*` and
`my.offSocket*`. Registering with one closure and unregistering with another would make `off*` a no-op
and leak handlers across connections. Asserted in `tests/alipay-transport.test.ts`.
```

改为：

```md
`AlipayTransport` uses the `SocketTask` returned by `my.connectSocket({multiple:true})` and binds
handlers to that task (released with it on GC), exactly like `WechatTransport` — so there is no
global-handler leak and no single-connection limit. Binary still goes through `my.arrayBufferToBase64`
on send (`isBuffer:true`) and `my.base64ToArrayBuffer` on receive, because Alipay's `send` only accepts
strings. The `isBuffer` send flag is missing from `@mini-types/my` (receive side has it) and is asserted
against a fake task in `tests/alipay-transport.test.ts`; real-device verification of binary send is pending.
```

- [ ] **Step 6: 运行全量验证（文档改动不应影响构建/测试）**

Run: `pnpm typecheck && pnpm test`
Expected: 全部通过（无变化）。

- [ ] **Step 7: 提交**

```bash
git add README.md CLAUDE.md
git commit -F - <<'EOF'
docs: 同步支付宝迁移 SocketTask 后的文档

- README:平台表支付宝改为 SocketTask/多连接,移除单连接差异行与 FAQ
- CLAUDE.md:平台不对称表与全局单例段改写为 SocketTask 模式

🤖 Generated with Claude Opus 4.8

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
```

---

## Self-Review

**1. Spec coverage**（逐条对照 spec）：
- 迁移到 SocketTask / 根除泄漏 / 解除单连接 / 停用废弃 API → Task 1 Step 3 ✅
- 对外行为不变（name/连接/收发/关闭/drain）→ Task 1 测试用例 ✅
- 不改微信 → Global Constraints + 仅改 alipay 文件 ✅
- 二进制 base64+isBuffer + TypedArray + deferred drain → Task 1 `write` + 对应测试 ✅
- `MySendOption` → 细化为 `AliSocketTask`（一个接口涵盖整个 task 契约，含 `isBuffer`），比 spec 的独立 `MySendOption` 更内聚，已在 Task 1 注释说明 ✅
- 错误处理（建连抛错转 error，无需 cleanup）→ Task 1 `doOpen` try/catch + 测试 ✅
- 测试改 fake task、移除全局反注册用例 → Task 1 Step 1 ✅
- 文档同步（CLAUDE.md + README）→ Task 2 ✅
- 不真机验证、注释标注 → Task 1 注释 + Task 2 CLAUDE.md 文案 ✅
- 兼容性/最低基础库 → 以 commit 的 `BREAKING CHANGE` 记录；README 未写死版本号（无法确认确切版本，避免不准确）——可接受的范围收敛。
- 可选 e2e → 本计划不含（spec 标为可选增强，YAGNI）。

**2. Placeholder scan：** 无 TBD/TODO；每个代码 step 含完整可编译代码;每个命令 step 含确切命令与预期。

**3. Type consistency：** `AliSocketTask` 在 Task 1 定义并被 `task` 字段、`doOpen`、`write` 一致使用;`send({data, isBuffer})` 的形状与测试断言 `toHaveBeenCalledWith({data, isBuffer})` 一致;`onMessage` 回调的 `{data, isBuffer}` 与测试 `h.message({data, isBuffer})` 一致。
