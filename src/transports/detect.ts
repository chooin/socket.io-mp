import type { TransportCtor } from '../types'
import { WechatTransport } from './wechat'
import { AlipayTransport } from './alipay'
import { DouyinTransport } from './douyin'

/** 运行时探测当前小程序平台，返回对应 transport 类。 */
export function detectTransport(): TransportCtor {
  // 先判 `!== 'undefined'`(未声明标识符直接读会 ReferenceError),再判真值:
  // typeof null === 'object' 会漏过纯 typeof 守卫,兼容层/模拟器可能把未用的全局显式置为 null。
  if (typeof wx !== 'undefined' && wx && typeof wx.connectSocket === 'function') {
    return WechatTransport as unknown as TransportCtor
  }
  if (typeof my !== 'undefined' && my && typeof my.connectSocket === 'function') {
    return AlipayTransport as unknown as TransportCtor
  }
  if (typeof tt !== 'undefined' && tt && typeof tt.connectSocket === 'function') {
    return DouyinTransport as unknown as TransportCtor
  }
  throw new Error(
    '[socket.io-mp] 未检测到 wx/my/tt 的 WebSocket API；请用 io(uri, { transports: [自定义Transport] }) 显式注入',
  )
}
