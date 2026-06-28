import { describe, it, expect, vi, afterEach } from 'vitest'
import { AlipayTransport } from '../src/transports/alipay'

function installFakeMy() {
  const h: Record<string, (arg?: any) => void> = {}
  const my = {
    connectSocket: vi.fn(),
    onSocketOpen: (cb: any) => { h.open = cb },
    onSocketMessage: (cb: any) => { h.message = cb },
    onSocketClose: (cb: any) => { h.close = cb },
    onSocketError: (cb: any) => { h.error = cb },
    offSocketOpen: vi.fn(),
    offSocketMessage: vi.fn(),
    offSocketClose: vi.fn(),
    offSocketError: vi.fn(),
    sendSocketMessage: vi.fn(),
    closeSocket: vi.fn(),
    // Alipay sends/receives binary as base64 strings; the platform provides these.
    arrayBufferToBase64: vi.fn((_buf: ArrayBuffer) => 'BASE64'),
    base64ToArrayBuffer: vi.fn((_s: string) => new Uint8Array([1, 2, 3]).buffer),
  }
  ;(globalThis as any).my = my
  return { my, h }
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

  it('doOpen registers global handlers and connects with the right url', () => {
    const { my } = installFakeMy()
    new AlipayTransport(makeOpts()).open()
    expect(my.connectSocket).toHaveBeenCalledTimes(1)
    const url = my.connectSocket.mock.calls[0][0].url as string
    expect(url).toContain('EIO=4')
    expect(url).toContain('transport=websocket')
  })

  it('emits "open" on global socket open', () => {
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
    const { my } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    const drain = vi.fn()
    ;(t as any).on('drain', drain)
    t.open()
    ;(t as any).write([{ type: 'message', data: 'hi' }])
    expect(my.sendSocketMessage).toHaveBeenCalledWith({ data: '4hi', isBuffer: false })
    expect(drain).toHaveBeenCalled()
  })

  it('write base64-encodes a binary packet and sets isBuffer=true', () => {
    const { my } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    t.open()
    const buf = new Uint8Array([1, 2, 3]).buffer
    ;(t as any).write([{ type: 'message', data: buf }])
    expect(my.arrayBufferToBase64).toHaveBeenCalledWith(buf)
    expect(my.sendSocketMessage).toHaveBeenCalledWith({ data: 'BASE64', isBuffer: true })
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

  it('doClose closes the socket and unregisters handlers', () => {
    const { my } = installFakeMy()
    const t = new AlipayTransport(makeOpts())
    t.open()
    ;(t as any).doClose()
    expect(my.closeSocket).toHaveBeenCalled()
    // 必须用注册时的同一引用反注册,否则 off* 形同空操作
    expect(my.offSocketOpen).toHaveBeenCalledWith((t as any).onAliOpen)
    expect(my.offSocketMessage).toHaveBeenCalledWith((t as any).onAliMessage)
    expect(my.offSocketClose).toHaveBeenCalledWith((t as any).onAliClose)
    expect(my.offSocketError).toHaveBeenCalledWith((t as any).onAliError)
  })
})
