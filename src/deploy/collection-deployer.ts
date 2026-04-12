/**
 * Create collections and fields from structure.yaml definitions.
 */
import type { NocoBaseClient } from '../client';
import type { CollectionDef, FieldDef } from '../types/spec';
import { bestEffort } from '../utils/error-utils';

/**
 * Ensure a collection exists with all specified fields.
 * Creates collection if needed, then creates missing fields.
 */
export async function ensureCollection(
  nb: NocoBaseClient,
  name: string,
  def: CollectionDef,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const exists = await nb.collections.exists(name);
  if (exists) {
    log(`  = collection: ${name}`);
  } else {
    await nb.collections.create(name, def.title);
    log(`  + collection: ${name}`);

    // Set titleField to first string field
    const titleField = def.fields.find(
      f => f.interface === 'input' && !f.name.includes('_id'),
    );
    if (titleField) {
      await bestEffort('setTitleField', () =>
        nb.http.post(`${nb.baseUrl}/api/collections:update`, {
          filterByTk: name,
          values: { titleField: titleField.name },
        }),
      );
    }
  }

  // Create fields
  for (const fd of def.fields) {
    try {
      // Check if field exists
      const meta = await nb.collections.fieldMeta(name);
      if (fd.name in meta) continue;

      await nb.collections.createField(name, fd);
      log(`    + ${name}.${fd.name}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`    ! ${name}.${fd.name}: ${msg}`);
    }
  }

  // Clear cache after creating fields
  nb.collections.clearCache();
}

/**
 * Ensure all collections from structure.yaml exist.
 */
export async function ensureAllCollections(
  nb: NocoBaseClient,
  collections: Record<string, CollectionDef>,
  log: (msg: string) => void = console.log,
): Promise<void> {
  for (const [name, def] of Object.entries(collections)) {
    await ensureCollection(nb, name, def, log);
  }
}
