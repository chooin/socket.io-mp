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
