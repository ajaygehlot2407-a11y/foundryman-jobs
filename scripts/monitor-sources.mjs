import crypto from "node:crypto";
import { spawn } from "node:child_process";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const REST_URL = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`;

const CONFIG = {
  MAX_PAGES_PER_SOURCE: 4,
  MAX_LINKS_PER_PAGE: 40,
  MAX_PDF_BYTES: 20 * 1024 * 1024,

  SOURCE_TIMEOUT_MS: 12000,
  PAGE_TIMEOUT_MS: 8000,
  CURL_TIMEOUT_SECONDS: 8,

  SOURCE_RETRIES: 1,
  PAGE_RETRIES: 1,

  CONCURRENCY: 10,

  USER_AGENT:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36 " +
    "FoundrymanJobsMonitor/10.7",

  DISCOVERY_TERMS: [
    "foundryman",
    "foundry man",
    "foundry-man",
    "moulder",
    "molder",
    "foundry worker",
    "foundry trade",
    "foundry operator",
    "foundry technician",
    "foundry",
    "moulding",
    "molding",
    "core maker",
    "melter",
    "fettler",
  ],

  STRONG_TERMS: [
    "foundryman",
    "foundry man",
    "foundry-man",
    "moulder",
    "molder",
    "foundry operator",
    "foundry technician",
  ],

  MEDIUM_TERMS: [
    "foundry worker",
    "foundry trade",
  ],

  RECRUITMENT_TERMS: [
    "recruitment",
    "recruit",
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
    "engagement",
    "selection",
    "apprentice",
    "apprenticeship",
    "application",
    "employment",
    "result",
    "trade",
    "iti",
  ],

  QUALIFICATION_TERMS: [
    "iti",
    "ncvt",
    "scvt",
    "ntc",
    "nac",
    "trade qualification",
    "technical qualification",
    "industrial training institute",
  ],

  DEADLINE_PATTERNS: [
    /last\s+date.{0,120}/i,
    /closing\s+date.{0,120}/i,
    /application\s+deadline.{0,120}/i,
    /apply\s+(?:online\s+)?(?:before|by).{0,120}/i,
    /applications?\s+(?:are\s+)?(?:invited|accepted).{0,160}/i,
  ],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanText(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, max = 1200) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatError(error) {
  if (!error) return "Unknown error";

  if (error.name === "AbortError") {
    return "timeout";
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 1000);
  }

  return String(error).slice(0, 1000);
}

function classifyError(error) {
  const message = formatError(error).toLowerCase();
  if (message.includes("timeout") || message.includes("abort")) return "TIMEOUT";
  if (message.includes("http 401") || message.includes("http 403")) return "HTTP_4XX_AUTH";
  if (message.includes("http 404")) return "HTTP_404";
  if (message.includes("http 429")) return "HTTP_429";
  if (message.includes("http 4")) return "HTTP_4XX";
  if (message.includes("http 5")) return "HTTP_5XX";
  if (message.includes("certificate") || message.includes("tls") || message.includes("ssl")) return "TLS_SSL";
  if (message.includes("enotfound") || message.includes("getaddrinfo")) return "DNS";
  if (message.includes("econnrefused")) return "CONNECTION_REFUSED";
  if (message.includes("econnreset")) return "CONNECTION_RESET";
  if (message.includes("pdftotext")) return "PDF_PARSE";
  if (message.includes("pdf exceeds")) return "PDF_TOO_LARGE";
  if (message.includes("curl")) return "CURL";
  return "OTHER";
}

function recordWarning(state, source, url, error, scope = "resource") {
  const message = formatError(error);
  const category = classifyError(error);
  state.warnings += 1;
  state.warningCounts[category] = (state.warningCounts[category] || 0) + 1;

  const key = source?.source_name || "Unknown source";
  state.sourceStats[key] = state.sourceStats[key] || {
    pages: 0,
    errors: 0,
    warnings: 0,
    errorMessages: [],
  };
  state.sourceStats[key].warnings = (state.sourceStats[key].warnings || 0) + 1;

  if (state.sourceStats[key].errorMessages.length < 5) {
    state.sourceStats[key].errorMessages.push({
      category: `WARNING_${category}`,
      url: truncate(url || "", 500),
      message: truncate(message, 500),
    });
  }

  console.log(
    `[WARNING] ${scope} | ${key} | ${category} | ${truncate(url || "", 500)} | ${truncate(message, 500)}`
  );
}

function recordError(state, source, url, error, scope = "resource") {
  const message = formatError(error);
  const category = classifyError(error);
  state.errors += 1;
  state.errorCounts[category] = (state.errorCounts[category] || 0) + 1;
  const key = source?.source_name || "Unknown source";
  state.sourceStats[key] = state.sourceStats[key] || { pages: 0, errors: 0, errorMessages: [] };
  state.sourceStats[key].errors += 1;
  if (state.sourceStats[key].errorMessages.length < 3) {
    state.sourceStats[key].errorMessages.push({ category, url: truncate(url || "", 500), message: truncate(message, 500) });
  }
  console.log("[ERROR] " + scope + " | " + key + " | " + category + " | " + truncate(url || "", 500) + " | " + truncate(message, 500));
}
function isPdfUrl(url = "") {
  const clean = url.split("?")[0].split("#")[0].toLowerCase();
  return clean.endsWith(".pdf");
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url);
}

function normalizeUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return null;
  }
}

function sameHost(urlA, urlB) {
  try {
    return new URL(urlA).hostname.toLowerCase() ===
      new URL(urlB).hostname.toLowerCase();
  } catch {
    return false;
  }
}

function normalizeHost(hostname) {
  return hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .trim();
}

/*
 * IMPORTANT:
 * Do NOT restrict official sources to .gov.in/.nic.in only.
 *
 * Indian PSUs and government organizations may legitimately use:
 * .com
 * .co.in
 * .org
 * .in
 * specialized institutional domains
 *
 * We therefore use the source's own hostname as the boundary.
 */
function sameOfficialSite(url, sourceUrl) {
  try {
    const a = normalizeHost(new URL(url).hostname);
    const b = normalizeHost(new URL(sourceUrl).hostname);

    return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
  } catch {
    return false;
  }
}

function makeFingerprint(sourceId, url, title) {
  return crypto
    .createHash("sha256")
    .update(
      `${sourceId}|${url.trim().toLowerCase()}|${cleanText(title).toLowerCase()}`
    )
    .digest("hex");
}

function makeContentHash(text) {
  return crypto
    .createHash("sha256")
    .update(cleanText(text))
    .digest("hex");
}

function scoreText(text) {
  const lower = cleanText(text).toLowerCase();

  let score = 0;

  if (CONFIG.STRONG_TERMS.some((term) => lower.includes(term))) {
    score += 80;
  }

  if (CONFIG.MEDIUM_TERMS.some((term) => lower.includes(term))) {
    score += 60;
  }

  if (lower.includes("foundry")) score += 15;
  if (lower.includes("iti")) score += 5;
  if (lower.includes("trade")) score += 5;

  return Math.min(score, 100);
}

function findMatchedKeywords(text) {
  const lower = cleanText(text).toLowerCase();

  return CONFIG.DISCOVERY_TERMS.filter((term) =>
    lower.includes(term)
  );
}

function extractContext(text) {
  const clean = cleanText(text);
  const lower = clean.toLowerCase();

  let bestIndex = -1;
  let matchedTerm = "";

  for (const term of CONFIG.DISCOVERY_TERMS) {
    const index = lower.indexOf(term);

    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
      matchedTerm = term;
    }
  }

  if (bestIndex === -1) {
    return "";
  }

  const start = Math.max(0, bestIndex - 500);
  const end = Math.min(clean.length, bestIndex + 1000);

  return truncate(
    `[matched: ${matchedTerm}] ${clean.slice(start, end)}`,
    1600
  );
}

function extractDeadline(text) {
  const clean = cleanText(text);

  for (const pattern of CONFIG.DEADLINE_PATTERNS) {
    const match = clean.match(pattern);

    if (match) {
      return truncate(match[0], 500);
    }
  }

  return "";
}

function extractQualification(text) {
  const clean = cleanText(text);
  const lower = clean.toLowerCase();

  let firstIndex = -1;

  for (const term of CONFIG.QUALIFICATION_TERMS) {
    const index = lower.indexOf(term);

    if (index !== -1 && (firstIndex === -1 || index < firstIndex)) {
      firstIndex = index;
    }
  }

  if (firstIndex === -1) {
    return "";
  }

  const start = Math.max(0, firstIndex - 300);
  const end = Math.min(clean.length, firstIndex + 1000);

  return truncate(clean.slice(start, end), 1400);
}

function detectDocumentType(url, contentType = "") {
  const type = String(contentType).toLowerCase();

  if (isPdfUrl(url) || type.includes("application/pdf")) {
    return "PDF";
  }

  if (type.includes("html")) {
    return "HTML";
  }

  if (type) {
    return type.split(";")[0];
  }

  return "Unknown";
}

function parseHtml(html, pageUrl) {
  const titleMatch =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  const title = cleanText(
    titleMatch ? titleMatch[1].replace(/<[^>]+>/g, " ") : ""
  );

  const text = cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );

  const links = [];

  const anchorRegex =
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = normalizeUrl(match[1], pageUrl);

    if (!href || !isHttpUrl(href)) {
      continue;
    }

    const linkText = cleanText(
      match[2].replace(/<[^>]+>/g, " ")
    );

    links.push({
      url: href,
      text: linkText,
    });

    if (links.length >= CONFIG.MAX_LINKS_PER_PAGE) {
      break;
    }
  }

  return {
    title,
    text,
    links,
  };
}

async function fetchWithNode(url, timeoutMs) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,

      headers: {
        "User-Agent": CONFIG.USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    const contentType =
      response.headers.get("content-type") || "";

    const finalUrl = response.url || url;

    const buffer = Buffer.from(await response.arrayBuffer());

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      finalUrl,
      contentType,
      buffer,
      method: "node-fetch",
    };
  } finally {
    clearTimeout(timer);
  }
}

function runCurl(url) {
  return new Promise((resolve, reject) => {
    const args = [
      "-L",
      "--compressed",
      "--silent",
      "--show-error",
      "--connect-timeout",
      "6",
      "--max-time",
      String(CONFIG.CURL_TIMEOUT_SECONDS),

      "-A",
      CONFIG.USER_AGENT,

      "-H",
      "Accept: text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",

      "-H",
      "Accept-Language: en-IN,en;q=0.9",

      "-w",
      "\n__HTTP_STATUS__:%{http_code}\n__CONTENT_TYPE__:%{content_type}\n__FINAL_URL__:%{url_effective}\n",

      url,
    ];

    const child = spawn("curl", args);

    const chunks = [];
    const errors = [];

    child.stdout.on("data", (data) => chunks.push(data));
    child.stderr.on("data", (data) => errors.push(data));

    child.on("error", reject);

    child.on("close", (code) => {
      const stdout = Buffer.concat(chunks);
      const stderr = Buffer.concat(errors).toString("utf8");

      if (code !== 0 && stdout.length === 0) {
        reject(
          new Error(
            `curl exit ${code}: ${truncate(stderr, 500)}`
          )
        );
        return;
      }

      const text = stdout.toString("utf8");

      const statusMatch = text.match(
        /\n__HTTP_STATUS__:(\d+)\s*$/m
      );

      const contentTypeMatch = text.match(
        /\n__CONTENT_TYPE__:(.*?)\s*$/m
      );

      const finalUrlMatch = text.match(
        /\n__FINAL_URL__:(.*?)\s*$/m
      );

      let bodyEnd = text.length;

      for (const marker of [
        "\n__HTTP_STATUS__:",
        "\n__CONTENT_TYPE__:",
        "\n__FINAL_URL__:",
      ]) {
        const index = text.indexOf(marker);

        if (index !== -1) {
          bodyEnd = Math.min(bodyEnd, index);
        }
      }

      const body = Buffer.from(text.slice(0, bodyEnd));

      const status = statusMatch
        ? Number(statusMatch[1])
        : 0;

      resolve({
        ok: status >= 200 && status < 400,
        status,
        statusText: "",
        finalUrl: finalUrlMatch
          ? finalUrlMatch[1].trim()
          : url,
        contentType: contentTypeMatch
          ? contentTypeMatch[1].trim()
          : "",
        buffer: body,
        method: "curl",
      });
    });
  });
}

async function fetchResource(
  url,
  timeoutMs,
  retries,
  label
) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await fetchWithNode(url, timeoutMs);

      if (
        result.ok &&
        result.buffer &&
        result.buffer.length > 0
      ) {
        return result;
      }

      lastError = new Error(
        `HTTP ${result.status} ${result.statusText || ""}`.trim()
      );

      console.log(
        `[HTTP] ${label} attempt ${attempt}/${retries}: ${lastError.message}`
      );
    } catch (error) {
      lastError = error;

      console.log(
        `[NODE-ERROR] ${label} attempt ${attempt}/${retries}: ${formatError(error)}`
      );
    }

    if (attempt < retries) {
      await sleep(1000 * attempt);
    }
  }

  const lastMessage = formatError(lastError).toLowerCase();
  const shouldTryCurl =
    !lastMessage.includes("timeout") &&
    !lastMessage.includes("abort");

  if (!shouldTryCurl) {
    throw lastError || new Error("fetch timed out");
  }

  console.log(`[CURL] ${label}: trying curl fallback`);

  try {
    const result = await runCurl(url);

    if (
      result.ok &&
      result.buffer &&
      result.buffer.length > 0
    ) {
      console.log(`[CURL-OK] ${label}`);
      return result;
    }

    lastError = new Error(
      `curl HTTP ${result.status || "unknown"}`
    );
  } catch (error) {
    lastError = error;

    console.log(
      `[CURL-ERROR] ${label}: ${formatError(error)}`
    );
  }

  throw lastError || new Error("fetch failed");
}

async function fetchSupabaseJson(
  path,
  options = {},
  label = "Supabase API"
) {
  const url = `${REST_URL}/${path}`;

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "FoundrymanJobsMonitor/10.3",
    ...(options.headers || {}),
  };

  const method = options.method || "GET";
  const body =
    options.body !== undefined
      ? JSON.stringify(options.body)
      : undefined;

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        redirect: "follow",
      });

      const raw = await response.text();

      if (!response.ok) {
        let details = "";

        if (raw.trim()) {
          try {
            const parsed = JSON.parse(raw);

            details =
              parsed?.message ||
              parsed?.error ||
              parsed?.hint ||
              JSON.stringify(parsed);
          } catch {
            details = truncate(raw, 500);
          }
        }

        throw new Error(
          `${label}: HTTP ${response.status} ${response.statusText}` +
          `${details ? ` - ${details}` : ""}`
        );
      }

      if (!raw.trim()) {
        return null;
      }

      const contentType =
        response.headers.get("content-type") || "";

      if (!contentType.toLowerCase().includes("json")) {
        console.log(
          `[SUPABASE-WARN] ${label}: non-JSON response received`
        );

        return null;
      }

      try {
        return JSON.parse(raw);
      } catch (error) {
        throw new Error(
          `${label}: invalid JSON response: ${formatError(error)}`
        );
      }
    } catch (error) {
      lastError = error;

      console.log(
        `[SUPABASE] ${label} attempt ${attempt}/3 failed: ${formatError(error)}`
      );

      if (attempt < 3) {
        await sleep(800 * attempt);
      }
    }
  }

  throw lastError || new Error(`${label}: unknown API failure`);
}

async function supabaseGet(path, label) {
  return fetchSupabaseJson(path, {}, label);
}

async function supabasePost(path, body, label) {
  return fetchSupabaseJson(
    path,
    {
      method: "POST",
      body,
      headers: {
        Prefer: "return=representation",
      },
    },
    label
  );
}

async function supabasePatch(path, body, label) {
  return fetchSupabaseJson(
    path,
    {
      method: "PATCH",
      body,
      headers: {
        Prefer: "return=minimal",
      },
    },
    label
  );
}

function shouldCrawlLink(link) {
  const text = String(link.text || "").toLowerCase();
  const url = String(link.url || "").toLowerCase();
  const combined = text + " " + url;

  const excludedTerms = [
    "result", "results", "applicant-list", "applicant list",
    "answer-key", "answer key", "admit-card", "admit card",
    "scrutiny", "corrigendum", "withdrawal", "cancellation",
    "seniority", "marks", "merit-list", "merit list"
  ];

  if (excludedTerms.some((term) => combined.includes(term))) {
    return false;
  }

  const crawlTerms = [
    "recruitment", "recruit", "vacancy", "vacancies",
    "career", "careers", "job", "jobs", "advertisement",
    "advt", "notification", "engagement", "apprentice",
    "apprenticeship", "application", "employment",
    "foundryman", "foundry man", "foundry-man",
    "moulder", "molder", "foundry worker",
    "foundry trade", "foundry operator", "foundry technician"
  ];

  const documentLike =
    /\\.(pdf|doc|docx)(?:$|[?#])/i.test(url) ||
    url.includes("/uploads/") ||
    url.includes("/documents/") ||
    url.includes("/download/") ||
    url.includes("/downloads/");

  return documentLike || crawlTerms.some((term) => combined.includes(term));
}

function shouldInspectPage(page) {
  const combined =
    `${page.title || ""} ${page.text || ""}`.toLowerCase();

  return (
    CONFIG.DISCOVERY_TERMS.some((term) =>
      combined.includes(term)
    ) ||
    CONFIG.RECRUITMENT_TERMS.some((term) =>
      combined.includes(term)
    )
  );
}

async function extractPdf(buffer, url) {
  if (!buffer || buffer.length === 0) {
    return {
      text: "",
      title: "",
    };
  }

  if (buffer.length > CONFIG.MAX_PDF_BYTES) {
    throw new Error(
      `PDF exceeds ${CONFIG.MAX_PDF_BYTES} byte limit`
    );
  }

  const tempFile =
    `/tmp/foundryman-${crypto.randomUUID()}.pdf`;

  const fs = await import("node:fs/promises");

  await fs.writeFile(tempFile, buffer);

  try {
    const text = await new Promise((resolve, reject) => {
      const child = spawn("pdftotext", [
        "-layout",
        tempFile,
        "-",
      ]);

      const chunks = [];
      const errors = [];

      child.stdout.on("data", (data) => chunks.push(data));
      child.stderr.on("data", (data) => errors.push(data));

      child.on("error", reject);

      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `pdftotext exit ${code}: ${truncate(
                Buffer.concat(errors).toString("utf8"),
                500
              )}`
            )
          );
          return;
        }

        resolve(
          Buffer.concat(chunks).toString("utf8")
        );
      });
    });

    return {
      text: cleanText(text),
      title: url.split("/").pop() || "PDF document",
    };
  } finally {
    await fs.rm(tempFile, { force: true }).catch(() => {});
  }
}

async function processResource(
  resource,
  source,
  state
) {
  const resourceUrl = resource.url;

  const result = await fetchResource(
    resourceUrl,
    resource.isSource
      ? CONFIG.SOURCE_TIMEOUT_MS
      : CONFIG.PAGE_TIMEOUT_MS,
    resource.isSource
      ? CONFIG.SOURCE_RETRIES
      : CONFIG.PAGE_RETRIES,
    `${source.source_name} -> ${resourceUrl}`
  );

  state.pagesScanned += 1;

  const documentType = detectDocumentType(
    resourceUrl,
    result.contentType
  );

  let title = "";
  let text = "";
  let links = [];

  if (documentType === "PDF") {
    const extracted = await extractPdf(
      result.buffer,
      result.finalUrl || resourceUrl
    );

    title = extracted.title;
    text = extracted.text;
  } else {
    const html = result.buffer.toString("utf8");

    const parsed = parseHtml(
      html,
      result.finalUrl || resourceUrl
    );

    title = parsed.title;
    text = parsed.text;
    links = parsed.links;
  }

  if (!text) {
    return {
      title,
      text: "",
      links: [],
      finalUrl: result.finalUrl || resourceUrl,
      documentType,
    };
  }

  const matchedKeywords = findMatchedKeywords(text);

  if (matchedKeywords.length > 0) {
    await maybeCreateCandidate({
      source,
      state,
      url: result.finalUrl || resourceUrl,
      title: title || resource.title || source.source_name,
      text,
      matchedKeywords,
      documentType,
    });
  }

  return {
    title,
    text,
    links,
    finalUrl: result.finalUrl || resourceUrl,
    documentType,
  };
}

async function maybeCreateCandidate({
  source,
  state,
  url,
  title,
  text,
  matchedKeywords,
  documentType,
}) {
  const score = scoreText(text);

  /*
   * Ignore weak generic "foundry" mentions unless there is
   * recruitment context. This prevents menus/footer text from
   * generating useless candidates.
   */
  const recruitmentContext =
    CONFIG.RECRUITMENT_TERMS.some((term) =>
      cleanText(text).toLowerCase().includes(term)
    );

  if (
    score < 60 &&
    !recruitmentContext
  ) {
    return;
  }

  const fingerprint = makeFingerprint(
    source.id,
    url,
    title
  );

  if (state.fingerprints.has(fingerprint)) {
    return;
  }

  state.fingerprints.add(fingerprint);

  const contentHash = makeContentHash(text);

  const candidate = {
    source_id: source.id,
    monitoring_run_id: state.runId,
    discovered_at: new Date().toISOString(),

    title:
      truncate(title, 500) ||
      source.source_name ||
      "Foundryman-related opportunity",

    url,

    matched_keywords:
      matchedKeywords.join(", "),

    snippet:
      extractContext(text) ||
      truncate(text, 1000),

    source_status:
      "Official Source",

    eligibility_status:
      "Needs Verification",

    review_status:
      "Pending Review",

    fingerprint,

    document_type: documentType,

    matched_context:
      extractContext(text),

    confidence_score:
      score,

    deadline_text:
      extractDeadline(text),

    qualification_text:
      extractQualification(text),

    document_title:
      truncate(title, 500),

    content_hash:
      contentHash,

    discovery_method:
      documentType === "PDF"
        ? "official-source-pdf-scan"
        : "official-source-page-scan",

    verification_url:
      url,
  };

  try {
    await supabasePost(
      "vacancy_candidates",
      candidate,
      `candidate insert: ${source.source_name}`
    );

    state.candidatesFound += 1;

    console.log(
      `[CANDIDATE] ${source.source_name} | ${candidate.title} | confidence=${score}`
    );
  } catch (error) {
    /*
     * Duplicate/constraint errors should not stop the complete run.
     */
    const message = formatError(error);

    if (
      message.includes("23505") ||
      message.toLowerCase().includes("duplicate")
    ) {
      console.log(
        `[DUPLICATE] ${source.source_name} | ${url}`
      );
      return;
    }

    console.log(
      `[CANDIDATE-ERROR] ${source.source_name}: ${message}`
    );
  }
}

async function processSource(source, state) {
  const sourceUrls = [
    source.recruitment_url,
    source.official_url,
  ].filter(
    (url, index, array) =>
      isHttpUrl(url) && array.indexOf(url) === index
  );

  if (sourceUrls.length === 0) {
    recordError(
      state,
      source,
      "",
      new Error("No valid official/recruitment URL"),
      "source-config"
    );
    return;
  }

  console.log(
    `\n========== SOURCE: ${source.source_name} ==========`
  );

  const queue = [];
  const queued = new Set();
  const visited = new Set();
  const allowedHosts = new Set(
    sourceUrls.map((url) => normalizeHost(new URL(url).hostname))
  );

  const addQueue = (url, title = "", isSource = false) => {
    if (!url || !isHttpUrl(url)) return;

    const normalized = url.split("#")[0];

    if (queued.has(normalized) || visited.has(normalized)) {
      return;
    }

    try {
      const host = normalizeHost(new URL(normalized).hostname);
      const allowed = [...allowedHosts].some(
        (base) => host === base || host.endsWith(`.${base}`) || base.endsWith(`.${host}`)
      );

      if (!allowed) return;
    } catch {
      return;
    }

    queued.add(normalized);

    queue.push({
      url: normalized,
      title,
      isSource,
    });
  };

  for (const url of sourceUrls) {
    addQueue(
      url,
      url === source.recruitment_url ? "Recruitment" : source.source_name,
      true
    );
  }

  let localPages = 0;
  let localErrors = 0;
  let localWarnings = 0;

  state.sourceStats[source.source_name] = state.sourceStats[source.source_name] || {
    pages: 0,
    errors: 0,
    warnings: 0,
    errorMessages: [],
  };

  while (
    queue.length > 0 &&
    localPages < CONFIG.MAX_PAGES_PER_SOURCE
  ) {
    const resource = queue.shift();

    if (visited.has(resource.url)) {
      continue;
    }

    visited.add(resource.url);

    try {
      const result = await processResource(
        resource,
        source,
        state
      );

      localPages += 1;
      state.sourceStats[source.source_name].pages += 1;

      console.log(
        `[PAGE] ${source.source_name}: ${localPages}/${CONFIG.MAX_PAGES_PER_SOURCE} | ${result.finalUrl}`
      );

      if (
        result.links &&
        result.links.length > 0 &&
        localPages < CONFIG.MAX_PAGES_PER_SOURCE
      ) {
        const prioritizedLinks = result.links
          .filter((link) => shouldCrawlLink(link))
          .sort((a, b) => {
            const rank = (link) => {
              const value = `${link.text || ""} ${link.url || ""}`.toLowerCase();
              let score = 0;

              if (/foundryman|foundry[ -]?man|moulder|molder/.test(value)) score += 100;
              if (/foundry|apprentice|vacancy|recruitment|advertisement|notification/.test(value)) score += 60;
              if (/\\.(pdf|doc|docx)(?:$|[?#])/.test(String(link.url || ""))) score += 40;
              if (/uploads|documents|download/.test(String(link.url || "").toLowerCase())) score += 20;

              return score;
            };

            return rank(b) - rank(a);
          });

        for (const link of prioritizedLinks) {
          addQueue(
            link.url,
            link.text,
            false
          );

          if (
            queue.length >= CONFIG.MAX_LINKS_PER_PAGE
          ) {
            break;
          }
        }
      }
    } catch (error) {
      if (resource.isSource) {
        localErrors += 1;
        recordError(
          state,
          source,
          resource.url,
          error,
          "source"
        );
      } else {
        localWarnings += 1;
        recordWarning(
          state,
          source,
          resource.url,
          error,
          "child-link"
        );
      }
    }
  }

  const sourceStat = state.sourceStats[source.source_name];
  const sourceErrorText = sourceStat?.errorMessages?.length
    ? sourceStat.errorMessages
        .slice(0, 5)
        .map(
          (item) =>
            `[${item.category}] ${item.message} | ${item.url}`
        )
        .join(" || ")
    : null;

  try {
    await supabasePatch(
      `source_registry?id=eq.${encodeURIComponent(source.id)}`,
      {
        last_checked: new Date().toISOString(),
        last_status:
          localErrors > 0
            ? "Error"
            : localWarnings > 0
              ? "OK with warnings"
              : "OK",
        last_error: sourceErrorText
          ? truncate(sourceErrorText, 1000)
          : null,
      },
      `source update: ${source.source_name}`
    );
  } catch (error) {
    console.log(
      `[SOURCE-UPDATE-WARN] ${source.source_name}: ${formatError(error)}`
    );
  }

  console.log(
    `[SOURCE-RESULT] ${source.source_name}: pages=${localPages}, errors=${localErrors}, warnings=${localWarnings}`
  );
}

async function runWithConcurrency(
  items,
  worker,
  concurrency
) {
  let index = 0;

  async function runner(workerId) {
    while (true) {
      const currentIndex = index++;

      if (currentIndex >= items.length) {
        return;
      }

      const item = items[currentIndex];

      try {
        await worker(item, currentIndex);
      } catch (error) {
        console.log(
          `[WORKER-${workerId}-ERROR] ${formatError(error)}`
        );
      }
    }
  }

  const workers = [];

  const count = Math.min(
    concurrency,
    items.length
  );

  for (let i = 0; i < count; i++) {
    workers.push(runner(i + 1));
  }

  await Promise.all(workers);
}

async function main() {
  console.log("==============================================");
  console.log("FOUNDRYMAN VACANCY MONITOR V10.7");
  console.log("Fast profile: bounded crawl + timeout-aware fallback");
  console.log("==============================================");
  console.log(
    `Max pages/source: ${CONFIG.MAX_PAGES_PER_SOURCE}`
  );
  console.log(
    `Concurrency: ${CONFIG.CONCURRENCY}`
  );
  console.log(
    `Source timeout: ${CONFIG.SOURCE_TIMEOUT_MS}ms`
  );
  console.log(
    `Page timeout: ${CONFIG.PAGE_TIMEOUT_MS}ms`
  );

  let sources;

  try {
    sources = await supabaseGet(
      "source_registry?active=eq.true&select=*&order=priority.asc",
      "load active sources"
    );
  } catch (error) {
    console.error(
      `[FATAL] Could not load source registry: ${formatError(error)}`
    );

    process.exit(1);
  }

  if (!Array.isArray(sources)) {
    console.error(
      "[FATAL] Source registry response was not an array"
    );

    process.exit(1);
  }

  console.log(
    `[REGISTRY] Active sources: ${sources.length}`
  );

  const startedAt = new Date().toISOString();

  let run;

  try {
    const inserted = await supabasePost(
      "monitoring_runs",
      {
        started_at: startedAt,
        status: "Running",
        sources_checked: 0,
        pages_scanned: 0,
        candidates_found: 0,
        errors_count: 0,
        notes: "V10.7 foundry-link prioritization monitor",
      },
      "create monitoring run"
    );

    run = Array.isArray(inserted)
      ? inserted[0]
      : inserted;

  } catch (error) {
    console.error(
      `[FATAL] Could not create monitoring run: ${formatError(error)}`
    );

    process.exit(1);
  }

  if (!run?.id) {
    console.error(
      "[FATAL] monitoring_runs did not return a run ID"
    );

    process.exit(1);
  }

  const state = {
    runId: run.id,
    pagesScanned: 0,
    candidatesFound: 0,
    errors: 0,
    warnings: 0,
    errorCounts: {},
    warningCounts: {},
    sourceStats: {},
    fingerprints: new Set(),
  };

  await runWithConcurrency(
    sources,
    async (source) => {
      await processSource(source, state);
    },
    CONFIG.CONCURRENCY
  );

  const finishedAt = new Date().toISOString();

  try {
    await supabasePatch(
      `monitoring_runs?id=eq.${encodeURIComponent(run.id)}`,
      {
        finished_at: finishedAt,
        status: "Completed",

        sources_checked:
          sources.length,

        pages_scanned:
          state.pagesScanned,

        candidates_found:
          state.candidatesFound,

        errors_count:
          state.errors,

        notes:
          `V10.2 completed. ` +
          `Sources=${sources.length}; ` +
          `Pages=${state.pagesScanned}; ` +
          `Candidates=${state.candidatesFound}; ` +
          `Errors=${state.errors}; ` +
          `ErrorBreakdown=${JSON.stringify(state.errorCounts)}`,
      },
      "finish monitoring run"
    );
  } catch (error) {
    console.error(
      `[RUN-UPDATE-ERROR] ${formatError(error)}`
    );
  }

  console.log("\n==============================================");
  console.log("MONITORING COMPLETED");
  console.log("==============================================");

  const summary = {
    checked: sources.length,
    pages: state.pagesScanned,
    candidates: state.candidatesFound,
    errors: state.errors,
    warnings: state.warnings,
    errorBreakdown: state.errorCounts,
    warningBreakdown: state.warningCounts,
  };

  console.log(JSON.stringify(summary));

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const fs = await import("node:fs/promises");
    const breakdown = Object.entries(state.errorCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => "| " + key + " | " + value + " |")
      .join("\n") || "| None | 0 |";

    const failedSources = Object.entries(state.sourceStats)
      .filter(([, value]) => value.errors > 0)
      .sort((a, b) => b[1].errors - a[1].errors)
      .slice(0, 20)
      .map(([name, value]) => {
        const details = value.errorMessages
          .map((item) => item.category + ": " + item.message)
          .join(" ; ");
        return "| " + name.replace(/\|/g, "/") + " | " + value.pages + " | " + value.errors + " | " + details.replace(/\|/g, "/") + " |";
      })
      .join("\n") || "| None | 0 | 0 | |";

    await fs.appendFile(
      summaryPath,
      "## Foundryman V10.2 monitor\n\n" +
      "| Metric | Value |\n|---|---:|\n" +
      "| Sources checked | " + summary.checked + " |\n" +
      "| Pages scanned | " + summary.pages + " |\n" +
      "| Candidates found | " + summary.candidates + " |\n" +
      "| Errors | " + summary.errors + " |\n\n" +
      "### Error breakdown\n\n| Type | Count |\n|---|---:|\n" + breakdown + "\n\n" +
      "### Sources with errors (top 20)\n\n| Source | Pages | Errors | Details |\n|---|---:|---:|---|\n" + failedSources + "\n"
    );
  }

  console.log("==============================================");
}

main().catch((error) => {
  console.error(
    `[FATAL] ${formatError(error)}`
  );

  process.exit(1);
});
