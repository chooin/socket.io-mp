# @chooin/socket.io-mp

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Types](https://img.shields.io/badge/types-included-blue.svg)
![socket.io](https://img.shields.io/badge/socket.io-v4-black.svg)
![微信小程序](https://img.shields.io/badge/微信小程序-%E2%9C%93-07C160.svg)
![支付宝小程序](https://img.shields.io/badge/支付宝小程序-%E2%9C%93-1677FF.svg)

微信 / 支付宝小程序的 socket.io 客户端：直接复用官方 `socket.io-client`，仅把底层 WebSocket transport 换成小程序原生实现，**API 与官方完全一致**，严格对齐 socket.io v4。

## 目录

- [特性](#特性)
- [安装](#安装)
- [快速开始](#快速开始)
- [用法](#用法)
  - [监听与发送事件](#监听与发送事件)
  - [ACK 回执](#ack-回执)
  - [命名空间 namespace](#命名空间-namespace)
  - [二进制数据](#二进制数据)
  - [鉴权](#鉴权)
  - [重连与连接控制](#重连与连接控制)
- [与官方的差异](#与官方的差异)
- [平台支持](#平台支持)
- [API](#api)
- [高级：注入自定义 transport](#高级注入自定义-transport)
- [开发](#开发)
- [发布](#发布)
- [待验证（手动）](#待验证手动)
- [License](#license)

## 特性

- **双端**：微信 / 支付宝，运行时自动探测 `wx` / `my`，无需手动区分
- **协议 100% 对齐 v4**：基于官方 `socket.io-client`，namespace / ACK / 重连 / 二进制 / 多路复用全部原生支持
- **零协议重写**：只替换 transport 层，行为与官方一致，升级 socket.io 即可获得新能力
- **自带类型**：TypeScript 编写，产物 ESM + CJS + `.d.ts`
- **可扩展**：支持注入自定义 transport（Taro / uni-app 等）

## 安装

`@chooin` 作用域发布在 GitHub Packages，需要先在项目根 `.npmrc` 指向对应 registry：

```ini
# .npmrc
@chooin:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
pnpm add @chooin/socket.io-mp
```

> `socket.io-client` 是本包的运行时依赖（`dependencies`），会随本包自动安装，无需单独安装。仅当你想在代码里直接 import 它（例如引用 `Socket` 类型）或自行锁定版本时，再显式 `pnpm add socket.io-client`。

## 快速开始

```ts
import { io } from '@chooin/socket.io-mp'

const socket = io('wss://example.com', { auth: { token: 'xxx' } })

socket.on('connect', () => console.log('connected', socket.id))
socket.on('news', (data) => console.log(data))
socket.emit('msg', { a: 1 }, (ack) => console.log('ack:', ack))
```

`io()` 会自动探测当前小程序平台、注入对应 transport，并强制只走 websocket，其余一切与官方 `socket.io-client` 相同。

## 用法

下面只列出常用片段；完整 API 直接参考 [socket.io 官方文档](https://socket.io/docs/v4/client-api/)，本包与之一致。

### 监听与发送事件

```ts
socket.on('connect', () => {})
socket.on('disconnect', (reason) => {})
socket.on('chat', (msg) => console.log(msg))

socket.emit('chat', { text: 'hi' })
socket.off('chat') // 取消监听
```

### ACK 回执

服务端在收到事件后可以回传一个 ACK：

```ts
// 普通 ACK
socket.emit('order', { id: 1 }, (resp) => {
  console.log('服务端回执:', resp)
})

// 带超时的 ACK（v4）：5s 内没回执则 err 非空
socket.timeout(5000).emit('order', { id: 1 }, (err, resp) => {
  if (err) console.warn('ACK 超时')
  else console.log(resp)
})
```

### 命名空间 namespace

在 uri 后面加路径即可连接到对应 namespace：

```ts
const admin = io('wss://example.com/admin', { auth: { token } })
admin.on('welcome', (msg) => console.log(msg))
```

### 二进制数据

直接 `emit` / 接收 `ArrayBuffer`（或 `TypedArray`）。微信走原生 ArrayBuffer，支付宝内部用 base64 编解码，**对调用方透明**：

```ts
const bytes = new Uint8Array([1, 2, 3, 4])
socket.emit('upload', bytes.buffer, (ack) => console.log(ack))

socket.on('chunk', (buf: ArrayBuffer) => {
  console.log(new Uint8Array(buf))
})
```

### 鉴权

小程序对自定义请求头支持有限，**请用 `auth`（CONNECT 包）或 query，而不是自定义 header**：

```ts
// 推荐：auth 随 CONNECT 包发送，可在服务端 io.use 中读取
io('wss://example.com', { auth: { token: 'xxx' } })

// 或放进 query
io('wss://example.com', { query: { uid: '42' } })
```

### 重连与连接控制

重连相关选项与官方一致，直接透传：

```ts
const socket = io('wss://example.com', {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
})

socket.io.on('reconnect_attempt', (n) => console.log('第', n, '次重连'))

socket.disconnect() // 主动断开
socket.connect()    // 重新连接
```

## 与官方的差异

| 项目 | 说明 |
| --- | --- |
| 仅 websocket | 小程序无 HTTP polling；transport 固定为 websocket（无需也不能配置 polling 回退） |
| 鉴权方式 | 用 `auth`（CONNECT 包）或 query，而非自定义 header |
| 合法域名 | 需在小程序后台配置 socket 合法域名（`wss://…`） |
| 支付宝单连接 | 支付宝是全局事件式 API，同一时刻仅一条连接；同时连接多个不同服务端的 Manager 会互相干扰 |

其余 API（namespace / ACK / 重连 / 二进制 / 多路复用 / timeout 等）与官方完全一致。

## 平台支持

| 平台 | 连接 API | 并发 | 二进制 |
| --- | --- | --- | --- |
| 微信小程序 | `wx.connectSocket`（返回 SocketTask） | 多连接 | 原生 ArrayBuffer |
| 支付宝小程序 | `my.connectSocket`（全局事件式） | **单连接** | base64 编解码（对调用方透明） |

## API

### `io(uri, opts?) => Socket`

在小程序里创建一个 socket.io 连接。

- **`uri`** `string` — 服务端地址，可带 namespace，如 `wss://example.com` 或 `wss://example.com/admin`
- **`opts`** `MpOptions` —（可选）等价于官方 `Partial<ManagerOptions & SocketOptions>`，外加：
  - **`transports?`** `TransportCtor[]` — 覆盖自动探测，显式注入自定义 transport（见下文）
- **返回** 官方 `Socket` 实例

### 导出

```ts
// io 同时是默认导出和具名导出，二选一即可
import { io } from '@chooin/socket.io-mp'
// import io from '@chooin/socket.io-mp'

import {
  Manager, Socket,           // 透传官方类
  WeixinTransport,           // 微信 transport（一般无需直接用）
  AlipayTransport,           // 支付宝 transport
} from '@chooin/socket.io-mp'

import type {
  MpOptions, TransportCtor,
  ManagerOptions, SocketOptions,
} from '@chooin/socket.io-mp'
```

## 高级：注入自定义 transport

运行在 Taro / uni-app 等框架时，可显式传入自定义 Transport 类以跳过自动探测：

```ts
import { io } from '@chooin/socket.io-mp'
import { MyTaroTransport } from './my-taro-transport'

io('wss://example.com', { transports: [MyTaroTransport] })
```

自定义 Transport 需继承 `engine.io-client` 的 `Transport`，实现：

- `get name()` — 返回 `'websocket'`
- `doOpen` / `doClose` / `write`
- 在底层连接的事件回调里调用基类 `onOpen` / `onData` / `onClose` / `onError`

可直接参考 `src/transports/weixin.ts`、`src/transports/alipay.ts`。

## 开发

包管理器为 **pnpm@10**（不要用 npm / yarn）。

```bash
pnpm install

pnpm test                 # 跑全部测试
pnpm test detect          # 跑单个测试文件
pnpm run test:coverage    # 覆盖率
pnpm typecheck            # 类型检查
pnpm build                # 构建产物到 dist/
```

测试基于 vitest：单元测试用伪造的 `wx` / `my` 全局驱动 transport，`tests/e2e.test.ts` 则用真实 `ws` 连接一个真实的进程内 socket.io 服务端，跑通 connect / ACK / 二进制 / namespace 全链路。

## 发布

发布到 **GitHub Packages**，由打 tag 触发 `.github/workflows/release.yml`（push 到 `master` / PR 则触发 `ci.yml` 跑 typecheck / test / build）。

1. **一次性配置**：仓库 Settings → Secrets and variables → Actions 新增 secret `NPM_TOKEN`，值为带 `write:packages` 权限的 GitHub Token。
2. 升级 `package.json` 的 `version`（workflow 发布的是 `version` 字段而非 tag 名，二者需保持一致）。
3. 打 tag 并推送，release workflow 会自动 test / build 并 `pnpm publish`：

```bash
npm version patch        # 改 version + 自动 commit + 打 vX.Y.Z tag
git push --follow-tags   # 推送代码与 tag，触发发布
```

> 本地手动 `pnpm publish` 也可以，但需先 `export NODE_AUTH_TOKEN=<你的 token>`（`.npmrc` 引用了它）。

## 待验证（手动）

- [ ] 在微信开发者工具 / 真机里验证 `socket.io-client` 可干净导入并连通一次（CI/Node 环境无法自动化验证此项，需真实小程序环境）

## License

[MIT](./LICENSE)
