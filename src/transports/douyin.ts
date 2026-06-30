import { Transport } from 'engine.io-client'
import { encodePacket } from 'engine.io-parser'
import type { Packet, RawData } from 'engine.io-parser'
import { buildUri } from './base'

/**
 * 抖音(字节跳动)小程序 transport。
 *
 * 抖音与微信同构:`tt.connectSocket` 同步返回一个 SocketTask,二进制原生收发
 * ArrayBuffer(无需支付宝那套 base64,也无需 TypedArray→ArrayBuffer 的 slice 修正)。
 * `tt` 为整个字节系小程序(抖音 / 今日头条 / 西瓜 / 极速版等)共用,故本 transport
 * 一次性覆盖所有字节系宿主。
 */
export class DouyinTransport extends Transport {
  private task?: DouyinMiniprogram.SocketTask

  get name(): 'websocket' {
    return 'websocket'
  }

  protected doOpen(): void {
    const query = this.query as Record<string, string>
    const url = buildUri(this.opts as any, query)
    this.task = tt.connectSocket({
      url,
      header: (this.opts as any).extraHeaders,
    })
    this.task.onOpen(() => this.onOpen())
    this.task.onMessage((res) => this.onData(res.data as RawData))
    this.task.onClose(() => this.onClose())
    this.task.onError((res) => this.onError('websocket error', new Error(res.errMsg)))
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
