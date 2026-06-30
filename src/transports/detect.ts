import type { TransportCtor } from '../types'
import { WechatTransport } from './wechat'
import { AlipayTransport } from './alipay'

/** 运行时探测当前小程序平台，返回对应 transport 类。 */
export function detectTransport(): TransportCtor {
  if (typeof wx !== 'undefined' && typeof wx.connectSocket === 'function') {
    return WechatTransport as unknown as TransportCtor
  }
  if (typeof my !== 'undefined' && typeof my.connectSocket === 'function') {
    return AlipayTransport as unknown as TransportCtor
  }
  throw new Error(
    '[socket.io-mp] 未检测到 wx/my 的 WebSocket API；请用 io(uri, { transports: [自定义Transport] }) 显式注入',
  )
}
