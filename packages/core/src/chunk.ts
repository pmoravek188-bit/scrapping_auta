/**
 * Max ids per PostgREST `.in(...)` filter. The filter is encoded into the
 * request URL, so a few hundred UUIDs make it too long and the request fails
 * — which, unchecked, silently skips whatever that query was for. Split any
 * id list of unbounded size with {@link chunk} before filtering on it.
 */
export const IN_FILTER_CHUNK_SIZE = 100;

/** Splits `items` into consecutive slices of at most `size` elements. */
export function chunk<T>(items: readonly T[], size: number = IN_FILTER_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
