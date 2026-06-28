import { describe, it, expect, afterEach } from 'vitest'
import { detectTransport } from '../src/transports/detect'
import { WeixinTransport } from '../src/transports/weixin'
import { AlipayTransport } from '../src/transports/alipay'

afterEach(() => {
  delete (globalThis as any).wx
  delete (globalThis as any).my
})

describe('detectTransport', () => {
  it('returns WeixinTransport when wx.connectSocket exists', () => {
    ;(globalThis as any).wx = { connectSocket: () => ({}) }
    expect(detectTransport()).toBe(WeixinTransport)
  })
  it('returns AlipayTransport when only my.connectSocket exists', () => {
    ;(globalThis as any).my = { connectSocket: () => ({}) }
    expect(detectTransport()).toBe(AlipayTransport)
  })
  it('prefers Weixin when both exist', () => {
    ;(globalThis as any).wx = { connectSocket: () => ({}) }
    ;(globalThis as any).my = { connectSocket: () => ({}) }
    expect(detectTransport()).toBe(WeixinTransport)
  })
  it('throws a helpful error when neither exists', () => {
    expect(() => detectTransport()).toThrow(/wx\/my/)
  })
})
