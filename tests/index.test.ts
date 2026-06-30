import { describe, it, expect, afterEach } from 'vitest'
import { io } from '../src/index'
import { WechatTransport } from '../src/transports/wechat'

afterEach(() => {
  delete (globalThis as any).wx
})

describe('io()', () => {
  it('throws when no platform transport is available and none injected', () => {
    expect(() => io('ws://localhost:3000', { autoConnect: false })).toThrow(/wx\/my/)
  })

  it('uses the detected transport (wechat) and forces websocket', () => {
    ;(globalThis as any).wx = { connectSocket: () => ({}) }
    const socket = io('ws://localhost:3000', { autoConnect: false })
    expect(socket.io.opts.transports).toEqual([WechatTransport])
  })

  it('respects an injected transports override', () => {
    class FakeTransport {}
    const socket = io('ws://localhost:3000', {
      autoConnect: false,
      transports: [FakeTransport as any],
    })
    expect(socket.io.opts.transports).toEqual([FakeTransport])
  })
})
