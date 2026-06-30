import { describe, it, expect } from 'vitest'
import { buildUri, encodeQuery } from '../src/transports/base'

describe('encodeQuery', () => {
  it('serializes and url-encodes key/values', () => {
    expect(encodeQuery({ EIO: '4', transport: 'websocket' })).toBe('EIO=4&transport=websocket')
  })
  it('encodes special characters', () => {
    expect(encodeQuery({ a: 'b c', d: 'e&f' })).toBe('a=b%20c&d=e%26f')
  })
  it('returns empty string for empty object', () => {
    expect(encodeQuery({})).toBe('')
  })
})

describe('buildUri', () => {
  const query = { EIO: '4', transport: 'websocket' }
  it('builds a ws url with explicit port', () => {
    expect(
      buildUri({ secure: false, hostname: 'localhost', port: '3000', path: '/socket.io/' }, query),
    ).toBe('ws://localhost:3000/socket.io/?EIO=4&transport=websocket')
  })
  it('uses wss and omits default port 443', () => {
    expect(
      buildUri({ secure: true, hostname: 'example.com', port: '443', path: '/socket.io/' }, query),
    ).toBe('wss://example.com/socket.io/?EIO=4&transport=websocket')
  })
  it('omits default port 80 for ws', () => {
    expect(
      buildUri({ secure: false, hostname: 'example.com', port: '80', path: '/socket.io/' }, query),
    ).toBe('ws://example.com/socket.io/?EIO=4&transport=websocket')
  })
  it('wraps IPv6 hostname in brackets', () => {
    expect(
      buildUri({ secure: false, hostname: '::1', port: '3000', path: '/socket.io/' }, query),
    ).toBe('ws://[::1]:3000/socket.io/?EIO=4&transport=websocket')
  })
  it('omits the query string when query is empty', () => {
    expect(buildUri({ secure: false, hostname: 'h', port: '', path: '/socket.io/' }, {})).toBe(
      'ws://h/socket.io/',
    )
  })
  it('omits the port when port is 0 (对齐上游 _port 的 falsy 语义)', () => {
    expect(buildUri({ secure: false, hostname: 'h', port: 0, path: '/socket.io/' }, {})).toBe(
      'ws://h/socket.io/',
    )
  })
})
