import { describe, it, expect, vi, afterEach } from 'vitest'
import { WechatTransport } from '../src/transports/wechat'

function installFakeWx() {
  const h: Record<string, (arg?: any) => void> = {}
  const task = {
    onOpen: (cb: any) => { h.open = cb },
    onMessage: (cb: any) => { h.message = cb },
    onClose: (cb: any) => { h.close = cb },
    onError: (cb: any) => { h.error = cb },
    send: vi.fn(),
    close: vi.fn(),
  }
  const connectSocket = vi.fn((_opts: any) => task)
  ;(globalThis as any).wx = { connectSocket }
  return { task, h, connectSocket }
}

function makeOpts(over: Record<string, any> = {}) {
  return {
    hostname: 'localhost',
    port: '3000',
    secure: false,
    path: '/socket.io/',
    query: { EIO: '4', transport: 'websocket' },
    socket: { binaryType: 'arraybuffer' },
    ...over,
  } as any
}

afterEach(() => {
  delete (globalThis as any).wx
  vi.restoreAllMocks()
})

describe('WechatTransport', () => {
  it('name is "websocket"', () => {
    installFakeWx()
    expect(new WechatTransport(makeOpts()).name).toBe('websocket')
  })

  it('doOpen connects with EIO=4 & transport=websocket in the url', () => {
    const { connectSocket } = installFakeWx()
    new WechatTransport(makeOpts()).open()
    expect(connectSocket).toHaveBeenCalledTimes(1)
    const url = connectSocket.mock.calls[0][0].url as string
    expect(url).toContain('EIO=4')
    expect(url).toContain('transport=websocket')
  })

  it('emits "open" when the socket opens', () => {
    const { h } = installFakeWx()
    const t = new WechatTransport(makeOpts())
    const opened = vi.fn()
    ;(t as any).on('open', opened)
    t.open()
    h.open()
    expect(opened).toHaveBeenCalled()
  })

  it('decodes an incoming text frame into a packet', () => {
    const { h } = installFakeWx()
    const t = new WechatTransport(makeOpts())
    const onPacket = vi.fn()
    ;(t as any).on('packet', onPacket)
    t.open()
    h.open()
    h.message({ data: '4hello' }) // engine.io: "4" = message, payload "hello"
    expect(onPacket).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message', data: 'hello' }),
    )
  })

  it('write encodes a text packet, sends via task, then drains', () => {
    vi.useFakeTimers()
    const { task } = installFakeWx()
    const t = new WechatTransport(makeOpts())
    const drain = vi.fn()
    ;(t as any).on('drain', drain)
    t.open()
    ;(t as any).write([{ type: 'message', data: 'hi' }])
    expect(task.send).toHaveBeenCalledWith({ data: '4hi' })
    // drain is deferred via setTimeout to prevent synchronous re-entry
    expect(drain).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(drain).toHaveBeenCalled()
    expect((t as any).writable).toBe(true)
    vi.useRealTimers()
  })

  it('write([]) does not leave the transport stuck non-writable', () => {
    const { h } = installFakeWx()
    const t = new WechatTransport(makeOpts())
    t.open()
    h.open() // onOpen sets writable = true
    expect((t as any).writable).toBe(true)
    ;(t as any).write([])
    expect((t as any).writable).toBe(true)
  })

  it('write sends an ArrayBuffer for a binary packet', () => {
    const { task } = installFakeWx()
    const t = new WechatTransport(makeOpts())
    t.open()
    const buf = new Uint8Array([1, 2, 3]).buffer
    ;(t as any).write([{ type: 'message', data: buf }])
    const sent = task.send.mock.calls[0][0].data
    expect(sent).toBeInstanceOf(ArrayBuffer)
  })

  it('emits "close" when the socket closes', () => {
    const { h } = installFakeWx()
    const t = new WechatTransport(makeOpts())
    const closed = vi.fn()
    ;(t as any).on('close', closed)
    t.open()
    h.open()
    h.close()
    expect(closed).toHaveBeenCalled()
  })

  it('doOpen 在 connectSocket 抛错时发出 error 事件而非向上抛出', () => {
    ;(globalThis as any).wx = {
      connectSocket: vi.fn(() => {
        throw new Error('connect failed')
      }),
    }
    const t = new WechatTransport(makeOpts())
    const errored = vi.fn()
    ;(t as any).on('error', errored)
    // 建连异常必须转成 transport error 事件,交给 engine.io 走重连/降级,而非逃逸
    expect(() => t.open()).not.toThrow()
    expect(errored).toHaveBeenCalled()
  })

  it('write normalizes a non-zero-offset TypedArray view to an exact ArrayBuffer', () => {
    const { task } = installFakeWx()
    const t = new WechatTransport(makeOpts())
    t.open()
    // 8 字节底层 buffer,取 offset=4、length=4 的视图(Node Buffer / subarray 的常见形态)
    const backing = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]).buffer
    ;(t as any).write([{ type: 'message', data: new Uint8Array(backing, 4, 4) }])
    const sent = task.send.mock.calls[0][0].data
    expect(sent).toBeInstanceOf(ArrayBuffer)
    expect(sent.byteLength).toBe(4)
    expect(new Uint8Array(sent)).toEqual(new Uint8Array([4, 5, 6, 7]))
  })
})
