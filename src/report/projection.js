// "What would the score be if you published these files?" The measured score never changes (it describes the live site);
// this re-scores a COPY of the report with the fixes the ready files would make, using the same scoring function.
//
// Only effects we can state with certainty are projected:
//   robots.txt      -> every AI bot has an explicit rule for the mode (Allow, or Disallow in Cloak)
//   JSON-LD block   -> structured-data completeness = the fields the generated block really contains
// Rendering, content substance, cloaking and per-bot parity are properties of the site itself and are left untouched.
//
// Completeness uses the engine's own tracked fields and rounding (src/crawlers/schemaChecker.ts).
import { computeGeoScore } from '../data/diagnostics'

const LOCAL_FIELDS = {
  name: ['name'], address: ['address'], telephone: ['telephone'], hours: ['openingHours', 'openingHoursSpecification'],
  geo: ['geo'], sameAs: ['sameAs'], url: ['url'], image: ['image'], priceRange: ['priceRange'],
}

/** Fields a generated JSON-LD <script> block contains, or null if it can't be read. */
export function jsonLdFields(scriptHtml) {
  try {
    const body = scriptHtml.replace(/^\s*<script[^>]*>/i, '').replace(/<\/script>\s*$/i, '').replace(/\\u003c/g, '<')
    const keys = new Set(Object.keys(JSON.parse(body)))
    const present = Object.keys(LOCAL_FIELDS).filter((f) => LOCAL_FIELDS[f].some((k) => keys.has(k)))
    return { present, missing: Object.keys(LOCAL_FIELDS).filter((f) => !present.includes(f)), percent: Math.round((present.length / Object.keys(LOCAL_FIELDS).length) * 100) }
  } catch {
    return null
  }
}

export function projectReport(report, files, mode) {
  const out = structuredClone(report)
  const byId = Object.fromEntries((files ?? []).map((f) => [f.id, f]))

  // robots.txt: only when we produced a full replacement (an unreadable original comes with a warning: can't be sure it merges)
  const robots = byId.robots
  if (robots?.status === 'ready' && !robots.warning && out.robots?.ok) {
    const allow = mode !== 'cloak'
    out.robots.data.perBot = out.robots.data.perBot.map((b) => ({
      ...b, allowedTargetPath: allow, hasExplicitEntry: true, matchedRule: allow ? 'Allow: /' : 'Disallow: /',
    }))
  }

  // JSON-LD: never project a *worse* result than what the site already has
  const ld = byId.jsonld
  if (ld?.status === 'ready' && out.schema?.ok && out.schema.data.fetchUsable) {
    const fc = jsonLdFields(ld.content)
    const had = out.schema.data.found ? out.schema.data.fieldCompleteness?.percent ?? 0 : -1
    if (fc && fc.percent > had) {
      out.schema.data = { ...out.schema.data, found: true, types: ['LocalBusiness'], blockCount: Math.max(1, out.schema.data.blockCount), fieldCompleteness: fc }
    }
  }
  return out
}

/** Score with the ready files applied, plus the delta against the measured score. Null when there's nothing to compare. */
export function projectScore(report, files, mode, measured) {
  if (!report || !files?.length || !measured || measured.indeterminate) return null
  const projected = computeGeoScore(projectReport(report, files, mode), mode)
  if (projected.indeterminate) return null
  return { score: projected.score, grade: projected.grade, delta: projected.score - measured.score }
}
