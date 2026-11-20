import Redis from 'ioredis'
let client
export function database() {
  if (!client || client.status === 'end') {
    const { REDIS_HOST, REDIS_PORT, REDIS_PSW, REDIS_USERNAME, REDIS_TLS, REDIS_URL } = process.env
    if (!REDIS_URL && (!REDIS_HOST || !REDIS_PORT || !REDIS_PSW)) throw new Error('Configuración Redis incompleta')
    const options = { maxRetriesPerRequest: 1, connectTimeout: 5000, retryStrategy: n => n > 2 ? null : n * 200 }
    client = REDIS_URL ? new Redis(REDIS_URL, options) : new Redis({ ...options, host: REDIS_HOST, port: Number(REDIS_PORT), password: REDIS_PSW, username: REDIS_USERNAME || 'default', ...(REDIS_TLS === 'true' ? { tls: {} } : {}) })
    client.on('error', e => console.error('Redis:', e.message))
  }
  return client
}
export async function closeDatabase() { if (client) { client.disconnect(); client = undefined } }
