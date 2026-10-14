/* Matson Time Assistant — Vercel Function */
/* Sections: Configuration, System instruction, Schema, Input validation, Gemini request, Response validation, Handler */

/* ========== 1. Configuration ========== */
const MAX_BODY_SIZE = 64 * 1024;
const MAX_MESSAGE_LENGTH = 2000;
const REQUEST_TIMEOUT_MS = 15000;
const TIMEZONE = "Africa/Kampala";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL;
/* ========== 2. System Instruction ========== */
const GEMINI_SYSTEM_INSTRUCTION = `You are the natural-language interpretation and conversational reasoning component of Matson Time, a private personal time-management application.

You operate Matson's personal time-management calendar. Interpret requests using only the supplied message and request context: currentDate (the supplied localDate), currentTime, timezone, availableCategories, relevantItems, pendingClarification, allowedActions, and compactFacts. Never treat this as business reservation management.

SCHEDULING INTENT
Words such as reserve, block, set aside, schedule, add, plan, book time for, make time for, put on my calendar, put in my schedule, and remind me to are ordinary personal schedule-management language. Do not reject them because they can mean something else outside this app. Infer the supported action from the whole request. Prefer create_item for a new commitment, activity, task, or explicitly recurring routine. Do not return no_action for a request that clearly maps to an allowed action. Use no_action only for unrelated requests or requests that cannot safely map to an allowed action, and explain briefly what you could not map.

Ask a clarification only when a genuinely required value is missing. Do not ask for information already provided by the message or context. A new activity needs an exact date, start, and end time; a task needs a title and date but no times; a routine is appropriate only when recurrence is explicitly requested. Do not invent exact times for vague periods such as morning, afternoon, or evening. Ask one concise question for the missing exact time or times. A routine may have a start time with no end time when no duration was given.

DATE INTERPRETATION
Treat supplied currentDate as the authoritative local calendar date (the localDate described in these instructions); use the supplied timezone, normally Africa/Kampala. today is currentDate; tomorrow is one local calendar day after it. Friday means the next appropriate Friday from currentDate; next Friday means Friday in the following week. this evening is currentDate. tomorrow morning means tomorrow's local date, but ask for an exact time when needed. Resolve dates by local calendar arithmetic, never by UTC conversion that could shift the date. Return dates as YYYY-MM-DD.

TIME INTERPRETATION
Convert 2 PM to 14:00, 5 PM to 17:00, 7 in the morning to 07:00, noon to 12:00, and midnight to 00:00. “From 2 to 5 PM” normally means 14:00 to 17:00. “From 2 PM to 5 PM” supplies both exact times. Return times as 24-hour HH:mm.

ITEM TYPE AND TITLE
Use activity for a commitment occupying a specific time period, task for something to do without a specified time period, and routine only when recurrence is explicit. Make a short clean title from the user's actual wording: “studio session” becomes “Studio session”; “send Raymond the files” becomes “Send Raymond the files”; “rehearsal” becomes “Rehearsal”. Do not use the entire request as the title or invent people, locations, or details. Use only supplied existing item IDs. When one relevant item uniquely matches an edit or reschedule, use its supplied ID. For a reschedule with a new start but no new end, preserve the item's existing duration if it is supplied; otherwise ask for the missing end time.

CATEGORY
Choose a category only when the match is clear from availableCategories: studio session, rehearsal, practice, or playlist → Music; gym or exercise → Health; meeting or call → Meetings. Otherwise use Personal, the application's safe default category. Do not reject a valid action because category certainty is low.

You do not directly modify schedule data.

For every schedule write, return a structured proposed_action with requiresConfirmation true. The application validates and shows it to Matson for confirmation. Never claim an action was completed, saved, moved, cancelled, or deleted.

Return clarification with one concise question when a required schedule detail is genuinely missing. Return answer for conversational schedule questions only when supported by supplied facts. Return error only when processing cannot continue.

For schedule answers, use only supplied schedule facts and items. Never invent an activity, ID, date, status, conflict, completion, or time.

If multiple existing items may match, request clarification rather than choosing one.

Do not mark an item completed merely because its scheduled time passed.

Do not resolve conflicts automatically.

Do not suggest a replacement time unless Matson explicitly asks for scheduling help.

Do not create routines unless Matson requests recurrence.

Do not add locations, links, attachments, guests, or unsupported fields.

Keep user-facing messages concise, useful, and practical. A no_action message must say what part could not be mapped; do not expose technical details.

FEW-SHOT EXAMPLES
Use these as interpretation examples. Dates in each example follow its supplied currentDate and timezone; do not reuse example dates for other requests.

Example A — explicit new activity:
Context: localDate 2026-10-14; timezone Africa/Kampala; categories Music, Health, Personal, Meetings, Travel.
User: “Reserve tomorrow from 2 PM to 5 PM for a studio session.”
Return:
{
  "kind": "proposed_action",
  "message": "Add a studio session tomorrow from 2:00 PM to 5:00 PM?",
  "requiresConfirmation": true,
  "action": {
    "type": "create_item",
    "targetId": null,
    "item": {
      "type": "activity",
      "title": "Studio session",
      "date": "2026-10-15",
      "start": "14:00",
      "end": "17:00",
      "category": "Music",
      "notes": "",
      "recurrence": null
    },
    "changes": null,
    "postponeMinutes": null
  },
  "pendingClarification": null
}

Example B — untimed task:
Context: currentDate 2026-10-14; timezone Africa/Kampala.
User: “Remind me to send Raymond the files tomorrow.”
Interpret as proposed_action / create_item, with type task, title “Send Raymond the files”, date 2026-10-15, start and end null, category Personal, notes empty, recurrence null, and confirmation required. Do not ask for a time.

Example C — explicitly recurring routine:
Context: currentDate 2026-10-14; timezone Africa/Kampala; categories include Health.
User: “Add gym every Monday at 7 AM.”
Interpret as proposed_action / create_item, with type routine, title “Gym”, date 2026-10-19 (the next Monday), start 07:00, end null, category Health, and recurrence {"frequency":"weekly","days":[1],"interval":1}. Require confirmation.

Example D — reschedule a uniquely supplied item:
Context: currentDate 2026-10-14; timezone Africa/Kampala; relevantItems contains exactly one matching item {"id":"item-123","title":"Call Raymond","type":"activity","date":"2026-10-14","start":"17:00","end":"17:30","category":"Meetings","notes":"","status":"upcoming"}.
User: “Move Raymond’s call to 4 PM tomorrow.”
Interpret as proposed_action / reschedule_item, use targetId "item-123", and set the item's date to 2026-10-15, start to 16:00, and end to 16:30 by preserving its supplied 30-minute duration. Do not invent or replace the supplied ID. Require confirmation.

Example E — vague activity time:
Context: currentDate 2026-10-14; timezone Africa/Kampala.
User: “Block Friday afternoon for practice.”
Return clarification asking for the exact start and end times. Friday is 2026-10-16. Do not invent times; keep action null and requiresConfirmation false.

Example F — unrelated request:
User: “What is the capital of France?”
Return no_action with a concise explanation that this request is unrelated to Matson's schedule and that you can help manage the calendar. Keep action and pendingClarification null; do not answer the general-knowledge question.

Return only a response matching the provided JSON schema.`;

/* ========== 3. Structured Response Schema ========== */
const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["answer", "clarification", "proposed_action", "no_action", "error"] },
    message: { type: "STRING" },
    requiresConfirmation: { type: "BOOLEAN" },
    action: {
      type: "OBJECT",
      nullable: true,
      properties: {
        type: { type: "STRING", enum: ["create_item", "update_item", "reschedule_item", "postpone_item", "complete_item", "mark_missed", "cancel_item"] },
        targetId: { type: "STRING", nullable: true },
        item: {
          type: "OBJECT",
          nullable: true,
          properties: {
            type: { type: "STRING", enum: ["activity", "task", "routine"] },
            title: { type: "STRING" },
            date: { type: "STRING", nullable: true },
            start: { type: "STRING", nullable: true },
            end: { type: "STRING", nullable: true },
            category: { type: "STRING" },
            notes: { type: "STRING" },
            recurrence: {
              type: "OBJECT",
              nullable: true,
              properties: {
                frequency: { type: "STRING", enum: ["daily", "weekly", "monthly"] },
                days: { type: "ARRAY", items: { type: "INTEGER" } },
                interval: { type: "INTEGER" }
              },
              required: ["frequency", "days", "interval"]
            }
          },
          required: ["type", "title", "date", "start", "end", "category", "notes", "recurrence"]
        },
        changes: {
          type: "OBJECT",
          nullable: true,
          properties: {
            title: { type: "STRING", nullable: true },
            date: { type: "STRING", nullable: true },
            start: { type: "STRING", nullable: true },
            end: { type: "STRING", nullable: true },
            category: { type: "STRING", nullable: true },
            notes: { type: "STRING", nullable: true },
            status: { type: "STRING", nullable: true, enum: ["upcoming", "in-progress", "overdue", "completed", "missed", "cancelled", "postponed", "awaiting-check-in"] }
          },
          required: ["title", "date", "start", "end", "category", "notes", "status"]
        },
        postponeMinutes: { type: "INTEGER", nullable: true }
      },
      required: ["type", "targetId", "item", "changes", "postponeMinutes"]
    },
    pendingClarification: {
      type: "OBJECT",
      nullable: true,
      properties: {
        intent: { type: "STRING", enum: ["create_item", "update_item", "reschedule_item", "postpone_item", "complete_item", "mark_missed", "cancel_item"] },
        knownFields: {
          type: "OBJECT",
          properties: {
            type: { type: "STRING", nullable: true, enum: ["activity", "task", "routine"] },
            title: { type: "STRING", nullable: true },
            date: { type: "STRING", nullable: true },
            start: { type: "STRING", nullable: true },
            end: { type: "STRING", nullable: true },
            category: { type: "STRING", nullable: true },
            notes: { type: "STRING", nullable: true },
            recurrence: { type: "OBJECT", nullable: true, properties: { frequency: { type: "STRING", enum: ["daily", "weekly", "monthly"] }, days: { type: "ARRAY", items: { type: "INTEGER" } }, interval: { type: "INTEGER" } } },
            targetId: { type: "STRING", nullable: true },
            postponeMinutes: { type: "INTEGER", nullable: true }
          }
        },
        missingFields: { type: "ARRAY", items: { type: "STRING" } }
      },
      required: ["intent", "knownFields", "missingFields"]
    }
  },
  required: ["kind", "message", "requiresConfirmation", "action", "pendingClarification"]
};

/* ========== 4. Input Validation ========== */
function validateRequest(body) {
  if (!body || typeof body !== "object") return "Invalid request body";
  if (!body.message || typeof body.message !== "string") return "Message is required";
  if (body.message.length > MAX_MESSAGE_LENGTH) return "Message too long";
  if (body.context !== undefined && (!Array.isArray(body.context) || body.context.some(item => !item || typeof item !== "object" || Array.isArray(item)))) return "Invalid context";
  if (body.pendingClarification !== undefined && body.pendingClarification !== null && (typeof body.pendingClarification !== "object" || Array.isArray(body.pendingClarification))) return "Invalid pendingClarification";
  return null;
}

/* Context is built from the supplied schedule only. */
function isAnalyticalQuery(message) {
  const patterns = [/which day.*least busy/i, /when can i fit/i, /which activities.*postponed/i, /summarize my week/i, /do i have enough time/i, /busiest day/i, /least busy/i, /free time/i, /availability/i];
  return patterns.some(p => p.test(message));
}

function classifyError(geminiError) {
  if (!geminiError || !geminiError.error) return "unknown";
  const err = geminiError.error.toLowerCase();
  if (err.includes("auth") || err.includes("403") || err.includes("permission") || err.includes("api key")) return "authentication";
  if (err.includes("model") || err.includes("404") || err.includes("not found")) return "model_unavailable";
  if (err.includes("quota") || err.includes("429") || err.includes("rate limit")) return "quota";
  if (err.includes("400") || err.includes("malformed") || err.includes("invalid request") || err.includes("schema")) return "request_format";
  if (err.includes("timeout") || err.includes("abort")) return "timeout";
  if (err.includes("json") || err.includes("parse")) return "response_parsing";
  if (err.includes("safety") || err.includes("finishreason")) return "safety_refusal";
  return "unknown";
}

/* ========== 5. Context Builders ========== */
function getCurrentLocalDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

function getCurrentLocalTime() {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}

function buildRequestContext(message, scheduleItems, pendingClarification, compactFacts) {
  return {
    message: message.trim(),
    currentDate: getCurrentLocalDate(),
    currentTime: getCurrentLocalTime(),
    timezone: TIMEZONE,
    availableItemTypes: ["activity", "task", "routine"],
    availableCategories: ["Music", "Health", "Personal", "Meetings", "Travel"],
    allowedActions: ["create_item", "update_item", "reschedule_item", "postpone_item", "complete_item", "mark_missed", "cancel_item"],
    pendingClarification: pendingClarification,
    relevantItems: scheduleItems.map(item => ({
      id: item.id, title: item.title, type: item.type, date: item.date,
      start: item.start || null, end: item.end || null,
      category: item.category, notes: item.notes, status: item.status,
      postponed: item.postponed || 0, recurrence: item.recurrence || null
    })),
    compactFacts: compactFacts
  };
}

function buildAnalyticalContext(message, scheduleItems) {
  const today = getCurrentLocalDate();
  const weekItems = scheduleItems.filter(i => i.date && i.date >= today);
  const dailyMinutes = {};
  for (const item of weekItems) {
    if (!item.start || !item.end) continue;
    const [sh, sm] = item.start.split(":").map(Number);
    const [eh, em] = item.end.split(":").map(Number);
    dailyMinutes[item.date] = (dailyMinutes[item.date] || 0) + (eh * 60 + em) - (sh * 60 + sm);
  }
  const postponementCounts = {};
  for (const item of scheduleItems) {
    if ((item.postponed || 0) > 0) postponementCounts[item.title] = (postponementCounts[item.title] || 0) + item.postponed;
  }
  const conflicts = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(getCurrentLocalDate() + "T00:00:00Z"); date.setUTCDate(date.getUTCDate() + i);
    const dateStr = date.toISOString().slice(0, 10);
    const timed = scheduleItems.filter(i => i.date === dateStr && i.start && i.end && i.status !== "completed" && i.status !== "cancelled").sort((a, b) => a.start.localeCompare(b.start));
    if (timed.length > 1 && timed[1].start < timed[0].end) conflicts.push({ date: dateStr, items: [timed[0].title, timed[1].title] });
  }
  return { dailyMinutes, postponementCounts, conflicts, dateRange: { start: today, end: weekItems.length ? weekItems[weekItems.length - 1].date : today } };
}

/* ========== 5. Gemini Request ========== */
async function callGemini(requestContext) {
  const configError = validateConfig();
  if (configError) return { error: "Configuration error", category: "missing_environment_configuration" };

  let serializedContext;
  try {
    serializedContext = JSON.stringify(requestContext);
  } catch (error) {
    logAssistantStageFailure("json-serialization", error, requestContext);
    return { error: "Request serialization failed", category: "invalid_request" };
  }

  let url;
  let payload;
  try {
    url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(GEMINI_MODEL) + ":generateContent?key=" + GEMINI_API_KEY;
    payload = {
      systemInstruction: { parts: [{ text: GEMINI_SYSTEM_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: serializedContext }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: GEMINI_RESPONSE_SCHEMA, temperature: 0.1, maxOutputTokens: 1024 }
    };
  } catch (error) {
    logAssistantStageFailure("gemini-request-body-construction", error, requestContext);
    return { error: "Request construction failed", category: "invalid_request" };
  }

  let serializedPayload;
  try {
    serializedPayload = JSON.stringify(payload);
  } catch (error) {
    logAssistantStageFailure("json-serialization", error, requestContext);
    return { error: "Request serialization failed", category: "invalid_request" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: serializedPayload, signal: controller.signal });
  } catch (error) {
    clearTimeout(timeoutId);
    logAssistantStageFailure("gemini-fetch", error, requestContext);
    return { error: error?.name === "AbortError" ? "Timeout" : "Network error", details: "Failed to reach the language service.", category: error?.name === "AbortError" ? "timeout" : "invalid_request" };
  }
  clearTimeout(timeoutId);

  let responseBody;
  try {
    responseBody = await response.text();
  } catch (error) {
    logAssistantStageFailure("gemini-response-body-reading", error, requestContext);
    return { error: "Response reading failed", category: "invalid_gemini_response" };
  }

  let data;
  try {
    data = JSON.parse(responseBody);
  } catch (error) {
    logAssistantStageFailure("gemini-response-parsing", error, requestContext);
    if (response.ok) return { error: "Invalid response", details: "The language service returned malformed JSON.", category: "invalid_gemini_response" };
    data = {};
  }

  if (!response.ok) {
    const providerError = data?.error || {};
    const providerMessage = typeof providerError.message === "string" ? providerError.message : "";
    const category = classifyGeminiFailure(response.status, providerMessage);
    const safeErrorMessage = sanitizeGeminiErrorMessage(providerMessage, requestContext);
    console.error("Gemini request failed", {
      model: GEMINI_MODEL,
      status: response.status,
      errorCode: safeProviderCode(providerError.code),
      errorStatus: safeProviderStatus(providerError.status),
      category,
      message: safeErrorMessage || category
    });
    if (response.status === 429) return { error: "Gemini quota exceeded", details: "Rate limit reached. Please try again later.", category };
    if (response.status === 400) return { error: "Invalid request", details: "The request to the language service was malformed.", category };
    if (response.status === 401 || response.status === 403) return { error: "Authentication failed", details: "The API key is invalid or lacks permissions.", category };
    return { error: "Language service error", details: "Service returned " + response.status, category };
  }

  if (!data.candidates || !data.candidates.length) return { error: "Empty response", details: "The language service returned no candidates.", category: "invalid_gemini_response" };
  const candidate = data.candidates[0];
  if (candidate.finishReason === "SAFETY") return { error: "Safety refusal", details: "The request was declined by safety filters.", category: "invalid_gemini_response" };
  const content = candidate.content?.parts?.[0]?.text;
  if (!content) return { error: "Empty content", details: "The language service returned empty content.", category: "invalid_gemini_response" };
  let parsed;
  try { parsed = JSON.parse(content); } catch (error) {
    logAssistantStageFailure("gemini-response-parsing", error, requestContext);
    return { error: "Invalid JSON", details: "The language service returned malformed JSON.", category: "invalid_gemini_response" };
  }
  return { response: parsed };
}

function classifyGeminiFailure(status, message) {
  const text = String(message || "").toLowerCase();
  if (status === 401 || status === 403 || /api key|authentication|unauthorized|permission denied/.test(text)) return "authentication";
  if (status === 404 || /model.{0,30}(not found|unavailable|does not exist)/.test(text)) return "unavailable_model";
  if (status === 429 || /quota|resource_exhausted|rate limit/.test(text)) return "quota";
  if (/schema|response.?format/.test(text) && /unsupported|not supported|invalid|unknown/.test(text)) return "unsupported_json_schema";
  if (status === 400) return "invalid_request";
  return "gemini_http_error";
}

function safeProviderCode(value) {
  return typeof value === "number" || (typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value)) ? value : undefined;
}

function safeProviderStatus(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
}

function sanitizeGeminiErrorMessage(message, requestContext) {
  if (!message) return "";
  let safe = message.slice(0, 300);
  if (GEMINI_API_KEY) safe = safe.split(GEMINI_API_KEY).join("[redacted]");
  const privateValues = [];
  function collectPrivateValues(value) {
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value);
      if (text.length >= 2) privateValues.push(text);
      return;
    }
    if (Array.isArray(value)) { value.forEach(collectPrivateValues); return; }
    if (value && typeof value === "object") Object.values(value).forEach(collectPrivateValues);
  }
  collectPrivateValues(requestContext);
  for (const value of privateValues) safe = safe.split(value).join("[redacted]");
  return safe;
}

function logAssistantStageFailure(stage, error, privateData) {
  const privateMessage = sanitizeGeminiErrorMessage(String(error?.message || error), privateData || {});
  console.error("Assistant stage failed", {
    stage,
    name: error?.name || "Error",
    message: privateMessage || "Unexpected error"
  });
}

/* ========== 6. Gemini Response Validation ========== */
function validateGeminiResponse(response, suppliedItems) {
  if (!response || typeof response !== "object") return "Invalid response format";
  if (typeof response.message !== "string") return "Invalid response message";
  if (!["answer", "clarification", "proposed_action", "no_action", "error"].includes(response.kind)) return "Unsupported response kind";
  if (response.kind === "proposed_action") {
    if (!response.action) return "Missing action";
    if (!["create_item", "update_item", "reschedule_item", "postpone_item", "complete_item", "mark_missed", "cancel_item"].includes(response.action.type)) return "Unsupported action type";
    if (!response.requiresConfirmation) return "Proposed action must require confirmation";
    if (response.action.type !== "create_item" && !response.action.targetId) return "Missing target ID";
    if (response.action.targetId && !suppliedItems.some(item => item.id === response.action.targetId)) return "Target ID was not supplied";
    if (response.action.targetId && !response.action.item) return "Invalid target";
    if (response.action.item) {
      const item = response.action.item;
      if (!["activity", "task", "routine"].includes(item.type)) return "Invalid item type";
      if (!item.title || !item.title.trim()) return "Title is required";
      if (item.date && !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return "Invalid date format";
      if (item.start && !/^\d{2}:\d{2}$/.test(item.start)) return "Invalid start time format";
      if (item.end && !/^\d{2}:\d{2}$/.test(item.end)) return "Invalid end time format";
      if (item.start && item.end && item.start >= item.end) return "End time must be after start time";
    }
  }
  return null;
}

/* ========== 7. Vercel Request Handler ========== */
function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function validateConfig() {
  return GEMINI_API_KEY && GEMINI_MODEL ? null : "not_configured";
}

module.exports = async function handler(req, res) {
  console.log("Assistant request reached function", { method: req.method });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { kind: "error", message: "Method not allowed." });
    return;
  }
  console.log("Assistant configuration", {
    model: process.env.GEMINI_MODEL || "missing",
    hasApiKey: Boolean(process.env.GEMINI_API_KEY)
  });
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
    sendJson(res, 415, { kind: "error", message: "Send a JSON request." });
    return;
  }
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_BODY_SIZE) {
    sendJson(res, 413, { kind: "error", message: "Request is too large." });
    return;
  }

  let body;
  try {
  body = req.body;
  if (Buffer.isBuffer(body)) {
    if (body.length > MAX_BODY_SIZE) { sendJson(res, 413, { kind: "error", message: "Request is too large." }); return; }
    try { body = JSON.parse(body.toString("utf8")); } catch (error) { logAssistantStageFailure("request-body-validation", error, body.toString("utf8")); body = null; }
  } else if (typeof body === "string") {
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_SIZE) { sendJson(res, 413, { kind: "error", message: "Request is too large." }); return; }
    try { body = JSON.parse(body); } catch (error) { logAssistantStageFailure("request-body-validation", error, body); body = null; }
  }
  if (!body && req.rawBody) {
    const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody));
    if (raw.length > MAX_BODY_SIZE) { sendJson(res, 413, { kind: "error", message: "Request is too large." }); return; }
    try { body = JSON.parse(raw.toString("utf8")); } catch (error) { logAssistantStageFailure("request-body-validation", error, raw.toString("utf8")); body = null; }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    sendJson(res, 400, { kind: "error", message: "Invalid JSON request." });
    return;
  }
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BODY_SIZE) {
    sendJson(res, 413, { kind: "error", message: "Request is too large." });
    return;
  }
  const validationError = validateRequest(body);
  if (validationError) { sendJson(res, 400, { kind: "error", message: validationError + "." }); return; }
  } catch (error) {
    logAssistantStageFailure("request-body-validation", error, body);
    sendJson(res, 400, { kind: "error", message: "Invalid JSON request." });
    return;
  }
  if (validateConfig()) {
    console.error("Assistant request failed", {
      category: "missing_environment_configuration",
      model: GEMINI_MODEL || "missing",
      hasApiKey: Boolean(GEMINI_API_KEY)
    });
    sendJson(res, 503, { kind: "error", message: "The schedule language service is not connected in this preview." });
    return;
  }

  try {
    const message = body.message.trim();
    const contextItems = Array.isArray(body.context) ? body.context : [];
    let requestContext;
    try {
      requestContext = buildRequestContext(message, contextItems, body.pendingClarification || null, body.compactFacts || null);
      if (isAnalyticalQuery(message)) requestContext = buildRequestContext(message, contextItems, body.pendingClarification || null, buildAnalyticalContext(message, contextItems));
    } catch (error) {
      logAssistantStageFailure("gemini-request-body-construction", error, body);
      sendJson(res, 502, { kind: "error", message: "Unable to process that request right now." });
      return;
    }

    let result;
    try {
      result = await callGemini(requestContext);
    } catch (error) {
      logAssistantStageFailure("gemini-fetch", error, requestContext);
      sendJson(res, 502, { kind: "error", message: "Unable to process that request right now." });
      return;
    }
    if (result.error) {
      if (result.category !== "missing_environment_configuration") {
        console.error("Assistant request failed", { category: result.category || "invalid_request" });
      }
      sendJson(res, 502, { kind: "error", message: "Unable to process that request right now." });
      return;
    }
    let response = result.response;
    let responseError;
    try {
      responseError = validateGeminiResponse(response, contextItems);
    } catch (error) {
      logAssistantStageFailure("normalized-response-validation", error, requestContext);
      sendJson(res, 502, { kind: "error", message: "Unable to process that request right now." });
      return;
    }
    if (responseError) {
      console.error("Assistant request failed", { category: "invalid_gemini_response", reason: responseError });
      sendJson(res, 502, { kind: "error", message: "Unable to process that request right now." });
      return;
    }
    sendJson(res, 200, response);
  } catch (error) {
    logAssistantStageFailure("normalized-response-validation", error, body);
    sendJson(res, 500, { kind: "error", message: "Unable to process that request right now." });
  }
};
