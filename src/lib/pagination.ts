import { z } from "zod";

export const paginationQuery = z.object({
  take: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
});

/** Cursor pagination on `id`. Fetches one extra row to know whether a next page exists. */
export function paginate({ take, cursor }: z.infer<typeof paginationQuery>) {
  return {
    take: take + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  };
}

export function page<T extends { id: string }>(rows: T[], take: number) {
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
}
