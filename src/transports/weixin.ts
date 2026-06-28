import { Transport } from 'engine.io-client'
import { encodePacket } from 'engine.io-parser'
import type { Packet, RawData } from 'engine.io-parser'
import { buildUri } from './base'

export class WeixinTransport extends Transport {
  private task?: WechatMiniprogram.SocketTask

  get name(): 'websocket' {
    return 'websocket'
  }

  protected doOpen(): void {
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
