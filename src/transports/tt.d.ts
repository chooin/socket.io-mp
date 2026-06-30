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
