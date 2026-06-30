# 设计:抖音(字节跳动)小程序 transport 支持

- 日期:2026-06-30
- 状态:已确认,待实现
- 范围:为 `socket.io-mp` 新增一个抖音小程序(`tt` 全局)的 mini-program WebSocket transport

## 背景与目标

`socket.io-mp` 是一个**适配器**:它只替换 engine.io 最底层的 WebSocket `Transport`,让官方
`socket.io-client` 能在小程序里跑;协议能力(命名空间、ACK、重连、二进制、多路复用、超时)全部来自上游。
当前已支持微信(`wx`)与支付宝(`my`),本设计新增抖音(`tt`)。

`tt` 是**整个字节跳动小程序平台**共用的全局对象(抖音、今日头条、西瓜视频、抖音极速版等),因此支持
`tt` 即一次性覆盖所有字节系宿主。

## 关键事实(已据官方文档核实)

抖音走的是**微信模型**,不是支付宝模型:

- `tt.connectSocket({ url, header, protocols, ... })` **同步返回一个 `SocketTask` 实例**,带
  `onOpen`/`onMessage`/`onClose`/`onError`/`send`/`close` 实例方法——与微信 `wx.connectSocket` 同构,
  而非支付宝 `my.onSocket*` 的全局单例事件模型。
- 二进制是**原生 `ArrayBuffer` 端到端**:`SocketTask.onMessage` 回调的 `data` 类型为
  `string | ArrayBuffer`;`send` 也直接接受 `string | ArrayBuffer`。**无需**支付宝那套 base64 来回转换,
  **也无需**支付宝那个 TypedArray→ArrayBuffer 的 `slice` 修正(那是 base64 编码前才需要的)。
- 线上仅支持 `wss://`,最多 5 条并发连接,`header` 不支持 `referer`——均与项目既有约束相容。

结论:**抖音 transport ≈ 微信 transport,差别只有全局对象名(`tt` vs `wx`)。**

来源:
- https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/api/network/web-socket/tt-connect-socket
- https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/api/network/web-socket/socket-task/socket-task-on-message

## 架构决策

1. **独立文件**(已与维护者确认):新建 `src/transports/douyin.ts`,镜像 `wechat.ts`,不抽共享基类。
   理由:贴合现有"每平台一个文件"的约定(wechat/alipay 即便共享 `buildUri`/drain 也是分开的);显式、隔离、
   利于小程序 devtools 调试;约 40 行的与微信相似代码是可接受代价,且现有 `wechat.ts` 完全不动。
2. **本地 ambient 类型,不引依赖**:抖音生态无同等权威/可靠的官方 typings 包。仅声明用到的那一小撮 `tt` API
   到 `src/transports/tt.d.ts`(在 `tsconfig.include` 的 `src` 内会被自动纳入;`tt` 与 `wx`/`my` 无命名冲突)。
3. **命名 `DouyinTransport`**:对应 `douyin.ts`,最直观;doc 注释注明其覆盖整个字节系。
4. **检测顺序 `wx → my → tt`**:`tt` 追加在末尾,现有 `wx>my` 优先级与相关测试不受影响;运行时各平台全局互斥,
   顺序不影响正确性。

## 实现

### `src/transports/tt.d.ts`(新增)

最小 ambient 声明,覆盖本 transport 用到的 `tt` 子集:

- `declare const tt`,其 `connectSocket(opts): SocketTask` 同步返回 `SocketTask`。
- `SocketTask`:`onOpen(cb)`、`onMessage(cb: (res: { data: string | ArrayBuffer }) => void)`、
  `onClose(cb)`、`onError(cb: (res: { errMsg: string }) => void)`、`send({ data })`、`close({ code?, reason? })`。
- `connectSocket` opts:`{ url: string; header?: Record<string, string>; protocols?: string[] }`。

### `src/transports/douyin.ts`(新增)

`export class DouyinTransport extends Transport`,逐项镜像 `WechatTransport`:

- `get name(): 'websocket'` 恒返回 `'websocket'`。
- `doOpen()`:`this.task = tt.connectSocket({ url: buildUri(opts, query), header: opts.extraHeaders })`,
  再挂 `onOpen → this.onOpen()`、`onMessage → this.onData(res.data)`、`onClose → this.onClose()`、
  `onError → this.onError('websocket error', new Error(res.errMsg))`。
- `doClose()`:`this.task?.close({})`;`this.task = undefined`。
- `write(packets)`:与微信逐字一致——`writable=false`,逐包 `encodePacket(packet, true, cb)`,`cb` 里
  `this.task?.send({ data })`;**最后一包后用 `setTimeout(…, 0)` 再置 `writable=true` 并 `emitReserved('drain')`**
  (延迟 drain 防止 engine.io flush→write→drain→flush 同步重入爆栈);`packets.length === 0` 直接 return。

> 二进制无需任何特殊处理:`ArrayBuffer` 原生透传,和微信一致。

### `src/transports/detect.ts`(改)

在 `my` 分支后追加:

```
if (typeof tt !== 'undefined' && typeof tt.connectSocket === 'function') {
  return DouyinTransport as unknown as TransportCtor
}
```

报错文案更新为提示 `wx/my/tt`。

### `src/index.ts`(改)

新增 `export { DouyinTransport } from './transports/douyin'`。

## 测试

### `tests/douyin-transport.test.ts`(新增)

镜像 `wechat-transport.test.ts`:`installFakeTt()` 在 `globalThis.tt` 装一个假
`connectSocket`(返回把回调存进 `h` 映射的假 `SocketTask`),逐项断言:

- `name` 为 `'websocket'`;
- `doOpen` 连接 URL 含 `EIO=4` 与 `transport=websocket`;
- `h.open()` 触发 `'open'`;
- `h.message({ data: '4hello' })` 解出 `{ type: 'message', data: 'hello' }`;
- `write([{type:'message',data:'hi'}])` 调 `task.send({ data: '4hi' })`,drain 经 fake timers 延迟后才触发,`writable` 复位;
- `write([])` 不把 transport 卡在不可写;
- 二进制包 `send` 出去的是 `ArrayBuffer`;
- `h.close()` 触发 `'close'`。

### `tests/detect.test.ts`(改)

新增:仅 `tt` 存在时返回 `DouyinTransport`;并保持现有 `wx>my` 优先级断言不破。

### `tests/e2e.test.ts`(改)

把现有 ws 驱动的"假 `connectSocket`"工厂抽成可复用 helper(微信与抖音共用),新增一条 `tt` 路径的端到端
断言——至少**连接**与**二进制 round-trip**——经由真实 in-process `socket.io` Server 跑通上游全栈,证明
`tt` 接线真实可用。新增 e2e 用例在 `finally` 中 `disconnect()`。

## 文档与元数据

- `CLAUDE.md`:更新"What this package is"、平台不对称表(补抖音=微信模型一列/注)、`detect.ts` 说明、Testing 的
  faked globals(加 `tt`)。
- `README.md`:用法/平台支持处补抖音。
- `package.json`:`keywords` 增加 `douyin`、`bytedance`、`tt`(`toutiao` 视情况)。

## 验收标准

- `pnpm typecheck`、`pnpm test`、`pnpm build` 全绿(`prepublishOnly` 门槛)。
- 新增单测覆盖 `DouyinTransport` 的 handler 接线与编解码;detect 覆盖 `tt` 分支;e2e 覆盖 `tt` 的连接 + 二进制。
- 现有微信/支付宝测试与行为零回归(`wechat.ts` 不改动)。

## 非目标(YAGNI)

- 不抽共享基类、不重构现有微信/支付宝 transport。
- 不引入第三方抖音 typings 依赖。
- 不为抖音单独处理二进制(原生 `ArrayBuffer` 已足够)。
- 不实现 HTTP 轮询(小程序仅 `wss`)。
