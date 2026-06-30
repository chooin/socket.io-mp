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
})
