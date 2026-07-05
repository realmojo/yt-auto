import { join } from "node:path";

/** make-short.mjs / rednote-fetch.js 와 동일한 slug 규칙 */
export function slug(s: string): string {
  return (
    String(s)
      .trim()
      .replace(/[\/\\:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 60) || "keyword"
  );
}

export const REFS_DIR = join(process.cwd(), "shopping", "refs");

export function refDir(keyword: string): string {
  return join(REFS_DIR, slug(keyword));
}
