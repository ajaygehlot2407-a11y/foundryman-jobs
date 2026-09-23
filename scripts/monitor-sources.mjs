const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

async function api(path, opts = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      ...headers,
      ...(opts.headers || {}),
    },
  })

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`)
  }

  return response.status === 204 ? null : response.json()
}

function esc(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function terms(value) {
  return String(value || '')
    .split(',')
    .map((item) => esc(item).toLowerCase())
    .filter(Boolean)
}

/*
 * Discovery terms are NOT treated as proof of eligibility.
 * They only help surface possible vacancies for manual verification.
 */
const DISCOVERY_TERMS = [
  'foundryman',
  'foundry man',
  'moulder',
  'molder',
  'foundry',
  'foundry worker',
  'foundry trade',
]

const DISCOVERY_PAGE_TERMS = [
  'recruitment',
  'recruitment notice',
  'vacancy',
  'vacancies',
  'career',
  'careers',
  'job',
  'jobs',
  'advertisement',
  'advt',
  'notification',
  'notice',
  'apprentice',
  'apprenticeship',
  'engagement',
  'selection',
]

const MAX_PAGES_PER_SOURCE = 4
const MAX_LINKS_PER_PAGE = 40
const MAX_CANDIDATES_PER_SOURCE = 25
const REQUEST_TIMEOUT_MS = 15000

function normalizeUrl(rawUrl, baseUrl) {
  try {
    const url = new URL(rawUrl, baseUrl)

    url.hash = ''

    return url.href
  } catch {
    return null
  }
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url)
}

function isSameHost(url, baseUrl) {
  try {
    const a = new URL(url)
    const b = new URL(baseUrl)

    return a.hostname === b.hostname
  } catch {
    return false
  }
}

function isPdf(url) {
  return /\.pdf(?:$|[?#])/i.test(url)
}

function looksLikeRelevantPage(title, url) {
  const haystack = `${title} ${url}`.toLowerCase()

  return DISCOVERY_PAGE_TERMS.some((term) => haystack.includes(term))
}

function extractPageText(html) {
  return esc(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
}

function findKeywordMatches(text, keywordList) {
  const lower = String(text || '').toLowerCase()

  return keywordList.filter((term) => lower.includes(term))
}

function extractLinks(html, baseUrl) {
  const output = []
  const seen = new Set()

  const regex =
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi

  let match

  while ((match = regex.exec(html)) !== null) {
    const href = normalizeUrl(match[1], baseUrl)

    if (!href || !isHttpUrl(href)) continue

    const title = esc(match[2].replace(/<[^>]+>/g, ' '))

    if (!title) continue

    if (seen.has(href)) continue

    seen.add(href)

    output.push({
      url: href,
      title,
    })

    if (output.length >= MAX_LINKS_PER_PAGE) break
  }

  return output
}

function getContext(text, keyword, radius = 180) {
  const lower = String(text || '').toLowerCase()
  const index = lower.indexOf(keyword.toLowerCase())

  if (index === -1) {
    return ''
  }

  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + keyword.length + radius)

  return esc(text.slice(start, end))
}

async function fetchPage(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent':
          'FoundrymanJobsMonitor/2.0 (+official-source-monitor)',
        accept:
          'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5',
      },
    })

    const contentType = response.headers.get('content-type') || ''

    const buffer = await response.arrayBuffer()

    const body = new TextDecoder('utf-8', {
      fatal: false,
    }).decode(buffer)

    return {
      status: response.status,
      finalUrl: response.url || url,
      contentType,
      body,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function fingerprint(url, title) {
  const data = new TextEncoder().encode(`${url}|${title}`)

  const hash = await crypto.subtle.digest('SHA-256', data)

  return Array.from(new Uint8Array(hash))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function candidateTitle(link) {
  if (link.title) return link.title

  if (isPdf(link.url)) {
    try {
      return decodeURIComponent(link.url.split('/').pop() || 'PDF Notification')
    } catch {
      return 'PDF Notification'
    }
  }

  return 'Potential Foundryman Vacancy'
}

async function insertCandidate({
  source,
  run,
  item,
  matchedKeywords,
  discoveryMatches,
  pageUrl,
  sourceStatus,
  snippet,
}) {
  const title = candidateTitle(item)
  const fp = await fingerprint(item.url, title)

  const payload = {
    source_id: source.id,
    monitoring_run_id: run.id,
    title,
    url: item.url,
    matched_keywords: matchedKeywords.join(', '),
    snippet:
      snippet ||
      `Potential vacancy discovered from ${source.source_name}. Official eligibility and equivalence require manual verification.`,
    source_status: `HTTP ${sourceStatus}`,
    eligibility_status: 'Needs Verification',
    review_status: 'Pending Review',
    fingerprint: fp,
  }

  /*
   * Discovery matches are intentionally included only in the snippet.
   * They do not establish that the post is equivalent to Foundryman.
   */
  if (discoveryMatches.length > 0) {
    payload.snippet =
      `${payload.snippet} Discovery terms: ${discoveryMatches.join(', ')}. ` +
      `Discovered from page: ${pageUrl}`
  }

  try {
    await api('vacancy_candidates', {
      method: 'POST',
      headers: {
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    })

    return true
  } catch (error) {
    const message = String(error.message || '')

    if (
      message.toLowerCase().includes('duplicate') ||
      message.toLowerCase().includes('unique constraint')
    ) {
      return false
    }

    throw error
  }
}

async function main() {
  const sources = await api(
    'source_registry?active=eq.true&select=*&order=priority.asc'
  )

  const runResponse = await api('monitoring_runs', {
    method: 'POST',
    headers: {
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      status: 'Running',
    }),
  })

  const run = runResponse[0]

  let checked = 0
  let pages = 0
  let candidates = 0
  let errors = 0

  for (const source of sources) {
    checked++

    const rootUrl = source.recruitment_url || source.official_url

    try {
      const exactTerms = terms(source.search_keywords)

      const discoveryTerms = Array.from(
        new Set([...exactTerms, ...DISCOVERY_TERMS])
      )

      const queue = [
        {
          url: rootUrl,
          title: source.source_name || 'Official Source',
          depth: 0,
        },
      ]

      const visited = new Set()
      const candidateUrls = new Set()

      let scannedForSource = 0

      while (
        queue.length > 0 &&
        scannedForSource < MAX_PAGES_PER_SOURCE
      ) {
        const current = queue.shift()

        if (!current?.url) continue

        const normalized = normalizeUrl(current.url, rootUrl)

        if (!normalized) continue
        if (visited.has(normalized)) continue

        /*
         * Stay on the official source host.
         * This prevents the monitor from wandering into unrelated domains.
         */
        if (!isSameHost(normalized, rootUrl)) continue

        visited.add(normalized)

        let response

        try {
          response = await fetchPage(normalized)
        } catch (error) {
          console.log(
            `[WARN] ${source.source_name}: ${normalized} -> ${error.message}`
          )
          continue
        }

        scannedForSource++
        pages++

        const contentType = response.contentType.toLowerCase()

        /*
         * PDF:
         * We discover and queue PDF URLs, but do not pretend that raw
         * PDF bytes prove eligibility. The PDF is sent to admin review.
         */
        if (isPdf(normalized) || contentType.includes('application/pdf')) {
          const pdfTitle = candidateTitle({
            url: normalized,
            title: current.title,
          })

          const haystack = `${current.title} ${normalized}`.toLowerCase()

          const exactMatches = exactTerms.filter((term) =>
            haystack.includes(term)
          )

          const discoveryMatches = DISCOVERY_TERMS.filter((term) =>
            haystack.includes(term)
          )

          if (
            exactMatches.length > 0 ||
            discoveryMatches.length > 0 ||
            looksLikeRelevantPage(current.title, normalized)
          ) {
            if (!candidateUrls.has(normalized)) {
              candidateUrls.add(normalized)

              if (candidates < MAX_CANDIDATES_PER_SOURCE) {
                const inserted = await insertCandidate({
                  source,
                  run,
                  item: {
                    url: normalized,
                    title: pdfTitle,
                  },
                  matchedKeywords: exactMatches,
                  discoveryMatches,
                  pageUrl: normalized,
                  sourceStatus: response.status,
                  snippet:
                    `Potential official PDF discovered from ${source.source_name}. ` +
                    `Manual verification is required before publication.`,
                })

                if (inserted) candidates++
              }
            }
          }

          continue
        }

        /*
         * HTML/text page analysis.
         */
        const pageText = extractPageText(response.body)

        const exactMatches = findKeywordMatches(pageText, exactTerms)

        const discoveryMatches = findKeywordMatches(
          pageText,
          discoveryTerms
        )

        /*
         * Extract all links from the current official page.
         */
        const pageLinks = extractLinks(response.body, response.finalUrl)

        /*
         * Candidate links:
         * - exact keyword in title/URL
         * - discovery keyword in title/URL
         * - relevant recruitment/career/notice link
         */
        for (const link of pageLinks) {
          if (candidateUrls.size >= MAX_CANDIDATES_PER_SOURCE) break

          if (!isSameHost(link.url, rootUrl)) continue

          const haystack =
            `${link.title} ${link.url}`.toLowerCase()

          const linkExactMatches = exactTerms.filter((term) =>
            haystack.includes(term)
          )

          const linkDiscoveryMatches = DISCOVERY_TERMS.filter((term) =>
            haystack.includes(term)
          )

          const relevantPageLink = looksLikeRelevantPage(
            link.title,
            link.url
          )

          /*
           * A link is interesting if:
           * 1. exact configured keyword is present, OR
           * 2. discovery keyword is present, OR
           * 3. it looks like a recruitment/career/notice page.
           */
          const interesting =
            linkExactMatches.length > 0 ||
            linkDiscoveryMatches.length > 0 ||
            relevantPageLink

          if (!interesting) continue

          /*
           * If this is a PDF, surface it as a candidate.
           */
          if (isPdf(link.url)) {
            if (candidateUrls.has(link.url)) continue

            candidateUrls.add(link.url)

            const snippet =
              exactMatches.length > 0
                ? getContext(
                    pageText,
                    exactMatches[0]
                  )
                : `Potential official PDF linked from ${source.source_name}.`

            const inserted = await insertCandidate({
              source,
              run,
              item: link,
              matchedKeywords: [
                ...new Set([
                  ...exactMatches,
                  ...linkExactMatches,
                ]),
              ],
              discoveryMatches: [
                ...new Set([
                  ...discoveryMatches,
                  ...linkDiscoveryMatches,
                ]),
              ],
              pageUrl: normalized,
              sourceStatus: response.status,
              snippet,
            })

            if (inserted) candidates++

            continue
          }

          /*
           * HTML recruitment/career pages are queued for deeper scanning.
           */
          if (
            current.depth < 2 &&
            queue.length < MAX_PAGES_PER_SOURCE * 3
          ) {
            queue.push({
              url: link.url,
              title: link.title,
              depth: current.depth + 1,
            })
          }

          /*
           * If the link itself contains an exact Foundryman keyword,
           * surface it immediately as a candidate too.
           */
          if (linkExactMatches.length > 0) {
            if (candidateUrls.has(link.url)) continue

            candidateUrls.add(link.url)

            const snippet =
              exactMatches.length > 0
                ? getContext(pageText, exactMatches[0])
                : `Exact configured keyword found in official link: ${link.title}`

            const inserted = await insertCandidate({
              source,
              run,
              item: link,
              matchedKeywords: [
                ...new Set([
                  ...exactMatches,
                  ...linkExactMatches,
                ]),
              ],
              discoveryMatches: [
                ...new Set([
                  ...discoveryMatches,
                  ...linkDiscoveryMatches,
                ]),
              ],
              pageUrl: normalized,
              sourceStatus: response.status,
              snippet,
            })

            if (inserted) candidates++
          }
        }

        /*
         * If the actual page itself contains an exact configured keyword,
         * create a candidate for that official page when there is no more
         * specific matching link.
         */
        if (
          exactMatches.length > 0 &&
          candidateUrls.size < MAX_CANDIDATES_PER_SOURCE
        ) {
          const pageCandidateUrl = response.finalUrl || normalized

          if (!candidateUrls.has(pageCandidateUrl)) {
            candidateUrls.add(pageCandidateUrl)

            const pageTitle =
              current.title ||
              source.source_name ||
              'Potential Vacancy Page'

            const inserted = await insertCandidate({
              source,
              run,
              item: {
                url: pageCandidateUrl,
                title: pageTitle,
              },
              matchedKeywords: exactMatches,
              discoveryMatches,
              pageUrl: normalized,
              sourceStatus: response.status,
              snippet: getContext(
                pageText,
                exactMatches[0]
              ),
            })

            if (inserted) candidates++
          }
        }
      }

      await api(
        `source_registry?id=eq.${source.id}`,
        {
          method: 'PATCH',
          headers: {
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            last_checked: new Date().toISOString(),
            last_status: `HTTP ${200}`,
            last_error: null,
            updated_at: new Date().toISOString(),
          }),
        }
      )

      console.log(
        `[OK] ${source.source_name}: scanned=${scannedForSource}, candidates=${candidateUrls.size}`
      )
    } catch (error) {
      errors++

      await api(
        `source_registry?id=eq.${source.id}`,
        {
          method: 'PATCH',
          headers: {
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            last_checked: new Date().toISOString(),
            last_status: 'ERROR',
            last_error: String(error.message).slice(0, 500),
            updated_at: new Date().toISOString(),
          }),
        }
      )

      console.error(
        `[ERROR] ${source.source_name}: ${error.message}`
      )
    }
  }

  await api(
    `monitoring_runs?id=eq.${run.id}`,
    {
      method: 'PATCH',
      headers: {
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        finished_at: new Date().toISOString(),
        sources_checked: checked,
        pages_scanned: pages,
        candidates_found: candidates,
        errors_count: errors,
        status: errors === checked ? 'Failed' : 'Completed',
        notes:
          'V5 free-tier source discovery. Official-source pages and candidate links are scanned. Candidates require manual official verification before publication.',
      }),
    }
  )

  console.log(
    JSON.stringify({
      checked,
      pages,
      candidates,
      errors,
    })
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
