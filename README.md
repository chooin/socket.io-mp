# @chooin/socket.io-mp

微信 / 支付宝小程序的 socket.io 客户端：直接复用官方 `socket.io-client`，仅替换为小程序原生 WebSocket transport，API 与官方完全一致，严格对齐 socket.io v4。

## 特性

- 微信 / 支付宝双端，运行时自动探测 `wx` / `my`
- 基于官方 `socket.io-client`，协议 100% 对齐 v4（namespace / ACK / 重连 / 二进制 / 多路复用）
- TypeScript 编写，自带类型；产物 ESM + CJS
- 可注入自定义 transport（Taro / uni-app 等）

## 安装

```ini
# 项目根 .npmrc：@chooin 作用域指向 GitHub Packages
@chooin:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
pnpm add @chooin/socket.io-mp socket.io-client
```

> `socket.io-client` 为 peer/runtime 依赖，需显式安装。

## 快速开始

```ts
import { io } from '@chooin/socket.io-mp'

const socket = io('wss://example.com', { auth: { token: 'xxx' } })

socket.on('connect', () => console.log('connected', socket.id))
socket.on('news', (data) => console.log(data))
socket.emit('msg', { a: 1 }, (ack) => console.log(ack)) // ACK
```

## 与官方的差异

| 项目 | 说明 |
| --- | --- |
| 仅 websocket | 小程序无 HTTP polling；transport 固定为 websocket |
| 鉴权方式 | 小程序对请求头支持有限，请用 `auth`（CONNECT 包）或 query，而非自定义 header |
| 合法域名 | 需在小程序后台配置 socket 合法域名（wss://…） |
| 支付宝单连接 | 支付宝全局事件式 API，同一时刻仅一条连接；同时连接多个不同服务端的 Manager 会互相干扰 |

其余 API（namespace / ACK / 重连 / 二进制 / 多路复用 / timeout 等）与官方完全一致。

## 平台支持

| 平台 | 连接 API | 二进制 |
| --- | --- | --- |
| 微信小程序 | `wx.connectSocket`（多连接） | 原生 ArrayBuffer |
| 支付宝小程序 | `my.connectSocket`（全局事件式，单连接） | base64 编解码（用户侧透明） |

## 高级：注入自定义 transport

当运行在 Taro / uni-app 等框架时，可显式传入自定义 Transport 类以跳过自动探测：

```ts
import { io } from '@chooin/socket.io-mp'
import { MyTaroTransport } from './my-taro-transport'

io('wss://example.com', { transports: [MyTaroTransport] })
```

自定义 Transport 需继承 `engine.io-client` 的 `Transport`，实现 `get name()`（返回 `'websocket'`）、`doOpen`、`doClose`、`write`，并调用基类 `onOpen / onData / onClose / onError`。

## 待验证（手动）

- [ ] 在微信开发者工具 / 真机里验证 `socket.io-client` 可干净导入并连通一次（CI/Node 环境无法自动化验证此项，需真实小程序环境）

## License

MIT
