import { eq, like, or, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { categories } from "@/db/schema";
import { createId } from "@/lib/id";

export function createCategory(opts: {
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
      .from(categories)
      .where(eq(categories.id, opts.parentId))
      .get();
    if (!parent) throw new Error(`Parent category ${opts.parentId} not found`);
    path = `${parent.path}/${opts.slug}`;
    depth = parent.depth + 1;
  }

  return db
    .insert(categories)
    .values({ id, slug: opts.slug, name: opts.name, parentId: opts.parentId, path, depth })
    .returning()
    .get();
}

export function getCategory(id: string) {
  return getDb().select().from(categories).where(eq(categories.id, id)).get();
}

export function getAllCategories() {
  return getDb().select().from(categories).all();
}

export function getCategoryByPath(path: string) {
  return getDb().select().from(categories).where(eq(categories.path, path)).get();
}

export function getCategoriesByParent(parentId: string | null) {
  const db = getDb();
  const condition = parentId
    ? eq(categories.parentId, parentId)
    : isNull(categories.parentId);
  return db.select().from(categories).where(condition).all();
}

export function getCategoryTree(rootPath: string) {
  return getDb()
    .select()
    .from(categories)
    .where(or(eq(categories.path, rootPath), like(categories.path, `${rootPath}/%`)))
    .all();
}

export function getOrCreateCategoryPath(path: string): string {
  const existing = getCategoryByPath(path);
  if (existing) return existing.id;

  const segments = path.split("/");
  let parentId: string | undefined;

  for (let i = 0; i < segments.length; i++) {
    const partialPath = segments.slice(0, i + 1).join("/");
    const category = getCategoryByPath(partialPath);
    if (category) {
      parentId = category.id;
    } else {
      const slug = segments[i]!;
      const created = createCategory({ slug, name: slug, parentId });
      parentId = created.id;
    }
  }

  return parentId!;
}
