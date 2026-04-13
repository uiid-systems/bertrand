import { eq, like, or, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { groups } from "@/db/schema";
import { createId } from "@/lib/id";

export function createGroup(opts: {
  slug: string;
  name: string;
  parentId?: string;
}) {
  const db = getDb();
  const id = createId();

  // Build materialized path
  let path = opts.slug;
  let depth = 0;

  if (opts.parentId) {
    const parent = db
      .select()
      .from(groups)
      .where(eq(groups.id, opts.parentId))
      .get();
    if (!parent) throw new Error(`Parent group ${opts.parentId} not found`);
    path = `${parent.path}/${opts.slug}`;
    depth = parent.depth + 1;
  }

  return db
    .insert(groups)
    .values({ id, slug: opts.slug, name: opts.name, parentId: opts.parentId, path, depth })
    .returning()
    .get();
}

export function getGroup(id: string) {
  return getDb().select().from(groups).where(eq(groups.id, id)).get();
}

export function getGroupByPath(path: string) {
  return getDb().select().from(groups).where(eq(groups.path, path)).get();
}

export function getGroupsByParent(parentId: string | null) {
  const db = getDb();
  const condition = parentId
    ? eq(groups.parentId, parentId)
    : isNull(groups.parentId);
  return db.select().from(groups).where(condition).all();
}

export function getGroupTree(rootPath: string) {
  return getDb()
    .select()
    .from(groups)
    .where(or(eq(groups.path, rootPath), like(groups.path, `${rootPath}/%`)))
    .all();
}

export function getOrCreateGroupPath(path: string): string {
  const existing = getGroupByPath(path);
  if (existing) return existing.id;

  const segments = path.split("/");
  let parentId: string | undefined;

  for (let i = 0; i < segments.length; i++) {
    const partialPath = segments.slice(0, i + 1).join("/");
    const group = getGroupByPath(partialPath);
    if (group) {
      parentId = group.id;
    } else {
      const slug = segments[i]!;
      const created = createGroup({ slug, name: slug, parentId });
      parentId = created.id;
    }
  }

  return parentId!;
}
