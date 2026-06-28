import { Transport } from 'engine.io-client'
import { encodePacket } from 'engine.io-parser'
import type { Packet, RawData } from 'engine.io-parser'
import { buildUri } from './base'

/**
 * 支付宝小程序 transport（全局事件式 API，单连接）。
 *
 * 二进制差异:支付宝 `sendSocketMessage` 只接受 string,二进制需经
 * `my.arrayBufferToBase64` 编码后配合 `isBuffer: true` 发送;接收端 `isBuffer`
 * 为 true 时 `data` 是 base64 字符串,用 `my.base64ToArrayBuffer` 还原成
 * ArrayBuffer 再交给 engine。
 *
 * 限制:支付宝同一时刻仅允许一条 socket 连接(全局事件模型),多个连不同
 * 服务端的 Manager 会互相干扰。
 */
export class AlipayTransport extends Transport {
  get name(): 'websocket' {
    return 'websocket'
  }

  // 用箭头字段保证 on/off 传入同一引用,doClose 才能正确反注册。
  // 块体包裹:基类部分生命周期方法返回 this,简写体配合显式 : void 会报 TS2322。
  private readonly onAliOpen = (): void => {
    this.onOpen()
  }

  private readonly onAliMessage = (res: { data: string | ArrayBuffer; isBuffer: boolean }): void => {
    const data: RawData = res.isBuffer
      ? my.base64ToArrayBuffer(res.data as string)
      : (res.data as string)
    this.onData(data)
  }

  private readonly onAliClose = (): void => {
    this.onClose()
  }

  private readonly onAliError = (arg: { errorMessage: string; error: number }): void => {
    this.onError('websocket error', new Error(arg.errorMessage))
  }

  protected doOpen(): void {
    my.onSocketOpen(this.onAliOpen)
    my.onSocketMessage(this.onAliMessage)
    my.onSocketClose(this.onAliClose)
    my.onSocketError(this.onAliError)
    const query = this.query as Record<string, string>
    my.connectSocket({ url: buildUri(this.opts as any, query) })
  }

  protected doClose(): void {
    my.closeSocket({})
    my.offSocketOpen(this.onAliOpen)
    my.offSocketMessage(this.onAliMessage)
    my.offSocketClose(this.onAliClose)
    my.offSocketError(this.onAliError)
  }

  protected write(packets: Packet[]): void {
    if (packets.length === 0) return
    this.writable = false
    let remaining = packets.length
    for (const packet of packets) {
      encodePacket(packet, true, (data) => {
        if (typeof data === 'string') {
          my.sendSocketMessage({ data, isBuffer: false })
        } else {
          my.sendSocketMessage({ data: my.arrayBufferToBase64(data as ArrayBuffer), isBuffer: true })
        }
        if (--remaining === 0) {
          this.writable = true
          this.emitReserved('drain')
        }
      })
    }
  }
}
