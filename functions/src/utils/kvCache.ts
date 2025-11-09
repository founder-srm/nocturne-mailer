import type { KVNamespace } from '@cloudflare/workers-types'

export async function kvCacheGet<T>(kv: KVNamespace, key: string): Promise<T | undefined> {
  const val = await kv.get<T>(key, 'json')
  return (val ?? undefined) as T | undefined
}

export async function kvCacheSet<T>(kv: KVNamespace, key: string, value: T, ttlMs: number): Promise<void> {
  await kv.put(key, JSON.stringify(value), { expirationTtl: Math.ceil(ttlMs / 1000) })
}
