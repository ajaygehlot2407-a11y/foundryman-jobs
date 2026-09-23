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

const DIRECTORY_SOURCES = [
  {
    name: 'NCS Government Job Vacancies Directory',
    url: 'https://www.ncs.gov.in/pages/govt-job-vacancies.aspx',
    type: 'Government Directory',
    method: 'ncs-government-jobs',
  },
  {
    name: 'NCS Government Portals Directory',
    url: 'https://ncs.gov.in/devPortalList',
    type: 'Government Directory',
    method: 'ncs-government-portals',
  },
]

const ALLOWED_HOST_PATTERNS = [
  /\.gov\.in$/i,
  /\.nic\.in$/i,
  /\.ac\.in$/i,
  /\.edu\.in$/i,
  /\.org\.in$/i,
  /^psu/i,
]

const DISCOVERY_KEYWORDS = [
  'recruitment',
  'career',
  'careers',
  'vacancy',
  'vacancies',
  'job',
  'jobs',
  'employment',
  'advertisement',
  'advt',
  'notification',
  'notice',
  'apprentice',
  'apprenticeship',
  'engagement',
  'selection',
]

const REQUEST_TIMEOUT_MS = 25000

async function api(path, options = {}) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {}),
      },
    }
  )

  if (!response.ok) {
    throw new Error(
      `${response.status} ${await response.text()}`
    )
  }

  return response.status === 204
    ? null
    : response.json()
}

async function fetchText(url) {
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
          'Mozilla/5.0 (compatible; FoundrymanSourceDiscovery/1.0)',
        accept:
          'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return {
      finalUrl: response.url || url,
      body: await response.text(),
    }
  } finally {
    clearTimeout(timer)
  }
}

function normalizeUrl(raw, base) {
  try {
    const url = new URL(raw, base)
    url.hash = ''

    if (!/^https?:$/i.test(url.protocol)) {
      return null
    }

    return url.href
  } catch {
    return null
  }
}

function allowedHost(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase()

    return ALLOWED_HOST_PATTERNS.some((pattern) =>
      pattern.test(hostname)
    )
  } catch {
    return false
  }
}

function looksRelevant(url, title = '') {
  const haystack =
    `${title} ${url}`.toLowerCase()

  return DISCOVERY_KEYWORDS.some((keyword) =>
    haystack.includes(keyword)
  )
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractLinks(html, baseUrl) {
  const links = []
  const seen = new Set()

  const regex =
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi

  let match

  while ((match = regex.exec(html)) !== null) {
    const url = normalizeUrl(match[1], baseUrl)

    if (!url || !allowedHost(url)) {
      continue
    }

    if (seen.has(url)) {
      continue
    }

    seen.add(url)

    links.push({
      url,
      title: cleanTitle(match[2]),
    })
  }

  return links
}

function makeSourceKey(url) {
  return `discovered|${url.toLowerCase()}`
}

async function upsertSource({
  url,
  title,
  directory,
}) {
  const sourceName =
    title ||
    new URL(url).hostname

  const recruitmentUrl =
    looksRelevant(url, title)
      ? url
      : url

  const payload = {
    source_name:
      sourceName.slice(0, 250),
    official_url: url,
    recruitment_url: recruitmentUrl,
    search_keywords:
      'recruitment,career,vacancy,job,employment,notification,apprentice,foundryman,moulder,molder',
    active: true,
    priority: 30,
    source_type:
      directory.type,
    organization_name:
      sourceName.slice(0, 250),
    discovery_method:
      directory.method,
    source_key:
      makeSourceKey(url),
  }

  try {
    await api('source_registry', {
      method: 'POST',
      headers: {
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    })

    return true
  } catch (error) {
    const message =
      String(error.message || '').toLowerCase()

    if (
      message.includes('duplicate') ||
      message.includes('unique constraint') ||
      message.includes('already exists') ||
      message.includes('23505')
    ) {
      return false
    }

    throw error
  }
}

async function main() {
  const existing =
    await api(
      'source_registry?select=official_url'
    )

  const existingUrls =
    new Set(
      existing
        .map((row) =>
          String(row.official_url || '')
            .toLowerCase()
            .replace(/\/$/, '')
        )
        .filter(Boolean)
    )

  let discovered = 0
  let inserted = 0
  let skipped = 0
  let errors = 0

  for (const directory of DIRECTORY_SOURCES) {
    console.log(
      `\n=== ${directory.name} ===`
    )

    let result

    try {
      result = await fetchText(
        directory.url
      )
    } catch (error) {
      errors++
      console.error(
        `[DIRECTORY ERROR] ${directory.url}: ${error.message}`
      )
      continue
    }

    const links =
      extractLinks(
        result.body,
        result.finalUrl
      )

    console.log(
      `[DISCOVERED LINKS] ${links.length}`
    )

    for (const link of links) {
      if (
        !looksRelevant(
          link.url,
          link.title
        )
      ) {
        continue
      }

      discovered++

      const normalized =
        link.url
          .toLowerCase()
          .replace(/\/$/, '')

      if (
        existingUrls.has(normalized)
      ) {
        skipped++
        continue
      }

      try {
        const wasInserted =
          await upsertSource({
            url: link.url,
            title: link.title,
            directory,
          })

        if (wasInserted) {
          inserted++
          existingUrls.add(
            normalized
          )

          console.log(
            `[ADDED] ${link.title || link.url}`
          )
        } else {
          skipped++
        }
      } catch (error) {
        errors++

        console.error(
          `[INSERT ERROR] ${link.url}: ${error.message}`
        )
      }
    }
  }

  console.log('\n=== SOURCE DISCOVERY SUMMARY ===')
  console.log(
    JSON.stringify({
      discovered,
      inserted,
      skipped,
      errors,
    })
  )
}

main().catch((error) => {
  console.error(
    `[FATAL] ${error.message}`
  )
  process.exit(1)
})