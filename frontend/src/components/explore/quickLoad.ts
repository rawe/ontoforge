import type { EntityInstance, ListResponse } from '../../api/types.ts'
import { mapBounded } from './answerCanvas.ts'

/** Read a balanced sample, paging past existing nodes without exceeding the requested addition. */
export async function sampleEntities(
  typeKeys: readonly string[],
  existingIds: ReadonlySet<string>,
  limit: number,
  read: (typeKey: string, page: { limit: number; offset: number }) => Promise<ListResponse<EntityInstance>>,
): Promise<EntityInstance[]> {
  const found: EntityInstance[] = []
  const seen = new Set(existingIds)
  let active = [...new Set(typeKeys)].map(key => ({ key, offset: 0 }))
  while (found.length < limit && active.length > 0) {
    const size = Math.min(200, Math.max(1, Math.ceil((limit - found.length) / active.length)))
    const results = await mapBounded(active, 6, async type => ({
      type,
      page: await read(type.key, { limit: size, offset: type.offset }),
    }))
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    const pages = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    for (let row = 0; row < size && found.length < limit; row++) {
      for (const { page } of pages) {
        const entity = page.items[row]
        if (entity !== undefined && !seen.has(entity._id)) {
          found.push(entity)
          seen.add(entity._id)
          if (found.length === limit) break
        }
      }
    }
    active = pages.flatMap(({ type, page }) => {
      const offset = type.offset + page.items.length
      return page.items.length > 0 && offset < page.total ? [{ key: type.key, offset }] : []
    })
  }
  return found
}
