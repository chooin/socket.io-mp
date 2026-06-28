/** 把 query 对象序列化成 `k=v&k=v`（值做 URL 编码）。 */
export function encodeQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(query[key]))
    .join('&')
}

/** 复刻官方 websocket transport 的 uri() 构造逻辑：ws(s)://host[:port]/path?query */
export function buildUri(
  opts: { secure?: boolean; hostname?: string; port?: string | number; path?: string },
  query: Record<string, string> = {},
): string {
  const schema = opts.secure ? 'wss' : 'ws'
  let host = opts.hostname || 'localhost'
  if (host.indexOf(':') !== -1) host = '[' + host + ']' // IPv6

  const portStr = opts.port == null ? '' : String(opts.port)
  const needsPort =
    portStr !== '' &&
    !((schema === 'wss' && portStr === '443') || (schema === 'ws' && portStr === '80'))
  const port = needsPort ? ':' + portStr : ''

  const qs = encodeQuery(query)
  const path = opts.path || '/socket.io/'
  return schema + '://' + host + port + path + (qs ? '?' + qs : '')
}
