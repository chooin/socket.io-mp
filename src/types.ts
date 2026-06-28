import type { Transport } from 'engine.io-client'
import type { ManagerOptions, SocketOptions } from 'socket.io-client'

/** 一个可被官方 io() 接受的 transport 构造器。 */
export type TransportCtor = new (opts: ConstructorParameters<typeof Transport>[0]) => Transport

export interface MpOptions extends Partial<ManagerOptions & SocketOptions> {
  /** 覆盖自动探测；不传则按 wx/my 运行时选择。 */
  transports?: TransportCtor[]
}
