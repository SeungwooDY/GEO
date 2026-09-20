// What a pull request will contain for a scanned repo, stated BEFORE the user clicks "Create pull request".
// This mirrors what the server actually does (src/harness/repoFix.ts) so the plan never promises a file the PR
// won't carry:
//   - robots.txt is written unless the repo generates it in code (then editing source isn't a config commit)
//   - llms.txt / JSON-LD are skipped in Cloak, and otherwise need a COMPLETE business profile
//   - JSON-LD also needs a head template to insert into
//   - a failing extraction check needs prerendering, which is a build change and never part of the PR

const REQUIRED = ['name', 'phone']
const REQUIRED_ADDRESS = ['street', 'city', 'region', 'postalCode']

/** True only when every required fact is filled in (the same rule the server applies before writing fact files). */
export function profileComplete(profile) {
  if (!profile || typeof profile !== 'object') return false
  const filled = (v) => typeof v === 'string' && v.trim() !== ''
  return REQUIRED.every((k) => filled(profile[k])) && REQUIRED_ADDRESS.every((k) => filled(profile.address?.[k]))
}

/** Names of the required facts still empty, for the form's hint. */
export function missingProfileFields(profile) {
  const filled = (v) => typeof v === 'string' && v.trim() !== ''
  return [
    ...REQUIRED.filter((k) => !filled(profile?.[k])),
    ...REQUIRED_ADDRESS.filter((k) => !filled(profile?.address?.[k])).map((k) => `address.${k}`),
  ]
}

/**
 * @returns {{ id: string, name: string, state: 'included'|'locked'|'excluded', impact: string }[]}
 */
export function buildPrPlan(report, mode, profile) {
  const status = (id) => report.checks.find((c) => c.id === id)?.status
  const t = report.editTargets
  const complete = profileComplete(profile)
  const rows = []

  // robots.txt: the one file every mode needs, and the only one that needs no business facts
  if (t.robots.generated) {
    rows.push({
      id: 'robots', name: 'robots.txt', state: 'excluded',
      impact: `${t.robots.path} generates robots.txt in code, so changing it means editing source, not adding a config file.`,
    })
  } else {
    rows.push({
      id: 'robots', name: 'robots.txt', state: 'included',
      impact: status('access') === 'ok'
        ? 'No score change: crawler access already passes. This locks the policy in explicitly.'
        : 'Fixes the failing crawler-access check.',
    })
  }

  // llms.txt and JSON-LD state business facts, so they need a complete profile and are pointless when hiding from AI
  if (mode === 'cloak') {
    const why = 'Cloak hides your content from AI, so published facts would work against it.'
    rows.push({ id: 'llms', name: 'llms.txt', state: 'excluded', impact: why })
    rows.push({ id: 'jsonld', name: 'JSON-LD (structured data)', state: 'excluded', impact: why })
  } else {
    rows.push({
      id: 'llms', name: 'llms.txt', state: complete ? 'included' : 'locked',
      impact: complete ? 'Built from your details.' : 'Unlocks when you add your details below.',
    })
    const head = t.headTemplate
    if (!head) {
      rows.push({ id: 'jsonld', name: 'JSON-LD (structured data)', state: 'excluded', impact: 'No head template was found in this repo to insert it into.' })
    } else {
      const base = status('structured') === 'bad' ? 'Fixes the failing structured-data check' : 'Refreshes structured data'
      const via = head.endsWith('.html') ? '' : `, through a guarded Claude edit of ${head} (insertion only, using your exact facts)`
      rows.push({
        id: 'jsonld', name: 'JSON-LD (structured data)', state: complete ? 'included' : 'locked',
        impact: `${base}${via}.${complete ? '' : ' Unlocks when you add your details below.'}`,
      })
    }
  }

  if (status('extraction') === 'bad') {
    rows.push({
      id: 'prerender', name: 'Prerendering', state: 'excluded',
      impact: 'Fixing the failing extraction check means prerendering the app, which is a build change, not a config file.',
    })
  }
  return rows
}
