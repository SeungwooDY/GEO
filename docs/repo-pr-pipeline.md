# Repo to PR pipeline: design

**Goal.** A user submits a link to their repo. We take the edits our GEO analysis suggests for their site, have an agent apply them to a new branch of a clone of that repo, and open a pull request through the GitHub App. If the repo has CI it runs on the PR; if not, the PR is for manual review. The whole thing must be non-destructive and work across stacks (plain HTML, Next.js, WordPress, and more over time).

Status: design. Nothing in this document is built on `main` yet unless the table says so. Intake is parked on the `repo-intake` branch while the agent (steps 3 to 5) is built first.

## What already exists

| Piece | Where | State |
| --- | --- | --- |
| URL analysis (robots, UA-diff, rendering gap, schema, content, per-bot) | `src/crawlers/`, `src/diagnostics` via `server/bridge.ts` (`POST /api/scan`) | built |
| Suggestions from the analysis | `src/suggestions/suggestionEngine.ts` | built |
| Deterministic file content (robots merge, sitemap, JSON-LD, llms.txt, markdown) | `server/files.ts`, `src/generators/` (`POST /api/files`) | built; only generates when business facts validate |
| Repo URL field on the landing page | `src/Landing.jsx` | validates the URL, nothing acts on it |
| GitHub App: auth, webhooks, clone, branch, commit, push, PR (idempotent, never the default branch) | `src/harness/` | built, exercised on a real repo |
| Repo intake: URL parsing, sign in with GitHub, "may I open a PR here?" | branch `repo-intake` (commit 1964b40), **parked, not merged** | built and tested with fakes; not run against real GitHub (needs the App's client secret); web app not wired to it |
| Repo understanding, the agent, verification, CI handling, job runner, UI wiring | | not built |

## Design decisions

**D1. Split "what" from "where".** Code generates the content; the agent decides where and how to place it in this repo. The agent never invents JSON-LD or robots rules. A Next.js layout and a plain `index.html` need the same JSON-LD in different files and syntax. Because we know exactly what should end up in the repo, verification is "does the built page contain this block", not "does this edit look plausible". Rejected: letting the model write the content as well. That is where fabricated phone numbers and claims come from.

**D2. Additive first.** Each task has strategies ranked by risk: create a new file, then insert a block into an existing file, then modify existing content. The agent takes the safest one that works. Examples: `public/robots.txt` and `sitemap.xml` are new files; JSON-LD is one inserted block; on WordPress, a new small plugin file rather than edits to theme code.

**D3. Access only through the GitHub App, and verify the submitter separately.** The installation token does everything (contents and pull-requests write only); we never use the user's own credentials. An installation does not prove who is asking, so the submitter signs in with GitHub and we check they have write access to the repo. Without that, anyone could trigger PRs on any repo where the App is installed.

**D4. The agent works out where things go; code decides what is trusted.** An agent can analyze an unfamiliar repo and work out its stack, and for the long tail of odd layouts that beats any detector we could write. So the agent explores and produces a structured repo profile. But the profile is a proposal, not an instruction. Code validates it before anything privileged happens:
- A build or lint command is only run if it is in a small allowlist, or is a script that literally exists in the repo's `package.json`. It is never a command the model typed, because repo text can be written by an attacker.
- Paths must exist and stay inside the repo.
- Where a cheap deterministic detector (for HTML, Next.js, WordPress) disagrees with the agent, we flag it or prefer the detector.
- Low confidence or an unknown stack means "unsupported": report-only, with the downloadable files the UI already offers. We do not guess and open a plausible-looking PR.

Why not agent-only? Detection is not the hard part; trust is. A model can decide "this is Next.js" but cannot prove its edit works without building or rendering, and the thing that verifies should not be the thing that made the edit. Model exploration also costs turns (free-tier quotas have been as low as 20 requests) and is not reproducible run to run.

**D5. Verification is separate from the agent and fails closed.** Plain code checks the result, in tiers: source checks, then build and render with a before and after comparison. A change we can only partly verify becomes a draft PR labelled "unverified".

**D6. CI is observed, not configured.** A PR opened with an App installation token should trigger the repo's workflows (unlike one made with Actions' own `GITHUB_TOKEN`); confirm this on a real repo early. We never edit `.github/`. After opening the PR we watch for checks and report them; reading them needs an extra App permission (`checks: read`), and existing installers must approve it. If no checks appear, the PR is labelled for manual review.

**D7. Runs are asynchronous, resumable and idempotent.** A run takes minutes. Re-running the same change reuses the same branch and PR.

## Flow

```
user submits repo URL + site URL
  1 intake: App installed? user authorized? site and repo plausibly the same project?
  analysis (built) -> suggestions (built) -> deterministic files (built) -> approved work orders
  2 clone
  3 agent explores -> repo profile -> code validates it (stack, CI, existing SEO plugins)
  4 agent places the files, sandboxed, additive first
  5 verify: source checks -> build -> rendered before/after
       fail -> nothing pushed, user told why
       pass -> 6 branch geo/... -> push (no force) -> PR (draft if unverified) -> watch CI -> status to user
```

## Stacks

| Stack | Where things go | How we verify | Main risk |
| --- | --- | --- | --- |
| Plain HTML | JSON-LD in `<head>` of `index.html`; `robots.txt` and `sitemap.xml` at the root | Parse the HTML | Low |
| Next.js | `public/robots.txt` or `app/robots.ts`; JSON-LD in the root layout or a page; sitemap file or `app/sitemap.ts` | `next build`, then check rendered pages | Mixing App Router and Pages Router conventions |
| WordPress | A new self-contained plugin file hooking `wp_head`; a physical `robots.txt` only if one already exists | `php -l`; detect existing Yoast or RankMath schema to avoid duplicates | PHP errors can take a site down; many WP sites are not Git repos at all |
| Others (Astro, Hugo, Jekyll, Nuxt, ...) | Added one at a time, or handled by the agent's own analysis where the checks allow | Same build and render check | Each needs a verified runner |

The per-stack knowledge that stays in code is small: which build or lint command may run, and how to find the rendered output. Where things go can be a short playbook for the agent to consult, not code.

## Safety model (non-destructive)
1. Only ever a PR. The App cannot push to the default branch; a person merges.
2. Additive-first edits, no deletions, a size cap, and never `.github/`, `.git/`, secret files or lockfiles.
3. Branch names are ours (`geo/...`). If someone else has pushed to that branch, start a new one; never stack onto a human's work.
4. The agent runs sandboxed with no shell; repo text is untrusted.
5. New facts must already be visible on the page or supplied by the business.
6. Verification gates the push.
7. Idempotent retries, a kill switch, an audit log.

## Build steps

| # | Step | Done when |
| --- | --- | --- |
| 1 | Intake and authorization: parse the repo URL, look up the installation (with an "install the App" prompt when missing), check the submitter's access, pair with the site URL. Wire the landing page field to a new bridge endpoint. | Submitting a repo URL correctly reports not installed / not yours / ready |
| 2 | Work orders: suggestions plus the deterministic files become a change spec the user approves | A scan and approval yields a spec with exact file contents |
| 3 | Repo understanding: agent explores and proposes a profile; code validates it (build command allowlist, paths, CI and SEO-plugin detection) | Sample repos of each target stack are profiled correctly; unknown stacks are reported unsupported |
| 4 | The agent: sandboxed file tools, provider-neutral model client, short per-stack playbooks | On an HTML repo it places every file correctly |
| 5 | Verification: source checks, then build and render with before/after comparison | Good edits pass and deliberately bad ones are rejected on each supported stack |
| 6 | Delivery and CI: PR body, draft vs ready, labels, watching checks | A PR on a repo with CI shows results; on one without, it says "no CI, manual review" |
| 7 | Job runner and status API, surfaced in the UI | A user submits a link and sees the PR link appear |
| 8 | Stack expansion: HTML, then Next.js, then WordPress, each with a real sample repo | Each stack completes an end-to-end run |

Build a vertical slice first (steps 1 to 7 on a plain HTML repo), then widen stacks in step 8.

## Open decisions
1. **CI visibility:** add the `checks: read` permission now (before there are installers) or skip CI reporting.
2. **Submitter sign-in:** build the GitHub sign-in check in step 1, or start operator-run while only the team is testing. Do not open it to strangers without the check.
3. **Unsupported stacks:** fall back to downloadable files rather than refusing.
4. **WordPress:** a new plugin file rather than edits to theme files.
5. **Build sandbox:** where untrusted repo builds run (a locked-down container with no network is the assumption).
