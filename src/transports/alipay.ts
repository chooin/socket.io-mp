import { Transport } from 'engine.io-client'
import { encodePacket } from 'engine.io-parser'
import type { Packet, RawData } from 'engine.io-parser'
import { buildUri } from './base'

/**
 * 支付宝小程序 transport（SocketTask 模式，per-connection）。
 *
 * 用 my.connectSocket({ multiple: true }) 返回的 SocketTask 管理连接,handler 绑在
 * task 上(随实例 GC 释放),不再使用已废弃的全局 my.onSocket* 事件,因而天然没有
 * 跨连接的 handler 泄漏,也不再受"单连接"限制。
 *
 * 二进制差异:支付宝 send 只接受 string,二进制需 my.arrayBufferToBase64 编码后配合
 * isBuffer:true 发送;接收端 isBuffer 为 true 时 data 是 base64,用 my.base64ToArrayBuffer
 * 还原成 ArrayBuffer 再交给 engine。
 */

/**
 * 我们依赖的 SocketTask 契约子集。显式定义而非复用 @mini-types/my 的全局 SocketTask
 * 类型:其全局命名空间类型的引用方式随版本而变,局部接口可保证可编译;并补上 send 的
 * isBuffer——官方类型漏标,但接收端 onMessage 的 isBuffer 已存在,对称推断发送端亦支持
 * (待真机验证)。
 */
interface AliSocketTask {
  onOpen(cb: () => void): void
  onMessage(cb: (res: { data: string | ArrayBuffer; isBuffer: boolean }) => void): void
  onClose(cb: () => void): void
  onError(cb: (res: { errorMessage?: string; error?: number }) => void): void
  send(opt: { data: string; isBuffer?: boolean }): void
  close(opt?: { code?: number; reason?: string }): void
}

export class AlipayTransport extends Transport {
  private task?: AliSocketTask

  get name(): 'websocket' {
    return 'websocket'
  }

  protected doOpen(): void {
    try {
      const query = this.query as Record<string, string>
      // multiple:true 启用 SocketTask 模式;不传 header(与历史支付宝行为一致,平台 header 支持有限)。
      this.task = my.connectSocket({
        url: buildUri(this.opts as any, query),
        multiple: true,
      }) as unknown as AliSocketTask
      this.task.onOpen(() => this.onOpen())
      this.task.onMessage((res) => {
        const data: RawData = res.isBuffer
          ? my.base64ToArrayBuffer(res.data as string)
          : (res.data as string)
        this.onData(data)
      })
      this.task.onClose(() => this.onClose())
      this.task.onError((res) =>
        this.onError('websocket error', new Error(res?.errorMessage ?? 'websocket error')),
      )
    } catch (err) {
      // 建连失败转成 transport error 事件,交给 engine.io 走重连/降级,而非让异常逃逸。
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
      // 无 Blob/FileReader 会运行时崩溃。二进制改由下方 isBuffer 分支经 arrayBufferToBase64 处理。
      encodePacket(packet, true, (data) => {
        if (typeof data === 'string') {
          this.task?.send({ data, isBuffer: false })
        } else {
          // 二进制可能是 ArrayBuffer,也可能是 TypedArray(用户 emit Uint8Array 等);
          // 取出底层精确字节再 base64,避免把非零 offset 的 view 当整个 buffer 误传。
          const ab = ArrayBuffer.isView(data)
            ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
            : (data as ArrayBuffer)
          // isBuffer 为支付宝 send 的二进制标志(@mini-types 漏标,见 AliSocketTask 注释);待真机验证。
          this.task?.send({ data: my.arrayBufferToBase64(ab), isBuffer: true })
        }
        if (--remaining === 0) {
          // 延迟 drain,避免 encodePacket 同步回调导致 flush→write→drain→flush 同步重入爆栈。
          setTimeout(() => {
            this.writable = true
            this.emitReserved('drain')
          }, 0)
        }
      })
    }
  }
}
