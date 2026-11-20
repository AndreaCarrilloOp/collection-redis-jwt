// Tutorial 14: claves individuales, valores JSON y contadores INCR.
const prefix = 'jazz:'
export const key = (resource, id) => `${prefix}${resource}:${id}`
export const counter = resource => `${prefix}${resource}:N`
export async function get(db, resource, id) {
  const value = await db.get(key(resource, id))
  return value === null ? null : JSON.parse(value)
}
export async function list(db, resource) {
  const keys = new Set(); let cursor = '0'
  do {
    const [next, batch] = await db.scan(cursor, 'MATCH', key(resource, '*'), 'COUNT', 100)
    cursor = next
    for (const k of batch) if (k !== counter(resource)) keys.add(k)
  } while (cursor !== '0')
  if (!keys.size) return []
  return (await db.mget(...keys)).filter(v => v !== null).map(v => JSON.parse(v)).sort((a,b) => Number(a.id)-Number(b.id))
}
export const save = (db,r,id,doc) => db.set(key(r,id), JSON.stringify(doc))
export const remove = (db,r,id) => db.del(key(r,id))
// Redis SET NX permite registro único incluso con solicitudes simultáneas.
export const insert = (db,r,id,doc) => db.set(key(r,id), JSON.stringify(doc), 'NX')
