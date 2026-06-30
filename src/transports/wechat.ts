import { Transport } from 'engine.io-client'
import { encodePacket } from 'engine.io-parser'
import type { Packet, RawData } from 'engine.io-parser'
import { buildUri } from './base'

export class WechatTransport extends Transport {
  private task?: WechatMiniprogram.SocketTask

  get name(): 'websocket' {
    return 'websocket'
  }

  protected doOpen(): void {
    try {
      const query = this.query as Record<string, string>
      const url = buildUri(this.opts as any, query)
      this.task = wx.connectSocket({
        url,
        header: (this.opts as any).extraHeaders,
      })
      this.task.onOpen(() => this.onOpen())
      this.task.onMessage((res) => this.onData(res.data as RawData))
      this.task.onClose(() => this.onClose())
      this.task.onError((err) => this.onError('websocket error', new Error(err.errMsg)))
    } catch (err) {
      // 建连失败(URL 非法、超过并发上限等)转成 transport error 事件,
      // 交给 engine.io 走重连/降级,而非让异常逃逸出去。
      this.onError('websocket error', err as Error)
    }
  }

  protected doClose(): void {
    this.task?.close({})
    this.task = undefined
  }

  protected write(packets: Packet[]): void {
    if (packets.length === 0) return
    this.writable = false
    let remaining = packets.length
    for (const packet of packets) {
      // 第二参恒传 true,不可改成 this.supportsBinary:supportsBinary=false 时
      // engine.io-parser 会用 `new Blob()` + FileReader 把二进制编码成 base64,而小程序
      // 无 Blob/FileReader 会运行时崩溃。小程序原生支持二进制帧,故 forceBase64 在此无意义。
      encodePacket(packet, true, (data) => {
        this.task?.send({ data: data as string | ArrayBuffer })
        if (--remaining === 0) {
          // Defer drain so callers don't re-enter write() synchronously
          // (encodePacket callbacks fire sync; without this setTimeout the
          //  engine.io-client flush → write → drain → flush loop blows the stack)
          setTimeout(() => {
            this.writable = true
            this.emitReserved('drain')
          }, 0)
        }
      })
    }
  }
}
