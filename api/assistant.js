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

Your responsibility is to understand Matson's schedule request using only the supplied message, current local date, current local time, Africa/Kampala timezone, available categories, relevant schedule items, pending clarification state, allowed actions, and calculated schedule facts.

You do not directly modify schedule data.

For schedule changes, return a structured proposed action that the application can validate and show to Matson for confirmation.

For missing required information, return one concise clarification question.

For schedule answers, use only supplied schedule facts and items. Never invent an activity, ID, date, status, conflict, or completion.

Never claim that an action was completed, saved, moved, cancelled, or deleted. The application performs actions only after Matson confirms.

Resolve relative dates from the supplied local date.

Use the Africa/Kampala timezone.

Return dates as YYYY-MM-DD.

Return times as 24-hour HH:mm.

Use only supplied existing item IDs.

If multiple existing items may match, request clarification rather than choosing one.

Do not mark an item completed merely because its scheduled time passed.

Do not resolve conflicts automatically.

Do not suggest a replacement time unless Matson explicitly asks for scheduling help.

Do not create routines unless Matson requests recurrence.

Do not add locations, links, attachments, guests, or unsupported fields.

Keep user-facing messages concise and practical.

Return only a response matching the provided JSON schema.`;

/* ========== 3. Structured Response Schema ========== */
const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["answer", "clarification", "proposed_action", "no_action", "error"] },
    message: { type: "string" },
    requiresConfirmation: { type: "boolean" },
    action: {
      type: ["object", "null"],
      properties: {
        type: { type: "string", enum: ["create_item", "update_item", "reschedule_item", "postpone_item", "complete_item", "mark_missed", "cancel_item"] },
        targetId: { type: ["string", "null"] },
        item: {
          type: ["object", "null"],
          properties: {
            type: { type: "string", enum: ["activity", "task", "routine"] },
            title: { type: "string" },
            date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            start: { type: ["string", "null"], pattern: "^\\d{2}:\\d{2}$" },
            end: { type: ["string", "null"], pattern: "^\\d{2}:\\d{2}$" },
            category: { type: "string" },
            notes: { type: "string" },
            recurrence: { type: ["object", "null"], properties: { frequency: { type: "string", enum: ["daily", "weekly", "monthly"] }, days: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 } }, interval: { type: "integer", minimum: 1 } } }
          },
          required: ["type", "title", "date", "category", "notes"],
          additionalProperties: false
        },
        changes: { type: ["object", "null"], properties: { title: { type: ["string", "null"] }, date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, start: { type: ["string", "null"], pattern: "^\\d{2}:\\d{2}$" }, end: { type: ["string", "null"], pattern: "^\\d{2}:\\d{2}$" }, category: { type: ["string", "null"] }, notes: { type: ["string", "null"] }, status: { type: ["string", "null"], enum: ["upcoming", "in-progress", "overdue", "completed", "missed", "cancelled", "postponed", "awaiting-check-in"] } }, additionalProperties: false },
        postponeMinutes: { type: ["integer", "null"], minimum: 1 }
      },
      required: ["type", "targetId", "item", "changes", "postponeMinutes"],
      additionalProperties: false
    },
    pendingClarification: {
      type: ["object", "null"],
      properties: { intent: { type: "string", enum: ["create_item", "update_item", "reschedule_item", "postpone_item", "complete_item", "mark_missed", "cancel_item"] }, knownFields: { type: "object", additionalProperties: true }, missingFields: { type: "array", items: { type: "string" } } },
      required: ["intent", "knownFields", "missingFields"],
      additionalProperties: false
    }
  },
  required: ["kind", "message", "requiresConfirmation", "action", "pendingClarification"],
  additionalProperties: false
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
