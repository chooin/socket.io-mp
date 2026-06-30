# 设计:AlipayTransport 迁移到 SocketTask 模式

- 日期:2026-06-30
- 范围:仅 `src/transports/alipay.ts` 及其测试(方案 A,不动微信)
- 状态:已通过 brainstorming,待写实施计划

## 背景与动机

支付宝小程序的**全局 socket API** 已被官方标记 `@deprecated`,推荐改用 SocketTask 模式:

| 当前使用(已废弃) | SocketTask 替代 |
| --- | --- |
| `my.connectSocket({url})`(无 `multiple`) | `my.connectSocket({url, multiple: true})` → 返回 `SocketTask` |
| `my.onSocketOpen/Message/Close/Error` | `task.onOpen/onMessage/onClose/onError` |
| `my.offSocket*` | `task.offOpen/offMessage/offClose/offError` |
| `my.sendSocketMessage` | `task.send` |
| `my.closeSocket` | `task.close` |

当前 `AlipayTransport` 基于这套**全局单例事件模型**,带来三个问题:

1. **handler 泄漏**(已在 `cb335e6` 修复,但属治标):被动关闭时上游 `_onClose` 会跳过 `doClose()`,导致全局 handler 不反注册。根因是全局事件模型本身。
2. **单连接限制**:多个 Manager 连不同服务端会互相干扰(`CLAUDE.md` 已记录)。
3. **依赖废弃 API**:未来支付宝移除全局 API 会直接破坏本库。

`SocketTask`(`my.connectSocket({multiple:true})` 返回)是 **per-connection** 模型,与微信的 `SocketTask` 同构,迁移后可一并根治上述三点。

## 目标 / 非目标

**目标**
- `AlipayTransport` 从全局事件 API 迁移到 `SocketTask`。
- 根除全局 handler 泄漏(不再有全局 handler)。
- 解除单连接限制(`multiple: true` 支持多连接)。
- 停用全部废弃 API。
- 对外行为(socket.io v4 协议、二进制语义)保持不变。

**非目标**
- 不改动 `WechatTransport`(方案 A)。
- 不提取跨端共享基类、不引入抖音支持(YAGNI,将来再议)。
- 不做"检测 + 回退老版本"(已选纯迁移)。
- 本次不做真机验证(二进制按与现有全局 API 等价的语义实现,代码与 README 标注"待真机验证")。

## 架构设计

骨架与 `WechatTransport` 同构,差异仅在二进制的 base64 处理。handler 从全局改为绑定在 `task` 上:

```ts
export class AlipayTransport extends Transport {
  private task?: SocketTask

  get name(): 'websocket' { return 'websocket' }

  protected doOpen(): void {
    try {
      const query = this.query as Record<string, string>
      this.task = my.connectSocket({
        url: buildUri(this.opts as any, query),
        multiple: true,                          // 启用 SocketTask 模式
        header: (this.opts as any).extraHeaders, // 可选
      })
      this.task.onOpen(() => this.onOpen())
      this.task.onMessage((res) => {
        const data = res.isBuffer
          ? my.base64ToArrayBuffer(res.data as string)
          : (res.data as string)
        this.onData(data)
      })
      this.task.onClose(() => this.onClose())
      this.task.onError((res) =>
        this.onError('websocket error', new Error(res?.errorMessage ?? 'websocket error')))
    } catch (err) {
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
      encodePacket(packet, true, (data) => {       // 恒 true:小程序无 Blob/FileReader
        if (typeof data === 'string') {
          this.task?.send({ data, isBuffer: false } as MySendOption)
        } else {
          const ab = ArrayBuffer.isView(data)
            ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
            : data
          this.task?.send({ data: my.arrayBufferToBase64(ab), isBuffer: true } as MySendOption)
        }
        if (--remaining === 0) {
          setTimeout(() => { this.writable = true; this.emitReserved('drain') }, 0)
        }
      })
    }
  }
}
```

不再有 `onAliOpen/onAliClose/...` 箭头字段与 `cleanup()`——SocketTask 模式下 handler 随 `task` 实例 GC 释放,无需手动反注册。

## 二进制处理

保留与现状**完全相同**的 base64 + `isBuffer` 语义,只是改调 `task.send` / `task.onMessage`:

- **发送**:字符串 → `send({data, isBuffer:false})`;二进制 → 先 `ArrayBuffer.isView` + `slice` 取精确字节(保留 TypedArray 处理),再 `my.arrayBufferToBase64` → `send({data:base64, isBuffer:true})`。
- **接收**:`onMessage` 的 `res.isBuffer` 为真时 `my.base64ToArrayBuffer` 还原,否则当字符串。
- **类型缺口**:`@mini-types/my` 的 `SocketTask.send` 只标 `data: string`、未标 `isBuffer`(接收端 `IOnSocketTaskMessageData` 却有 `isBuffer`)。判定为类型漏标,用局部类型 `MySendOption`(扩展官方签名加上可选 `isBuffer`)承接,避免散落 `as any`。
- **待验证**:`send` 的 `isBuffer` 字段为真机生效路径,本次不做真机验证;在代码注释与 README 注明"二进制发送依赖 SocketTask.send 的 isBuffer,需真机验证"。

`encodePacket` 第二参仍恒为 `true`(理由不变:`supportsBinary=false` 会触发 engine.io-parser 的 `new Blob()`+FileReader,小程序无此 API)。

## 错误处理

`doOpen` 用 `try/catch` 把建连异常转成 `onError`(沿用 `cb335e6` 中 Bug 3 的精神)。SocketTask 模式下 catch 内**不需要** `cleanup()`(没有已注册的全局 handler),比全局模式更简单。

## 净效果

| 项 | 迁移后 |
| --- | --- |
| 全局 handler 泄漏(Bug 1) | **根除**(无全局 handler);移除 `cleanup()` 及其专项测试 |
| 单连接限制 | **解除**(`multiple: true`) |
| 废弃 API | **不再使用** |
| 建连错误处理(Bug 3) | **保留**,适配为 SocketTask 形式 |
| 二进制 base64/isBuffer、TypedArray slice、deferred drain | **保留** |

## 测试计划

`tests/alipay-transport.test.ts` 从"fake 全局 `my.onSocket*`"改写为"fake `my.connectSocket` 返回 fake `task`"——与 `tests/wechat-transport.test.ts` 同款 fake 模式:

- **移除**:`被动关闭…反注册全局 handler` 测试(SocketTask 模式无此概念)。
- **替换**:新增 `doClose 关闭 task`、`name`、`open/message/close 事件`、`drain`。
- **适配保留**:`建连抛错转 error 事件`(connectSocket 抛错)、`二进制 send(isBuffer:true)`、`二进制 receive(base64ToArrayBuffer)`、`TypedArray 转换`、`write([]) 不卡死`。
- **断言不回退到废弃 API**:测试或 lint 层面确认不再调用 `my.onSocket*/offSocket*/sendSocketMessage/closeSocket` 与无 `multiple` 的 `connectSocket`。
- **可选增强**:为支付宝补一个 e2e(用 fake task 接真实 `ws`,对齐微信 e2e)。

## 兼容性

`multiple`/SocketTask 需较新基础库。采用纯迁移,不兼容过老版本。实施时确认 `multiple` 的最低基础库版本号,并在 README 注明最低要求。

## 风险

1. **二进制 isBuffer 发送未真机验证**(主要风险)——以代码注释 + README 标注;将来真机回归。
2. **基础库版本门槛**——过老版本支付宝客户端不可用;README 说明。

## 验收标准

- `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
- `alipay.ts` 不再出现 `my.onSocket*` / `my.offSocket*` / `my.sendSocketMessage` / `my.closeSocket` / 无 `multiple` 的 `connectSocket`。
- 支付宝测试覆盖:连接、文本收发、二进制收发、关闭、建连错误。
- `CLAUDE.md` 中"支付宝单连接 / 全局事件模型"相关描述同步更新(随实施)。
