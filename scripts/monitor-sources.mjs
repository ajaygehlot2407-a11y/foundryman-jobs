import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const API = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;

const HEADERS = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json"
};

const MAX_PAGES_PER_SOURCE = 5;
const MAX_LINKS_PER_PAGE = 60;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const REQUEST_TIMEOUT = 25000;

const DISCOVERY_TERMS = [
  "foundryman",
  "foundry man",
  "moulder",
  "molder",
  "foundry worker",
  "foundry trade",
  "foundry"
];

const CONTEXT_TERMS = [
  "foundryman",
  "foundry man",
  "moulder",
  "molder",
  "foundry worker",
  "foundry trade",
  "foundry"
];

const RECRUITMENT_TERMS = [
  "recruitment",
  "recruitment notice",
  "recruitment notification",
  "vacancy",
  "vacancies",
  "career",
  "careers",
  "job",
  "jobs",
  "advertisement",
  "advt",
  "notification",
  "notice",
  "apprentice",
  "apprenticeship",
  "engagement",
  "selection",
  "trade test",
  "technical"
];

const HIGH_CONFIDENCE_TERMS = [
  "foundryman",
  "foundry man",
  "moulder",
  "molder"
];

const MEDIUM_CONFIDENCE_TERMS = [
  "foundry worker",
  "foundry trade"
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase();
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function formatError(error) {
  if (!error) return "Unknown error";

  return cleanText(
    error?.stack ||
    error?.message ||
    error?.toString() ||
    "Unknown error"
  ).slice(0, 1000);
}

function sameHost(a, b) {
  try {
    return new URL(a).hostname === new URL(b).hostname;
  } catch {
    return false;
  }
}

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function isPdf(url) {
  return /\.pdf(?:$|[?#])/i.test(url);
}

function isAllowedOfficialHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();

    return (
      /\.gov\.in$/.test(host) ||
      /\.nic\.in$/.test(host) ||
      /\.ac\.in$/.test(host) ||
      /\.edu\.in$/.test(host) ||
      /\.org\.in$/.test(host) ||
      host === "gov.in" ||
      host === "nic.in"
    );
  } catch {
    return false;
  }
}

function containsAny(text, terms) {
  const value = normalize(text);
  return terms.some(term => value.includes(term));
}

function extractMatchedKeywords(text) {
  const value = normalize(text);

  return [...new Set(
    DISCOVERY_TERMS.filter(term => value.includes(term))
  )];
}

function confidenceFor(text) {
  const value = normalize(text);

  let score = 0;

  if (HIGH_CONFIDENCE_TERMS.some(t => value.includes(t))) {
    score += 80;
  }

  if (MEDIUM_CONFIDENCE_TERMS.some(t => value.includes(t))) {
    score += 60;
  }

  if (value.includes("foundry")) {
    score += 15;
  }

  if (value.includes("iti")) {
    score += 5;
  }

  if (value.includes("trade")) {
    score += 5;
  }

  return Math.min(score, 100);
}

function extractContext(text) {
  const compact = cleanText(text);
  const lower = compact.toLowerCase();

  let bestIndex = -1;
  let bestTerm = "";

  for (const term of CONTEXT_TERMS) {
    const index = lower.indexOf(term);

    if (index >= 0 && (bestIndex < 0 || index < bestIndex)) {
      bestIndex = index;
      bestTerm = term;
    }
  }

  if (bestIndex < 0) {
    return "";
  }

  const start = Math.max(0, bestIndex - 300);
  const end = Math.min(
    compact.length,
    bestIndex + bestTerm.length + 500
  );

  return compact.slice(start, end);
}

function extractDeadline(text) {
  const value = cleanText(text);

  const patterns = [
    /last\s+date.{0,100}/i,
    /last\s+date\s+of\s+application.{0,100}/i,
    /closing\s+date.{0,100}/i,
    /apply\s+before.{0,100}/i,
    /application\s+deadline.{0,100}/i,
    /applications?\s+must\s+be\s+submitted.{0,100}/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match) {
      return match[0].slice(0, 250);
    }
  }

  return "";
}

function extractQualification(text) {
  const value = cleanText(text);

  const patterns = [
    /ITI.{0,250}/i,
    /Industrial Training Institute.{0,250}/i,
    /NCVT.{0,250}/i,
    /SCVT.{0,250}/i,
    /National Apprenticeship Certificate.{0,250}/i,
    /NAC.{0,250}/i,
    /NTC.{0,250}/i,
    /trade qualification.{0,250}/i,
    /technical qualification.{0,250}/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match) {
      return match[0].slice(0, 500);
    }
  }

  return "";
}

function extractLinks(html, pageUrl) {
  const results = [];
  const regex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const rawTitle = match[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ");

    const title = cleanText(rawTitle);
    const url = absoluteUrl(href, pageUrl);

    if (!url) continue;

    results.push({
      url,
      title
    });
  }

  return results;
}

function pageText(html) {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
  );
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 Foundryman-Jobs-India-Monitor/10.0",
        Accept:
          "text/html,application/xhtml+xml,application/pdf,*/*",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;

      if (attempt < 3) {
        console.log(
          `[RETRY] ${url} attempt=${attempt + 1}`
        );
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError;
}

async function fetchBinary(url) {
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length > MAX_PDF_BYTES) {
    throw new Error(
      `PDF exceeds ${MAX_PDF_BYTES} byte limit`
    );
  }

  return buffer;
}

function extractPdfText(buffer) {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "foundryman-pdf-")
  );

  const pdfPath = path.join(tempDir, "document.pdf");
  const txtPath = path.join(tempDir, "document.txt");

  try {
    fs.writeFileSync(pdfPath, buffer);

    execFileSync(
      "pdftotext",
      ["-layout", pdfPath, txtPath],
      {
        timeout: 30000,
        maxBuffer: 20 * 1024 * 1024
      }
    );

    return fs.readFileSync(txtPath, "utf8");
  } finally {
    try {
      fs.rmSync(tempDir, {
        recursive: true,
        force: true
      });
    } catch {}
  }
}

async function api(pathname, options = {}) {
  const response = await fetchWithTimeout(
    `${API}${pathname}`,
    {
      ...options,
      headers: {
        ...HEADERS,
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase HTTP ${response.status}: ${text.slice(0, 1000)}`
    );
  }

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function loadSources() {
  return await api(
    "/source_registry?active=eq.true&select=*&order=priority.asc"
  );
}

async function createMonitoringRun() {
  const result = await api(
    "/monitoring_runs",
    {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        started_at: new Date().toISOString(),
        sources_checked: 0,
        pages_scanned: 0,
        candidates_found: 0,
        errors_count: 0,
        status: "Running",
        notes: "V10 HTML + PDF document monitor"
      })
    }
  );

  return Array.isArray(result) ? result[0] : result;
}

async function updateRun(runId, data) {
  await api(
    `/monitoring_runs?id=eq.${encodeURIComponent(runId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(data)
    }
  );
}

async function updateSource(sourceId, data) {
  await api(
    `/source_registry?id=eq.${encodeURIComponent(sourceId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(data)
    }
  );
}

async function existingFingerprint(fingerprint) {
  const rows = await api(
    `/vacancy_candidates?fingerprint=eq.${encodeURIComponent(
      fingerprint
    )}&select=id,duplicate_of_vacancy_id&limit=1`
  );

  return Array.isArray(rows) && rows.length
    ? rows[0]
    : null;
}

async function insertCandidate(payload) {
  return await api(
    "/vacancy_candidates",
    {
      method: "POST",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify(payload)
    }
  );
}

function candidateFingerprint(sourceId, url, title) {
  return sha256(
    `${sourceId}|${normalize(url)}|${normalize(title)}`
  );
}

async function processDocument({
  source,
  runId,
  url,
  title,
  text,
  documentType
}) {
  const cleaned = cleanText(text);

  if (!cleaned) return false;

  if (!containsAny(cleaned, DISCOVERY_TERMS)) {
    return false;
  }

  const matchedKeywords = extractMatchedKeywords(cleaned);

  const context = extractContext(cleaned);

  const confidence = confidenceFor(
    `${title} ${cleaned.slice(0, 15000)}`
  );

  const deadline = extractDeadline(cleaned);

  const qualification = extractQualification(cleaned);

  const fingerprint = candidateFingerprint(
    source.id,
    url,
    title
  );

  const contentHash = sha256(
    cleaned.slice(0, 100000)
  );

  const duplicate = await existingFingerprint(
    fingerprint
  );

  if (duplicate) {
    return false;
  }

  const payload = {
    source_id: source.id,
    monitoring_run_id: runId,
    discovered_at: new Date().toISOString(),

    title:
      cleanText(title) ||
      "Foundryman-related recruitment document",

    url,

    matched_keywords:
      matchedKeywords.join(", "),

    snippet:
      context.slice(0, 1000),

    source_status:
      "Official Source",

    eligibility_status:
      "Needs Verification",

    review_status:
      "Pending Review",

    duplicate_of_vacancy_id:
      null,

    fingerprint,

    document_type:
      documentType,

    matched_context:
      context,

    confidence_score:
      confidence,

    deadline_text:
      deadline,

    qualification_text:
      qualification,

    document_title:
      cleanText(title),

    content_hash:
      contentHash,

    discovery_method:
      documentType === "PDF"
        ? "PDF document scan"
        : "HTML page scan",

    verification_url:
      url
  };

  await insertCandidate(payload);

  return true;
}

async function processSource(source, runId) {
  const startUrl =
    source.recruitment_url ||
    source.official_url;

  if (!startUrl) {
    throw new Error("No official/recruitment URL");
  }

  const visited = new Set();
  const queue = [startUrl];

  let pagesScanned = 0;
  let candidates = 0;

  while (
    queue.length &&
    visited.size < MAX_PAGES_PER_SOURCE
  ) {
    const current = queue.shift();

    if (!current || visited.has(current)) {
      continue;
    }

    if (!sameHost(current, startUrl)) {
      continue;
    }

    if (!isAllowedOfficialHost(current)) {
      continue;
    }

    visited.add(current);

    try {
      if (isPdf(current)) {
        const buffer = await fetchBinary(current);
        const text = extractPdfText(buffer);

        const found = await processDocument({
          source,
          runId,
          url: current,
          title:
            current.split("/").pop() ||
            "Official PDF notification",
          text,
          documentType: "PDF"
        });

        if (found) candidates++;

        continue;
      }

      const html = await fetchText(current);

      pagesScanned++;

      const text = pageText(html);

      const pageFound = await processDocument({
        source,
        runId,
        url: current,
        title: source.source_name,
        text,
        documentType: "HTML"
      });

      if (pageFound) candidates++;

      const links = extractLinks(
        html,
        current
      );

      for (const link of links.slice(
        0,
        MAX_LINKS_PER_PAGE
      )) {
        if (!sameHost(link.url, startUrl)) {
          continue;
        }

        if (!isAllowedOfficialHost(link.url)) {
          continue;
        }

        const searchable =
          `${link.title} ${link.url}`;

        const recruitmentLike =
          containsAny(
            searchable,
            RECRUITMENT_TERMS
          );

        const pdfLike =
          isPdf(link.url);

        const foundryLike =
          containsAny(
            searchable,
            DISCOVERY_TERMS
          );

        if (
          pdfLike ||
          recruitmentLike ||
          foundryLike
        ) {
          if (!visited.has(link.url)) {
            queue.push(link.url);
          }
        }
      }

    } catch (error) {
      console.log(
        `[PAGE ERROR] ${source.source_name}: ${current}: ${formatError(error)}`
      );
    }
  }

  return {
    pagesScanned,
    candidates
  };
}

async function main() {
  console.log("==============================================");
  console.log("Foundryman Jobs India — V10 Monitor");
  console.log("HTML + PDF Document Intelligence");
  console.log("==============================================");

  const run = await createMonitoringRun();

  if (!run?.id) {
    throw new Error(
      "Could not create monitoring_runs record"
    );
  }

  const runId = run.id;

  let sources;

  try {
    sources = await loadSources();
  } catch (error) {
    await updateRun(runId, {
      finished_at: new Date().toISOString(),
      status: "Failed",
      errors_count: 1,
      notes: formatError(error)
    });

    throw error;
  }

  let sourcesChecked = 0;
  let pagesScanned = 0;
  let candidatesFound = 0;
  let errorsCount = 0;

  console.log(
    `[SOURCES] ${sources.length}`
  );

  for (const source of sources) {
    sourcesChecked++;

    console.log(
      `\n[START] ${source.source_name}`
    );

    try {
      const result = await processSource(
        source,
        runId
      );

      pagesScanned += result.pagesScanned;
      candidatesFound += result.candidates;

      await updateSource(source.id, {
        last_checked:
          new Date().toISOString(),
        last_error:
          null
      });

      console.log(
        `[OK] ${source.source_name}: pages=${result.pagesScanned}, candidates=${result.candidates}`
      );

    } catch (error) {
      errorsCount++;

      const message = formatError(error);

      console.log(
        `[ERROR] ${source.source_name}: ${message}`
      );

      try {
        await updateSource(source.id, {
          last_checked:
            new Date().toISOString(),
          last_error:
            message
        });
      } catch (updateError) {
        console.log(
          `[SOURCE UPDATE ERROR] ${formatError(updateError)}`
        );
      }
    }
  }

  await updateRun(runId, {
    finished_at:
      new Date().toISOString(),

    sources_checked:
      sourcesChecked,

    pages_scanned:
      pagesScanned,

    candidates_found:
      candidatesFound,

    errors_count:
      errorsCount,

    status:
      "Completed",

    notes:
      "V10 HTML + PDF document intelligence monitor"
  });

  console.log("\n==============================================");
  console.log("MONITORING SUMMARY");
  console.log("==============================================");

  console.log(
    JSON.stringify({
      checked: sourcesChecked,
      pages: pagesScanned,
      candidates: candidatesFound,
      errors: errorsCount
    })
  );

  console.log("Monitoring completed");
}

main().catch(error => {
  console.error(
    `[FATAL] ${formatError(error)}`
  );
  process.exit(1);
});
