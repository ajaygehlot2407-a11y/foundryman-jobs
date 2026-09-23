import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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

const REQUEST_TIMEOUT_MS = 20000
const MAX_FETCH_RETRIES = 2
const MAX_PAGES_PER_SOURCE = 5
const MAX_LINKS_PER_PAGE = 50
const MAX_CANDIDATES_PER_SOURCE = 25

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
    return new URL(url).hostname === new URL(baseUrl).hostname
  } catch {
    return false
  }
}

function isPdf(url) {
  return /\.pdf(?:$|[?#])/i.test(url)
}

function looksLikeRelevantPage(title, url) {
  const haystack = `${title} ${url}`.toLowerCase()

  return DISCOVERY_PAGE_TERMS.some((term) =>
    haystack.includes(term)
  )
}

function extractPageText(html) {
  return esc(
    String(html || '')
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

    const title = esc(
      match[2].replace(/<[^>]+>/g, ' ')
    )

    if (!title || seen.has(href)) continue

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
  const source = String(text || '')
  const lower = source.toLowerCase()
  const index = lower.indexOf(keyword.toLowerCase())

  if (index === -1) return ''

  const start = Math.max(0, index - radius)
  const end = Math.min(
    source.length,
    index + keyword.length + radius
  )

  return esc(source.slice(start, end))
}

async function fetchWithNode(url) {
  let lastError

  for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
    const controller = new AbortController()

    const timer = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    )

    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (compatible; FoundrymanJobsMonitor/2.0)',
          accept:
            'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5',
        },
      })

      const contentType =
        response.headers.get('content-type') || ''

      const body = await response.text()

      return {
        status: response.status,
        finalUrl: response.url || url,
        contentType,
        body,
        method: 'node-fetch',
      }
    } catch (error) {
      lastError = error

      console.log(
        `[RETRY] ${url} attempt ${attempt}/${MAX_FETCH_RETRIES}: ${error.message}`
      )

      if (attempt < MAX_FETCH_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1500)
        )
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError || new Error('fetch failed')
}

async function fetchWithCurl(url) {
  const args = [
    '-L',
    '--silent',
    '--show-error',
    '--max-time',
    '20',
    '--connect-timeout',
    '10',
    '-A',
    'Mozilla/5.0 (compatible; FoundrymanJobsMonitor/2.0)',
    '-H',
    'Accept: text/html,application/xhtml+xml,text/plain,*/*;q=0.8',
    '-w',
    '\n__STATUS__:%{http_code}\n__FINAL_URL__:%{url_effective}\n__CONTENT_TYPE__:%{content_type}\n',
    url,
  ]

  const result = await execFileAsync(
    'curl',
    args,
    {
      maxBuffer: 10 * 1024 * 1024,
    }
  )

  const output = result.stdout || ''

  const statusMatch =
    output.match(/__STATUS__:(\d+)/)

  const finalUrlMatch =
    output.match(/__FINAL_URL__:(.*)/)

  const contentTypeMatch =
    output.match(/__CONTENT_TYPE__:(.*)/)

  const body = output
    .replace(/\n__STATUS__:\d+\n[\s\S]*$/, '')

  return {
    status: Number(statusMatch?.[1] || 0),
    finalUrl: esc(finalUrlMatch?.[1] || url),
    contentType: esc(contentTypeMatch?.[1] || ''),
    body,
    method: 'curl',
  }
}

async function fetchPage(url) {
  try {
    return await fetchWithNode(url)
  } catch (nodeError) {
    console.log(
      `[FALLBACK] Node fetch failed for ${url}: ${nodeError.message}`
    )

    try {
      return await fetchWithCurl(url)
    } catch (curlError) {
      throw new Error(
        `Node fetch: ${nodeError.message}; curl: ${curlError.message}`
      )
    }
  }
}

async function fingerprint(url, title) {
  const data = new TextEncoder().encode(
    `${url}|${title}`
  )

  const hash = await crypto.subtle.digest(
    'SHA-256',
    data
  )

  return Array.from(new Uint8Array(hash))
    .map((value) =>
      value.toString(16).padStart(2, '0')
    )
    .join('')
}

function candidateTitle(item) {
  if (item.title) return item.title

  if (isPdf(item.url)) {
    try {
      return (
        decodeURIComponent(
          item.url.split('/').pop() || ''
        ) || 'PDF Notification'
      )
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

  if (discoveryMatches.length > 0) {
    payload.snippet +=
      ` Discovery terms: ${discoveryMatches.join(', ')}.`
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
    const message = String(error.message || '').toLowerCase()

    if (
      message.includes('duplicate') ||
      message.includes('unique constraint')
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

    const rootUrl =
      source.recruitment_url || source.official_url

    let sourcePages = 0
    let sourceCandidates = 0

    try {
      const exactTerms = terms(source.search_keywords)

      const discoveryTerms = Array.from(
        new Set([
          ...exactTerms,
          ...DISCOVERY_TERMS,
        ])
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

      while (
        queue.length > 0 &&
        sourcePages < MAX_PAGES_PER_SOURCE
      ) {
        const current = queue.shift()

        const normalized =
          normalizeUrl(current.url, rootUrl)

        if (!normalized) continue
        if (visited.has(normalized)) continue
        if (!isSameHost(normalized, rootUrl)) continue

        visited.add(normalized)

        let response

        try {
          response = await fetchPage(normalized)
        } catch (error) {
          console.log(
            `[ERROR] ${source.source_name}: ${normalized} -> ${error.message}`
          )

          throw error
        }

        sourcePages++
        pages++

        const contentType =
          response.contentType.toLowerCase()

        /*
         * PDF URLs are discovered from links.
         * We do not parse arbitrary PDF bytes here.
         */
        if (
          isPdf(normalized) ||
          contentType.includes('application/pdf')
        ) {
          const haystack =
            `${current.title} ${normalized}`.toLowerCase()

          const exactMatches =
            exactTerms.filter((term) =>
              haystack.includes(term)
            )

          const discoveryMatches =
            DISCOVERY_TERMS.filter((term) =>
              haystack.includes(term)
            )

          if (
            exactMatches.length > 0 ||
            discoveryMatches.length > 0 ||
            looksLikeRelevantPage(
              current.title,
              normalized
            )
          ) {
            if (
              !candidateUrls.has(normalized) &&
              sourceCandidates <
                MAX_CANDIDATES_PER_SOURCE
            ) {
              candidateUrls.add(normalized)

              const inserted =
                await insertCandidate({
                  source,
                  run,
                  item: {
                    url: normalized,
                    title: candidateTitle({
                      url: normalized,
                      title: current.title,
                    }),
                  },
                  matchedKeywords: exactMatches,
                  discoveryMatches,
                  pageUrl: normalized,
                  sourceStatus: response.status,
                  snippet:
                    `Potential official PDF discovered from ${source.source_name}. ` +
                    `Manual verification is required before publication.`,
                })

              if (inserted) {
                candidates++
                sourceCandidates++
              }
            }
          }

          continue
        }

        const pageText =
          extractPageText(response.body)

        const exactMatches =
          findKeywordMatches(
            pageText,
            exactTerms
          )

        const discoveryMatches =
          findKeywordMatches(
            pageText,
            discoveryTerms
          )

        const pageLinks =
          extractLinks(
            response.body,
            response.finalUrl
          )

        for (const link of pageLinks) {
          if (
            candidateUrls.size >=
            MAX_CANDIDATES_PER_SOURCE
          ) {
            break
          }

          if (!isSameHost(link.url, rootUrl)) {
            continue
          }

          const haystack =
            `${link.title} ${link.url}`.toLowerCase()

          const linkExactMatches =
            exactTerms.filter((term) =>
              haystack.includes(term)
            )

          const linkDiscoveryMatches =
            DISCOVERY_TERMS.filter((term) =>
              haystack.includes(term)
            )

          const relevantPageLink =
            looksLikeRelevantPage(
              link.title,
              link.url
            )

          const interesting =
            linkExactMatches.length > 0 ||
            linkDiscoveryMatches.length > 0 ||
            relevantPageLink

          if (!interesting) continue

          /*
           * PDF candidate
           */
          if (isPdf(link.url)) {
            if (candidateUrls.has(link.url)) {
              continue
            }

            candidateUrls.add(link.url)

            const inserted =
              await insertCandidate({
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
                snippet:
                  `Potential official PDF linked from ${source.source_name}. ` +
                  `Manual verification is required before publication.`,
              })

            if (inserted) {
              candidates++
              sourceCandidates++
            }

            continue
          }

          /*
           * Queue relevant HTML pages for deeper scanning.
           */
          if (
            current.depth < 2 &&
            queue.length <
              MAX_PAGES_PER_SOURCE * 3
          ) {
            queue.push({
              url: link.url,
              title: link.title,
              depth: current.depth + 1,
            })
          }

          /*
           * Exact keyword in link.
           */
          if (
            linkExactMatches.length > 0 &&
            !candidateUrls.has(link.url)
          ) {
            candidateUrls.add(link.url)

            const inserted =
              await insertCandidate({
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
                snippet:
                  getContext(
                    pageText,
                    linkExactMatches[0]
                  ) ||
                  `Exact configured keyword found in official link: ${link.title}`,
              })

            if (inserted) {
              candidates++
              sourceCandidates++
            }
          }
        }

        /*
         * Exact keyword on current page.
         */
        if (
          exactMatches.length > 0 &&
          !candidateUrls.has(response.finalUrl) &&
          sourceCandidates <
            MAX_CANDIDATES_PER_SOURCE
        ) {
          candidateUrls.add(response.finalUrl)

          const inserted =
            await insertCandidate({
              source,
              run,
              item: {
                url: response.finalUrl,
                title:
                  current.title ||
                  source.source_name ||
                  'Potential Vacancy Page',
              },
              matchedKeywords: exactMatches,
              discoveryMatches,
              pageUrl: normalized,
              sourceStatus: response.status,
              snippet:
                getContext(
                  pageText,
                  exactMatches[0]
                ),
            })

          if (inserted) {
            candidates++
            sourceCandidates++
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
            last_checked:
              new Date().toISOString(),
            last_status:
              `HTTP scan completed`,
            last_error: null,
            updated_at:
              new Date().toISOString(),
          }),
        }
      )

      console.log(
        `[OK] ${source.source_name}: ` +
          `pages=${sourcePages}, ` +
          `candidates=${sourceCandidates}`
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
            last_checked:
              new Date().toISOString(),
            last_status: 'ERROR',
            last_error:
              String(error.message).slice(0, 500),
            updated_at:
              new Date().toISOString(),
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
        finished_at:
          new Date().toISOString(),
        sources_checked: checked,
        pages_scanned: pages,
        candidates_found: candidates,
        errors_count: errors,
        status:
          errors === checked
            ? 'Failed'
            : 'Completed',
        notes:
          'V6 free-tier source monitor with retry and curl fallback. Candidates require manual official verification before publication.',
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
