import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server as IOServer } from 'socket.io'
import WS, { type RawData } from 'ws'
import { io } from '../src/index'

let http: HttpServer
let ioServer: IOServer
let port: number

beforeAll(async () => {
  http = createServer()
  ioServer = new IOServer(http)
  ioServer.on('connection', (socket) => {
    socket.on('echo', (data, cb) => {
      if (typeof cb === 'function') cb(data)
    })
    socket.on('shout', (msg) => socket.emit('shouted', String(msg).toUpperCase()))
    socket.on('bin', (buf, cb) => {
      if (typeof cb === 'function') cb(buf)
    })
  })
  ioServer.of('/admin').on('connection', (socket) => socket.emit('welcome', 'admin'))
  await new Promise<void>((resolve) => http.listen(0, resolve))
  port = (http.address() as AddressInfo).port
})

afterAll(async () => {
  ioServer.close()
  await new Promise<void>((resolve) => http.close(() => resolve()))
})

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

// 用一条真实 ws 连接驱动假的 connectSocket，让 transport 真正连上 in-process server。
// 微信与抖音同构(都返回 SocketTask、二进制原生 ArrayBuffer)，共用同一份实现。
function wsBackedConnectSocket({ url }: { url: string }) {
  const ws = new WS(url)
  return {
    onOpen: (cb: any) => ws.on('open', () => cb({})),
    onMessage: (cb: any) =>
      ws.on('message', (data: RawData, isBinary: boolean) =>
        cb({ data: isBinary ? toArrayBuffer(data as Buffer) : data.toString() }),
      ),
    onClose: (cb: any) => ws.on('close', () => cb({})),
    onError: (cb: any) => ws.on('error', (e: Error) => cb(e)),
    send: ({ data }: { data: string | ArrayBuffer }) => ws.send(data),
    close: () => ws.close(),
  }
}

describe('e2e against a real socket.io server (wechat)', () => {
  beforeEach(() => {
    ;(globalThis as any).wx = { connectSocket: wsBackedConnectSocket }
  })
  afterEach(() => {
    delete (globalThis as any).wx
  })

  it('★ connects and reports connected', async () => {
    const socket = io(`ws://localhost:${port}`, { forceNew: true })
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve())
        socket.on('connect_error', reject)
      })
      expect(socket.connected).toBe(true)
    } finally {
      socket.disconnect()
    }
  })

  it('★ round-trips an ACK', async () => {
    const socket = io(`ws://localhost:${port}`, { forceNew: true })
    try {
      const resp = await new Promise((resolve, reject) => {
        socket.on('connect_error', reject)
        socket.on('connect', () => socket.emit('echo', { a: 1 }, resolve))
      })
      expect(resp).toEqual({ a: 1 })
    } finally {
      socket.disconnect()
    }
  })

  it('receives a server-emitted event', async () => {
    const socket = io(`ws://localhost:${port}`, { forceNew: true })
    try {
      const shouted = await new Promise((resolve, reject) => {
        socket.on('connect_error', reject)
        socket.on('connect', () => {
          socket.on('shouted', resolve)
          socket.emit('shout', 'hi')
        })
      })
      expect(shouted).toBe('HI')
    } finally {
      socket.disconnect()
    }
  })

  it('round-trips binary (ArrayBuffer)', async () => {
    const socket = io(`ws://localhost:${port}`, { forceNew: true })
    const out = new Uint8Array([1, 2, 3, 4])
    try {
      const echoed = await new Promise<ArrayBuffer>((resolve, reject) => {
        socket.on('connect_error', reject)
        socket.on('connect', () => socket.emit('bin', out.buffer, resolve))
      })
      expect(new Uint8Array(echoed)).toEqual(out)
    } finally {
      socket.disconnect()
    }
  })

  it('connects to a namespace', async () => {
    const admin = io(`ws://localhost:${port}/admin`, { forceNew: true })
    try {
      const welcome = await new Promise((resolve, reject) => {
        admin.on('connect_error', reject)
        admin.on('welcome', resolve)
      })
      expect(welcome).toBe('admin')
    } finally {
      admin.disconnect()
    }
  })
})

describe('e2e against a real socket.io server (douyin)', () => {
  beforeEach(() => {
    ;(globalThis as any).tt = { connectSocket: wsBackedConnectSocket }
  })
  afterEach(() => {
    delete (globalThis as any).tt
  })

  it('★ connects and reports connected via tt', async () => {
    const socket = io(`ws://localhost:${port}`, { forceNew: true })
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve())
        socket.on('connect_error', reject)
      })
      expect(socket.connected).toBe(true)
    } finally {
      socket.disconnect()
    }
  })

  it('round-trips binary (ArrayBuffer) via tt', async () => {
    const socket = io(`ws://localhost:${port}`, { forceNew: true })
    const out = new Uint8Array([1, 2, 3, 4])
    try {
      const echoed = await new Promise<ArrayBuffer>((resolve, reject) => {
        socket.on('connect_error', reject)
        socket.on('connect', () => socket.emit('bin', out.buffer, resolve))
      })
      expect(new Uint8Array(echoed)).toEqual(out)
    } finally {
      socket.disconnect()
    }
  })
})
