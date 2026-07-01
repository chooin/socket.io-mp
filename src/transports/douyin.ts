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
    try {
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
    } catch (err) {
      // 建连失败(URL 非法、超过并发上限等)转成 transport error 事件,交给 engine.io 走
      // 重连/降级,而非让异常逃逸——否则初次连接会直接抛出 io(),重连时还会把 Manager 的
      // _reconnecting 永久卡在 true(与 WechatTransport/AlipayTransport 保持一致)。
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
      encodePacket(packet, true, (data) => {
        // 二进制可能是 ArrayBuffer,也可能是 TypedArray/DataView(用户 emit Uint8Array,或底层
        // 为 pooled buffer 的 Node Buffer / subarray 等):取底层精确字节,避免把非零 offset 的
        // view 当整个 buffer 误发。tt.SocketTask.send 只接受 string|ArrayBuffer(与支付宝同理)。
        const payload: string | ArrayBuffer =
          typeof data === 'string'
            ? data
            : ArrayBuffer.isView(data)
              ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
              : (data as ArrayBuffer)
        this.task?.send({ data: payload })
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
