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
    // 被动关闭(服务器/网络断开)走这里:engine.io 基类 onClose 会先把 readyState
    // 置 "closed",随后上游 _onClose 调 transport.close() 会因此跳过 doClose(),
    // 所以必须在这里主动反注册,否则全局 handler 永久泄漏、旧实例无法 GC。
    this.cleanup()
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
    try {
      const query = this.query as Record<string, string>
      my.connectSocket({ url: buildUri(this.opts as any, query) })
    } catch (err) {
      // 建连失败:先反注册刚注册的全局 handler(避免泄漏)再转成 error 事件。
      this.cleanup()
      this.onError('websocket error', err as Error)
    }
  }

  protected doClose(): void {
    my.closeSocket({})
    this.cleanup()
  }

  /** 反注册全部全局事件 handler(用注册时的同一引用);幂等,可重复调用。 */
  private cleanup(): void {
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
      // 第二参恒传 true(理由同 wechat.ts):supportsBinary=false 会触发 engine.io-parser 的
      // `new Blob()` + FileReader,小程序无此 API。二进制改由下方 isBuffer 分支经
      // my.arrayBufferToBase64 处理,与协议层的 base64(b 前缀)无关。
      encodePacket(packet, true, (data) => {
        if (typeof data === 'string') {
          my.sendSocketMessage({ data, isBuffer: false })
        } else {
          // 二进制可能是 ArrayBuffer,也可能是 TypedArray(用户 emit Uint8Array 等);
          // 取出底层精确字节再 base64,避免把 TypedArray 当 ArrayBuffer 误传。
          const ab = ArrayBuffer.isView(data)
            ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
            : (data as ArrayBuffer)
          my.sendSocketMessage({ data: my.arrayBufferToBase64(ab), isBuffer: true })
        }
        if (--remaining === 0) {
          // Defer drain so callers don't re-enter write() synchronously
          setTimeout(() => {
            this.writable = true
            this.emitReserved('drain')
          }, 0)
        }
      })
    }
  }
}
