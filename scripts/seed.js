import { readFile } from 'node:fs/promises'
import { database, closeDatabase } from '../netlify/lib/redisDB.js'
import { insert, counter, list } from '../netlify/lib/store.js'
const db = database()
try {
  for (const resource of ['artists','subgenres','albums']) {
    const records = JSON.parse(await readFile(new URL(`../data/${resource}.json`, import.meta.url)))
    const max = Math.max(...records.map(r => Number(r.id)))
    await db.eval("local n=tonumber(redis.call('GET',KEYS[1]) or '0'); if n<tonumber(ARGV[1]) then redis.call('SET',KEYS[1],ARGV[1]) end; return 1",1,counter(resource),max)
    for (const doc of records) await insert(db,resource,doc.id,doc)
    console.log(`${resource}: ${(await list(db,resource)).length} registros`)
  }
} finally { await closeDatabase() }
