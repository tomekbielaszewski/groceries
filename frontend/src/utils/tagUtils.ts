const POLISH_MAP: [RegExp, string][] = [
  [/[ąĄ]/g, 'a'],
  [/[ćĆ]/g, 'c'],
  [/[ęĘ]/g, 'e'],
  [/[łŁ]/g, 'l'],
  [/[ńŃ]/g, 'n'],
  [/[óÓ]/g, 'o'],
  [/[śŚ]/g, 's'],
  [/[źŹżŻ]/g, 'z'],
]

export function normalizeTag(name: string): string {
  let result = name.trim().toLowerCase()
  for (const [pattern, replacement] of POLISH_MAP) {
    result = result.replace(pattern, replacement)
  }
  return result
}
