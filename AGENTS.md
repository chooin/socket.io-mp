# AGENTS.md

本仓库是 `socket.io-mp`：让官方 `socket.io-client` 在微信/支付宝小程序运行的适配包。

## 命令

- `pnpm test` 跑测试；`pnpm test <name>` 跑单个文件；`pnpm run test:coverage` 看覆盖率
- `pnpm typecheck` 类型检查；`pnpm build` 构建

包管理器是 **pnpm@10**，不要用 npm/yarn。

## 架构

- 不重写协议。协议能力全部来自官方 `socket.io-client` / `engine.io-client` / `engine.io-parser`（均为运行时依赖、构建时 external）。
- 我们只写 `src/transports/*`（微信/支付宝 `Transport` 子类）+ `src/transports/detect.ts` + `src/index.ts` 的 `io()` 包装。
- 每个 transport 子类必须实现 `get name()`（返回 `'websocket'`）、`doOpen`、`doClose`、`write`，并调用基类 `onOpen/onData/onClose/onError`。

## 约束

- target **es2018** + `useDefineForClassFields:false`；`strict`。
- 调用 `wx`/`my` 前用 `typeof wx !== 'undefined'` 守卫（见 `detect.ts`）。
- 支付宝为全局单连接 API；微信支持多连接。
- 提交用约定式提交 + 中文描述。
