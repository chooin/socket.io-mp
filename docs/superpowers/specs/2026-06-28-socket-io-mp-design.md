# @chooin/socket.io-mp · 设计文档

- 日期：2026-06-28
- 作者：chooin（设计协作：Claude）
- 状态：待用户最终审阅

---

## 1. 目标与范围

为微信 / 支付宝小程序提供一个**严格对齐 socket.io v4** 的客户端。

定位：**官方 `socket.io-client` 的小程序适配层，而不是重写**。协议的全部能力（握手、心跳、namespace、auth、ACK、二进制、重连、多路复用）由官方 client 负责；本包只解决官方 client 在小程序里跑不起来的**唯一原因——transport 层**：官方默认 transport 用浏览器 `WebSocket`/`XHR` 或 Node `ws`，而小程序只有 `wx.connectSocket` / `my.connectSocket`。

因此本包 = 官方 `socket.io-client` + 一个继承 `engine.io-client` `Transport` 的微信/支付宝适配器 + 自动接线的 `io()` 包装。

参考心智模型：官方 `io(uri, opts)` → 返回 `Socket`；用户 API 与官方完全一致，唯一区别是连接走小程序原生 WebSocket。

### 1.1 不在范围内（YAGNI）

- 重写 Engine.IO / Socket.IO 协议、parser、`Manager`、`Socket`（直接用官方）
- 一致性测试（既然用官方 parser，没有"我们编码对不对"的命题）
- polling transport 与 transport upgrade（小程序只能 websocket）
- connection-state-recovery（v4.6+ 的 `pid`/`offset`）
- `volatile` / `compress` 语义
- 服务端
- Taro / uni-app 专用 transport（但保留**可注入** transport 的扩展点，这类场景自行注入）
- UMD 产物（有 external 运行时依赖，UMD 需 globals 映射，且小程序不用 UMD）

引入门槛是"出现真实需要"，不是"将来可能用得上"。

---

## 2. 关键决策摘要

| 维度 | 决定 | 理由 |
|---|---|---|
| 实现策略 | 复用 `socket.io-client` + 自定义 transport | 协议合规"免费"，维护成本几乎归零 |
| 协议版本 | socket.io v4（EIO4 / SIO5） | 当前主流；官方 client 默认即 v4 |
| transport | 仅 websocket；运行时探测 `wx`/`my`；支持注入覆盖 | 小程序无 polling；注入点兼顾测试与 Taro |
| 功能范围 | 完整忠实客户端 | 全部由官方提供，对齐"严格按规范" |
| `socket.io-client` 依赖 | regular dependency（构建时 external） | 用户只装本包即可，我们管版本 |
| 直接依赖三件套 | `socket.io-client` + `engine.io-client` + `engine.io-parser` | 我们直接 `import` 后两者，pnpm 严格 node_modules 要求显式声明 |
| 平台适配 | 微信 + 支付宝；task 式优先，全局事件式降级 | 兼容支付宝老版本单连接模型 |
| 构建产物 | ESM(`.mjs`) + CJS(`.cjs`)，无 UMD | 对齐 `taro4-hooks`；external 依赖下 UMD 不友好 |
| 编译 target | ES2018 + `useDefineForClassFields:false` | 对齐 `mini-program-logger`；transport 是类，需正确的 class field 语义 |
| 测试栈 | vitest（node 环境）+ 真实 `socket.io` 服务端 | 单元 + 端到端双层验证 transport |
| 包管理器 | pnpm@10 | `@chooin` 系列既有 |
| 小程序类型 | `miniprogram-api-typings` + `@mini-types/alipay` | 代码直接用 `wx`/`my` 全局 |
| 起步版本 | 0.1.0 | 0.x 留迭代空间 |
| 源码目录 | `src/` | 对齐 `taro4-hooks` |
| 发布 | GitHub Packages（`@chooin` scope） | `@chooin` 系列既有 |

---

## 3. 项目结构

```
@chooin/socket.io-mp/
├── src/
│   ├── index.ts                 # io() 包装 + re-export（公共入口）
│   ├── transports/
│   │   ├── base.ts              # 共享：uri() 构造、query 序列化、二进制发送适配
│   │   ├── weixin.ts            # class WeixinTransport extends Transport
│   │   ├── alipay.ts            # class AlipayTransport extends Transport（task + 全局降级）
│   │   └── detect.ts            # 运行时探测 wx/my → 选 transport 类
│   └── types.ts                 # MpOptions 等类型 + 官方类型 re-export
├── tests/
│   ├── setup.ts                 # 注入/清理 fake wx、my 全局
│   ├── detect.test.ts           # 平台探测分支
│   ├── weixin-transport.test.ts # 单元：doOpen/onData/write/二进制/doClose
│   ├── alipay-transport.test.ts # 单元：task 式 + 全局降级两条路径
│   └── e2e.test.ts              # 真·E2E：真实 socket.io server + wx mock over ws
├── dist/                        # 构建产物（gitignore）
├── docs/superpowers/            # specs / plans
├── package.json
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
├── typings.d.ts                 # 补充 my 全局（若 @mini-types 不够用时）
├── .nvmrc / .npmrc / .editorconfig / .gitignore
├── AGENTS.md
├── README.md
└── LICENSE
```

**设计原则：**
- **每个平台一个 transport 文件**：新增端（如未来 QQ/抖音小程序）零结构调整，仿照 `weixin.ts` 加一个文件 + 在 `detect.ts` 加一个分支。
- **`base.ts` 收敛公共逻辑**：`uri()` 构造、query 序列化、`encodePacket` 调用与二进制 send 适配，避免两个 transport 重复。
- **`tests/` 平铺**，发包 `files` 字段干净。

---

## 4. 架构与数据流

### 4.1 分层

```
        ┌─────────────── 用户代码 ───────────────┐
        │  import { io } from '@chooin/socket.io-mp'│
        └───────────────────┬──────────────────────┘
                            │  io(uri, opts)
        ┌───────────────────▼──────────────────────┐
本包     │ src/index.ts：探测平台 → transports:[T] →  │
        │              转交官方 io()                 │
        └───────────────────┬──────────────────────┘
                            │  baseIo(uri, {...opts, transports})
        ┌───────────────────▼──────────────────────┐
官方     │ socket.io-client：Manager / Socket         │ ← namespace/auth/ACK/重连/多路复用
        │ engine.io-client：Engine（握手/反向心跳）   │ ← 用我们注入的 transport
        └───────────────────┬──────────────────────┘
                            │  doOpen / write / doClose
        ┌───────────────────▼──────────────────────┐
本包     │ WeixinTransport / AlipayTransport          │ ← 仅桥接 open/收/发/关
        └───────────────────┬──────────────────────┘
                            │  wx.connectSocket / my.connectSocket
                      ┌──────▼──────┐
                      │  小程序运行时 │
                      └─────────────┘
```

我们只写最底下那一层；中间两层全是官方代码。

### 4.2 transport 的契约（来自 `engine.io-client` 的 `Transport` 基类）

子类**必须实现**：

| 成员 | 作用 |
|---|---|
| `get name(): string` | 返回 `'websocket'`，使 Engine 以 websocket 协议握手（`transport=websocket`） |
| `doOpen()` | 建立底层连接，并把"开/收/关/错"接到下面的生命周期回调 |
| `doClose()` | 关闭底层连接 |
| `write(packets: Packet[])` | 编码并发送一批 Engine.IO 包，发完置 `writable=true` 并 `emit('drain')` |

子类**调用以向上汇报**：`onOpen()`、`onData(data)`、`onClose(details?)`、`onError(reason, desc?)`。基类 `onData` 内部会用官方 `engine.io-parser` 解码——**解码不需要我们操心**。

### 4.3 数据流

- **发**：`socket.emit(...)` → 官方 Manager/Engine 组包 → 调我们的 `write(packets)` → 每个包 `encodePacket(p, true, cb)` → `task.send({ data })`。
- **收**：`task.onMessage({data})` → 我们调 `this.onData(data)` → 基类 `decodePacket` → 官方 Engine/Manager 路由到对应 `Socket` → 触发用户事件 / 兑现 ACK。
- **心跳/重连/握手**：全部在官方层完成，我们无感。

---

## 5. 核心实现

> 以下为设计意图的代码骨架，最终以实现为准；`uri()` 复刻官方 websocket transport 的构造逻辑。

### 5.1 `src/index.ts`（公共入口）

```ts
import { io as baseIo, Manager, Socket } from 'socket.io-client'
import { detectTransport } from './transports/detect'
import type { MpOptions } from './types'

export function io(uri: string, opts: MpOptions = {}): Socket {
  // 未显式注入则按运行时平台探测；强制只走 websocket（小程序无 polling）
  const transports = opts.transports ?? [detectTransport()]
  return baseIo(uri, { ...opts, transports } as never) // 类型见 5.5
}

export default io
export { Manager, Socket }
export { WeixinTransport } from './transports/weixin'
export { AlipayTransport } from './transports/alipay'
export type { MpOptions } from './types'
export type { ManagerOptions, SocketOptions } from 'socket.io-client'
```

### 5.2 `src/transports/detect.ts`

```ts
import type { TransportCtor } from '../types'
import { WeixinTransport } from './weixin'
import { AlipayTransport } from './alipay'

export function detectTransport(): TransportCtor {
  if (typeof wx !== 'undefined' && typeof wx.connectSocket === 'function') {
    return WeixinTransport
  }
  if (typeof my !== 'undefined' && typeof my.connectSocket === 'function') {
    return AlipayTransport
  }
  throw new Error(
    '[socket.io-mp] 未检测到 wx/my 的 WebSocket API；请用 io(uri, { transports: [自定义Transport] }) 显式注入',
  )
}
```

### 5.3 `src/transports/weixin.ts`

```ts
import { Transport } from 'engine.io-client'
import { encodePacket } from 'engine.io-parser'
import type { Packet, RawData } from 'engine.io-parser'
import { buildUri } from './base'

export class WeixinTransport extends Transport {
  private task?: WechatMiniprogram.SocketTask

  get name() {
    return 'websocket'
  }

  doOpen() {
    this.task = wx.connectSocket({
      url: buildUri(this),                 // wss://host:port/path?EIO=4&transport=websocket[&sid]
      header: this.opts.extraHeaders,      // 小程序对 header 支持有限，见风险表
    })
    this.task.onOpen(() => this.onOpen())
    this.task.onMessage((res) => this.onData(res.data as RawData)) // string | ArrayBuffer
    this.task.onClose(() => this.onClose())
    this.task.onError((err) => this.onError('websocket error', err))
  }

  doClose() {
    this.task?.close({})
    this.task = undefined
  }

  write(packets: Packet[]) {
    this.writable = false
    let remaining = packets.length
    packets.forEach((packet) => {
      encodePacket(packet, true /* supportsBinary */, (data) => {
        this.task!.send({ data: data as string | ArrayBuffer })
        if (--remaining === 0) {
          this.writable = true
          this.emit('drain')
        }
      })
    })
  }
}
```

### 5.4 `src/transports/alipay.ts`

实现要点（两条路径）：

1. **task 式（优先）**：`my.connectSocket({ url, multiple: true })` 返回 SocketTask，API 与微信同构，逻辑复用 `base.ts`。
2. **全局事件式（降级）**：老版本支付宝 `my.connectSocket({url})` 不返回 task，只能用全局 `my.onSocketOpen/onSocketMessage/onSocketClose/onSocketError` + `my.sendSocketMessage` + `my.closeSocket`，且**全局单连接**。`doOpen` 时注册全局回调，`doClose` 时反注册。
3. **二进制差异**：支付宝收发二进制需处理 `isBuffer` 标志（`sendSocketMessage({ data, isBuffer: true })`，`onMessage` 回 `{ data, isBuffer }`），在本文件内吸收差异，对上层透明。

构造时探测 `typeof my.connectSocket` 的返回值/能力来决定走哪条路径。

### 5.5 类型（`src/types.ts`）

```ts
import type { Transport } from 'engine.io-client'
import type { ManagerOptions, SocketOptions } from 'socket.io-client'

export type TransportCtor = new (opts: ConstructorParameters<typeof Transport>[0]) => Transport

export interface MpOptions extends Partial<ManagerOptions & SocketOptions> {
  /** 覆盖自动探测；不传则按 wx/my 运行时选择 */
  transports?: TransportCtor[]
}
```

官方 `transports` 字段类型在不同小版本间有出入（字符串数组 vs 含类）。`io()` 内对传入 `baseIo` 的对象做一次 `as never`/精确 cast 收口，对外仍是强类型 `MpOptions`。**锁定 `socket.io-client >= 4.8`**（自定义 transport 类是 4.8 起的官方能力）。

---

## 6. `package.json` 关键字段

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
  "dependencies": {
    "socket.io-client": "^4.8.0",
    "engine.io-client": "^6.6.0",
    "engine.io-parser": "^5.2.0"
  },
  "devDependencies": {
    // 版本在 pnpm install 时取最新稳定版，此处仅示意
    "@mini-types/alipay": "^3",
    "@types/ws": "^8",
    "miniprogram-api-typings": "^4",
    "socket.io": "^4",          // E2E 真实服务端
    "typescript": "~5.9",
    "vite": "^7",
    "vite-plugin-dts": "^4",
    "vitest": "^3",
    "ws": "^8"                  // E2E 在 Node 里驱动被 mock 的 wx
  },
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "pnpm run typecheck && pnpm run test && pnpm run build"
  }
}
```

**关键约束：**
- `exports` 中 `types` 必须在 `import`/`require` **之前**。
- `engine.io-client` / `engine.io-parser` 虽是 `socket.io-client` 的传递依赖，但因为我们**直接 import**，pnpm 严格模式下必须列入 `dependencies`；三者版本需与 `socket.io-client` 实际依赖对齐（见风险表）。
- 三个运行时依赖在构建时全部 `external`，由消费方（小程序 npm 构建）打包。
- `sideEffects: false` 开启 tree-shaking。

---

## 7. 工具链配置

### 7.1 `vite.config.ts`

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

### 7.2 `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['src/**/*.ts'] },
  },
})
```

### 7.3 `tsconfig.json`

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
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["miniprogram-api-typings", "@mini-types/alipay", "node"]
  },
  "include": ["src", "tests", "typings.d.ts"]
}
```

- `DOM` lib 提供 `WebSocket`/`ArrayBuffer` 类型（`ws` 适配与二进制处理需要）。
- `useDefineForClassFields:false`：transport 是 class，沿用 `@chooin` 既有语义，且 ES2018 下避免 `defineProperty` 化的字段。
- `types` 含 `node`（E2E/Vitest 用到 Node API）。

### 7.4 `tests/setup.ts`（思路）

```ts
import { afterEach, vi } from 'vitest'

// 提供可被各测试改写的 fake wx / my；afterEach 清理全局，避免串味
afterEach(() => {
  // @ts-expect-error 清理注入的全局
  delete globalThis.wx
  // @ts-expect-error
  delete globalThis.my
  vi.restoreAllMocks()
})
```

### 7.5 `.gitignore`

```
node_modules
dist
coverage
.DS_Store
*.log
```

---

## 8. 测试策略

验证深度：**单元 + 真·E2E**。重心是"我们的 transport 桥接是否正确"，协议正确性由官方保证。

### 8.1 测试金字塔

| 层 | 文件 | 重点 |
|---|---|---|
| 探测 | `detect.test.ts` | 有 wx → Weixin；有 my → Alipay；都没有 → 抛错；可注入覆盖 |
| 单元（多） | `weixin-transport.test.ts` | `doOpen` 建连并接线；`onMessage→onData`；`write` 编码+发送；二进制走 ArrayBuffer；`doClose` 清理 |
| 单元（多） | `alipay-transport.test.ts` | task 式与全局事件式两条路径；`isBuffer` 二进制差异 |
| 端到端（少而真） | `e2e.test.ts` | 真实 `socket.io` server，`wx.connectSocket` mock 成 `ws` 驱动的真实连接，跑完整链路 |

### 8.2 单元用例蓝图（Weixin 为例）

- `doOpen` 调用 `wx.connectSocket` 且 url 含 `EIO=4&transport=websocket`
- `onOpen`/`onClose`/`onError` 正确转调基类回调
- 收到字符串帧 → `onData` 收到字符串；收到 `ArrayBuffer` → `onData` 收到 buffer
- `write` 文本包：`encodePacket` 后 `task.send({data:string})`；发完 `writable=true` 且 `emit('drain')`
- `write` 二进制包：`task.send({data:ArrayBuffer})`
- `doClose` 调 `task.close` 并释放引用

### 8.3 E2E 用例蓝图

在 `beforeAll` 起一个真实 `socket.io` server（随机端口，注册若干事件/namespace），`afterAll` 关闭。把 `globalThis.wx.connectSocket` 实现为"内部用 `ws` 连到该 server 并桥接 onOpen/onMessage/onClose/onError/send/close 成 SocketTask 形状"。然后用本包的 `io()` 连接，断言：

- ★ 连接建立：触发 `connect`，拿到 server 端 `sid`
- 双向事件：client `emit` → server 收到；server `emit` → client `on` 收到
- ★ ACK：`emit(ev, data, cb)` 收到 server 回执；`timeout(ms).emit(...)` 超时分支
- 二进制：发/收 `ArrayBuffer` 往返一致
- namespace：连 `/admin` 正常收发，且与默认 namespace 复用同一连接
- 断开：`disconnect()` 后触发 `disconnect`，server 端感知离开
- ★ 重连：强制底层关闭后自动重连并恢复收发

（★ 为必须钉死的核心契约。）

### 8.4 覆盖率目标

| 范围 | 目标 |
|---|---|
| `src/transports/*` | 行/分支 ≥ 95% |
| 整包 | ≥ 90%（E2E 覆盖串联路径） |

---

## 9. 发布与版本流程

### 9.1 发布前自查

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm pack --dry-run   # 确认 tarball 仅含 dist/README/LICENSE/package.json
```

### 9.2 版本与发布（GitHub Packages）

```bash
pnpm version patch|minor   # 1.0 之前避免 major
pnpm publish               # 经 .npmrc 指向 npm.pkg.github.com，需 write:packages token
```

`prepublishOnly` 自动跑 `typecheck + test + build`，最后一道闸。

### 9.3 README 内容

1. 特性（双端、对齐 v4、TS、可注入 transport）
2. 安装（GitHub Packages `.npmrc` 配置 + `pnpm add`）
3. 快速开始（`io()` 用法，强调 API 与官方一致）
4. 与官方 `socket.io-client` 的关系与差异（仅 websocket、需配置小程序合法域名）
5. 平台支持表（微信 `wx.connectSocket` / 支付宝 `my.connectSocket`）
6. 高级：注入自定义 transport（Taro/uni-app）

---

## 10. 风险与开放点

| 风险 | 影响 | 缓解 |
|---|---|---|
| `socket.io-client` 与我们直接声明的 `engine.io-client`/`engine.io-parser` 版本不一致 | 类型/运行期错配 | `pnpm why` 校验单一版本；用 pnpm `overrides` 或对齐 caret 范围；E2E 会暴露不兼容 |
| `socket.io-client` 在小程序构建（微信"npm 构建"/Taro）下能否干净导入 | 默认 polling/ws transport 会被 import；若 eval 期访问缺失全局可能报错 | 实现后**在真机/开发者工具验证一次干净导入**；socket.io 本身按同构设计、访问多有守卫，理论可行；必要时用构建别名 stub |
| 小程序对 WebSocket `header` 支持有限（如 `Origin` 不可设） | `extraHeaders`/部分鉴权头失效 | 鉴权优先走 `auth`（CONNECT 包）或 query；README 说明限制 |
| 小程序需在后台配置 socket 合法域名（wss） | 未配置则连接被拦截 | README 显著提示；E2E 用本地 server 不受此限 |
| 支付宝二进制 `isBuffer` 行为跨版本差异 | 二进制收发异常 | 在 `alipay.ts` 内吸收；E2E（如条件允许）覆盖 |
| 直接继承官方 `Transport` 私有/受保护成员在小版本间变动 | 升级官方版本时可能 break | 锁 `^` 范围；只用文档化的 4 抽象 + 5 回调；CI 跑测试做回归 |

**已否决的替代方案**：polyfill `globalThis.WebSocket` 让官方内置 ws transport 接管——污染全局、`binaryType`/子协议处理脆弱、版本敏感，不如自定义 transport 显式可控。

---

## 11. 后续扩展（不在本期）

- 新增小程序端（QQ/抖音/百度）：加 `src/transports/<plat>.ts` + `detect.ts` 一个分支 + 测试，**不动构建配置**。
- 视真实需要再考虑：connection-state-recovery 透传、Taro 适配示例、CI workflow。

---

## 12. 验收标准

- [ ] `pnpm install && pnpm build` 干净成功，产出 `dist/index.mjs`、`dist/index.cjs`、`dist/index.d.ts`
- [ ] `pnpm test` 全绿；覆盖率达到第 8.4 节目标；E2E 中 ★ 契约全部通过
- [ ] `pnpm pack --dry-run` 仅含 `dist/`、`README.md`、`LICENSE`、`package.json`
- [ ] `detect` 在 wx/my/都无 三种情况下行为正确
- [ ] E2E 用真实 `socket.io` server 跑通：连接、双向事件、ACK(+timeout)、二进制、namespace、断开、重连
- [ ] README 含安装、快速开始、与官方差异、平台支持、合法域名提示
- [ ] 在真机或开发者工具中验证 `socket.io-client` 可干净导入（开放点闭环）
</content>
</invoke>
