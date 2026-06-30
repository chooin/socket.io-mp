import { describe, it, expect, vi, afterEach } from 'vitest'
import { AlipayTransport } from '../src/transports/alipay'

function installFakeMy() {
  const h: Record<string, (arg?: any) => void> = {}
  const task = {
    onOpen: (cb: any) => { h.open = cb },
    onMessage: (cb: any) => { h.message = cb },
    onClose: (cb: any) => { h.close = cb },
    onError: (cb: any) => { h.error = cb },
    send: vi.fn(),
    close: vi.fn(),
  }
  const my = {
    connectSocket: vi.fn((_opts: any) => task),
    // Alipay sends/receives binary as base64 strings; the platform provides these.
    arrayBufferToBase64: vi.fn((_buf: ArrayBuffer) => 'BASE64'),
    base64ToArrayBuffer: vi.fn((_s: string) => new Uint8Array([1, 2, 3]).buffer),
  }
  ;(globalThis as any).my = my
  return { my, task, h }
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
  delete (globalThis as any).my
  vi.restoreAllMocks()
})

describe('AlipayTransport', () => {
  it('name is "websocket"', () => {
    installFakeMy()
    expect(new AlipayTransport(makeOpts()).name).toBe('websocket')
  })

  it('doOpen connects in SocketTask mode (multiple:true) with EIO=4 & transport=websocket', () => {
    const { my } = installFakeMy()
    new AlipayTransport(makeOpts()).open()
    expect(my.connectSocket).toHaveBeenCalledTimes(1)
    const arg = my.connectSocket.mock.calls[0][0]
    expect(arg.multiple).toBe(true)
    expect(arg.url).toContain('EIO=4')
    expect(arg.url).toContain('transport=websocket')
  })

  it('emits "open" when the socket opens', () => {
    const { h } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    const opened = vi.fn()
    ;(t as any).on('open', opened)
    t.open()
    h.open()
    expect(opened).toHaveBeenCalled()
  })

  it('decodes an incoming text frame into a packet', () => {
    const { h } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    const onPacket = vi.fn()
    ;(t as any).on('packet', onPacket)
    t.open()
    h.open()
    h.message({ data: '4hello', isBuffer: false })
    expect(onPacket).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message', data: 'hello' }),
    )
  })

  it('base64-decodes an incoming binary frame before handing it to the engine', () => {
    const { my, h } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    const onPacket = vi.fn()
    ;(t as any).on('packet', onPacket)
    t.open()
    h.open()
    h.message({ data: 'BASE64', isBuffer: true })
    expect(my.base64ToArrayBuffer).toHaveBeenCalledWith('BASE64')
    expect(onPacket).toHaveBeenCalledWith(expect.objectContaining({ type: 'message' }))
  })

  it('write sends a text packet with isBuffer=false then drains', () => {
    vi.useFakeTimers()
    const { task } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    const drain = vi.fn()
    ;(t as any).on('drain', drain)
    t.open()
    ;(t as any).write([{ type: 'message', data: 'hi' }])
    expect(task.send).toHaveBeenCalledWith({ data: '4hi', isBuffer: false })
    expect(drain).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(drain).toHaveBeenCalled()
    expect((t as any).writable).toBe(true)
    vi.useRealTimers()
  })

  it('write base64-encodes a binary packet and sets isBuffer=true', () => {
    const { my, task } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    t.open()
    const buf = new Uint8Array([1, 2, 3]).buffer
    ;(t as any).write([{ type: 'message', data: buf }])
    expect(my.arrayBufferToBase64).toHaveBeenCalledWith(buf)
    expect(task.send).toHaveBeenCalledWith({ data: 'BASE64', isBuffer: true })
  })

  it('write converts a TypedArray binary packet to ArrayBuffer before base64', () => {
    const { my } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    t.open()
    ;(t as any).write([{ type: 'message', data: new Uint8Array([9, 8, 7]) }])
    expect(my.arrayBufferToBase64).toHaveBeenCalled()
    expect(my.arrayBufferToBase64.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer)
  })

  it('write([]) does not leave the transport stuck non-writable', () => {
    const { h } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    t.open()
    h.open() // onOpen sets writable = true
    expect((t as any).writable).toBe(true)
    ;(t as any).write([])
    expect((t as any).writable).toBe(true)
  })

  it('emits "close" when the socket closes', () => {
    const { h } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    const closed = vi.fn()
    ;(t as any).on('close', closed)
    t.open()
    h.open()
    h.close()
    expect(closed).toHaveBeenCalled()
  })

  it('doClose closes the task', () => {
    const { task } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    t.open()
    ;(t as any).doClose()
    expect(task.close).toHaveBeenCalled()
  })

  it('doOpen 在 connectSocket 抛错时发出 error 事件而非向上抛出', () => {
    const { my } = installFakeMy()
    my.connectSocket = vi.fn(() => {
      throw new Error('connect failed')
    }) as any
    const t = new AlipayTransport(makeOpts())
    const errored = vi.fn()
    ;(t as any).on('error', errored)
    expect(() => t.open()).not.toThrow()
    expect(errored).toHaveBeenCalled()
  })
})
