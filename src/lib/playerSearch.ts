/** Case-insensitive name match; an empty query matches everyone. */
export function matchesPlayerSearch(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q);
}
