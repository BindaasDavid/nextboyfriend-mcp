export function normalizePostsList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === "object" && "data" in raw) {
    const d = (raw as { data: unknown }).data;
    if (Array.isArray(d)) {
      return d;
    }
  }
  return raw === undefined ? [] : [raw];
}
