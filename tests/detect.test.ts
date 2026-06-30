import { describe, it, expect, afterEach } from 'vitest'
import { detectTransport } from '../src/transports/detect'
import { WechatTransport } from '../src/transports/wechat'
import { AlipayTransport } from '../src/transports/alipay'
import { DouyinTransport } from '../src/transports/douyin'

afterEach(() => {
  delete (globalThis as any).wx
  delete (globalThis as any).my
  delete (globalThis as any).tt
})

describe('detectTransport', () => {
  it('returns WechatTransport when wx.connectSocket exists', () => {
    ;(globalThis as any).wx = { connectSocket: () => ({}) }
    expect(detectTransport()).toBe(WechatTransport)
  })
  it('returns AlipayTransport when only my.connectSocket exists', () => {
    ;(globalThis as any).my = { connectSocket: () => ({}) }
    expect(detectTransport()).toBe(AlipayTransport)
  })
  it('prefers Wechat when both exist', () => {
    ;(globalThis as any).wx = { connectSocket: () => ({}) }
    ;(globalThis as any).my = { connectSocket: () => ({}) }
    expect(detectTransport()).toBe(WechatTransport)
  })
  it('returns DouyinTransport when only tt.connectSocket exists', () => {
    ;(globalThis as any).tt = { connectSocket: () => ({}) }
    expect(detectTransport()).toBe(DouyinTransport)
  })
  it('prefers Wechat over tt when both exist', () => {
    ;(globalThis as any).wx = { connectSocket: () => ({}) }
    ;(globalThis as any).tt = { connectSocket: () => ({}) }
    expect(detectTransport()).toBe(WechatTransport)
  })
  it('throws a helpful error when neither exists', () => {
    expect(() => detectTransport()).toThrow(/wx\/my/)
  })
})
