/* Matson Time Assistant — Vercel Function */
/* Sections: Configuration, System instruction, Schema, Input validation, Gemini request, Response validation, Handler */

/* ========== 1. Configuration ========== */
const MAX_BODY_SIZE = 64 * 1024;
const MAX_MESSAGE_LENGTH = 2000;
const REQUEST_TIMEOUT_MS = 30000;
const SAFE_TIMEOUT_MESSAGE = "The schedule assistant took too long to respond. Please try again.";
const TIMEZONE = "Africa/Kampala";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL;
/* ========== 2. System Instruction ========== */
const LEGACY_GEMINI_SYSTEM_INSTRUCTION = `You are the natural-language interpretation and conversational reasoning component of Matson Time, a private personal time-management application.

You operate Matson's personal time-management calendar. Interpret requests using only the supplied message and request context: temporalContext (with currentDate, currentTime, and timezone), conversationContext, recentEntities, availableCategories, relevantItems, pendingClarification, allowedActions, actionContract, compactFacts, activePlanningContext, and compact priorContext. Never treat this as business reservation management.

CONTEXT AND ACTION CONTRACT
The supplied temporalContext and calculated compactFacts are authoritative. Relevant saved schedule items contain the only valid target IDs. recentEntities resolve singular references; referencedSets resolve plural references; pendingOperation preserves incomplete compound actions and known values across turns. Saved items and unsaved planning proposals are distinct: never update an unsaved proposal as if it were stored. Clarify when a target, scope, time, or operation is genuinely ambiguous; ask one focused question and do not repeat answered questions.

The action vocabulary is create_item, update_item, reschedule_item, postpone_item, complete_item, mark_missed, cancel_item, restore_item, and delete_item. create_item needs an item and no target; update/reschedule need one supplied saved target and supported changes; postpone needs a positive number of minutes; status actions need one supplied saved target; restore_item requires a cancelled target; delete_item permanently deletes a saved target. Cancellation preserves history, marks the item cancelled, and allows restoration. Deletion permanently removes the schedule document and cannot be undone through normal app controls. Never interpret “clear” as cancellation or deletion without resolving the intended method.

Use plan_proposal for coordinated actions (2–20 valid ordered actions) and bulk_proposal for collection actions. Every bulk proposal must provide a structured scope, all real target IDs, and an exact affectedCount; IDs must be supplied and each item must match the scope. Collection actions are cancel_items, delete_items, complete_items, reschedule_items, update_items, and deduplicate_items. “All/everything” without a date, item type, status, or resolved set is ambiguous: clarify whether the user means active upcoming items or all stored history. Never broaden scope or guess. Delete/duplicate cleanup defaults to recommending the oldest exact duplicate be kept, but always requires explicit confirmation. Gemini proposes only; application logic validates and executes writes only after confirmation. Return structured responses only.

SCHEDULING INTENT
Words such as reserve, block, set aside, schedule, add, plan, book time for, make time for, put on my calendar, put in my schedule, and remind me to are ordinary personal schedule-management language. Do not reject them because they can mean something else outside this app. Infer the supported action from the whole request. Prefer create_item for a new commitment, activity, task, or explicitly recurring routine. Do not return no_action for a request that clearly maps to an allowed action. Use no_action only for unrelated requests or requests that cannot safely map to an allowed action, and explain briefly what you could not map.

Ask a clarification only when a genuinely required value is missing. Do not ask for information already provided by the message or context. A new activity needs an exact date, start, and end time; a task needs a title and date but no times; a routine is appropriate only when recurrence is explicitly requested. Do not invent exact times for vague periods such as morning, afternoon, or evening. Ask one concise question for the missing exact time or times. A routine may have a start time with no end time when no duration was given.

DATE INTERPRETATION
Treat supplied currentDate as the authoritative local calendar date (the localDate described in these instructions); use the supplied timezone, normally Africa/Kampala. today is currentDate; tomorrow is one local calendar day after it. Friday means the next appropriate Friday from currentDate; next Friday means Friday in the following week. this evening is currentDate. tomorrow morning means tomorrow's local date, but ask for an exact time when needed. Resolve dates by local calendar arithmetic, never by UTC conversion that could shift the date. Return dates as YYYY-MM-DD.

TIME INTERPRETATION
Convert 2 PM to 14:00, 5 PM to 17:00, 7 in the morning to 07:00, noon to 12:00, and midnight to 00:00. “From 2 to 5 PM” normally means 14:00 to 17:00. “From 2 PM to 5 PM” supplies both exact times. Return times as 24-hour HH:mm.
When a saved timed item receives a new start without an explicit end or duration, preserve its existing duration in the proposed changes.

ITEM TYPE AND TITLE
Use activity for a commitment occupying a specific time period, task for something to do without a specified time period, and routine only when recurrence is explicit. Make a short clean title from the user's actual wording: “studio session” becomes “Studio session”; “send Raymond the files” becomes “Send Raymond the files”; “rehearsal” becomes “Rehearsal”. Do not use the entire request as the title or invent people, locations, or details. Use only supplied existing item IDs. When one relevant item uniquely matches an edit or reschedule, use its supplied ID. For a reschedule with a new start but no new end, preserve the item's existing duration if it is supplied; otherwise ask for the missing end time.

CATEGORY
Choose a category only when the match is clear from availableCategories: studio session, rehearsal, practice, or playlist → Music; gym or exercise → Health; meeting or call → Meetings. Otherwise use Personal, the application's safe default category. Do not reject a valid action because category certainty is low.

You do not directly modify schedule data.

For every schedule write, return a structured proposed_action or plan_proposal with requiresConfirmation true. The application validates and shows it to Matson for confirmation. Never claim an action was completed, saved, moved, cancelled, or deleted.

Return clarification with one concise question when a required schedule detail is genuinely missing. Return answer for conversational schedule questions only when supported by supplied facts. Return error only when processing cannot continue.

For schedule answers, use only supplied schedule facts and items. Never invent an activity, ID, date, status, conflict, completion, or time.

If multiple existing items may match, request clarification rather than choosing one.

Do not mark an item completed merely because its scheduled time passed.

Do not silently change or resolve saved schedule items. When Matson asks for advice or management, recommendations and proposed resolutions are allowed; execution always waits for confirmation.

Do not suggest a replacement time unless Matson explicitly asks for scheduling help.

Do not create routines unless Matson requests recurrence.

Do not add locations, links, attachments, guests, or unsupported fields.

Keep user-facing messages concise, useful, and practical. A no_action message must say what part could not be mapped; do not expose technical details.

PLANNING CONVERSATIONS
Proposed commitments Matson mentions are valid planning facts even when unsaved. Never say they are absent just because they are not in relevantItems. On the first turn, extract mentioned proposed items, people, dates, times/durations, constraints, travel/preparation concerns, and planning goal into one small activePlanningContext. Continue from it on follow-up turns; do not discard its proposedItems, constraints, or goal when a follow-up omits details. Update that single active context when Matson corrects or adds information, and return the updated object as planningContext. Return null when the topic is clearly abandoned or resolved. The application sends this compact context, not the complete conversation history.

When Matson asks for advice or to help manage, work out, fit into the week, resolve a conflict, choose where to move something, or plan mentioned items, use supplied weekly compactFacts and stored relevantItems. Never ask how to proceed when Matson asked for the best plan. Recommend one practical plan: identify the conflict, preserve fixed commitments where possible, move the more flexible item, allow enough activity and travel/preparation time, explain briefly, and require confirmation before writing. Do not silently change saved items. If duration, travel, meeting flexibility, or another necessary fact is missing, ask one focused clarification and retain planningContext. “30 minutes is not enough” is a constraint, not the desired duration.

PRIOR CONVERSATION RECALL
When compact priorContext is supplied, use only its matching summaries, snippets, and active memories to answer a recall question. Treat it as conversation history, not current schedule data. If no relevant match is supplied, say you could not find that prior topic and ask for another keyword. Do not claim details absent from that context.

Use plan_proposal with requiresConfirmation true and non-empty plan.actions when multiple coordinated actions are needed. Keep action null for plan_proposal. Use proposed_action when only one action is needed. If a plan item lacks a required end time, ask for clarification before proposing the plan.

Planning example: activePlanningContext contains unsaved Gym tomorrow at 16:00 and Meeting with Hilda tomorrow at 16:30; Matson says 30 minutes is insufficient for gym and travel time is needed; Matson asks for the best plan based on this week. Recognize both commitments even if absent from relevantItems. Use weekly compactFacts. If supplied facts do not establish gym duration or meeting end/travel requirements, ask one focused question while preserving both items and constraints in planningContext. Once enough facts are supplied, recommend moving gym to a specific supplied suitable opening, keep the meeting at 16:30 if context says it is fixed, explain the travel gap, and return a plan_proposal requiring confirmation. Never execute it yourself.

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

const ACTION_REQUIREMENTS = {
  create_item: { activity: ["item.type", "item.title", "item.date", "item.start", "item.end"], task: ["item.type", "item.title", "item.date"], routine: ["item.type", "item.title", "recurrence", "item.date"] },
  update_item: ["targetId", "changes"], reschedule_item: ["targetId", "dateOrStartOrEnd"], postpone_item: ["targetId", "postponeMinutes"],
  complete_item: ["targetId"], mark_missed: ["targetId"], cancel_item: ["targetId"], restore_item: ["cancelledTargetId"], delete_item: ["targetId", "trustedConfirmation"],
  bulk: ["operation", "scope", "targetIds", "affectedCount", "trustedConfirmation"], plan_proposal: ["twoValidActions"]
};

function evaluateActionCompleteness(action, context = {}) {
  const missingFields = [], invalidFields = [];
  const addMissing = field => { if (!missingFields.includes(field)) missingFields.push(field); };
  if (!action || typeof action !== "object") return { complete: false, missingFields: ["action"], invalidFields };
  if (action.type === "create_item") {
    const item = action.item || {};
    const fields = ACTION_REQUIREMENTS.create_item[item.type] || ["item.type", "item.title", "item.date"];
    for (const field of fields) {
      if (field === "item.type" && !["activity", "task", "routine"].includes(item.type)) addMissing(field);
      else if (field === "item.title" && !String(item.title || "").trim()) addMissing(field);
      else if (field === "item.date" && !isValidLocalDate(item.date)) addMissing(field);
      else if (field === "item.start" && !item.start) addMissing(field);
      else if (field === "item.end" && !item.end) addMissing(field);
      else if (field === "recurrence" && !item.recurrence) addMissing(field);
    }
  } else if (["update_item", "reschedule_item"].includes(action.type)) {
    if (!action.targetId) addMissing("targetId");
    if (action.type === "update_item" && !Object.values(action.changes || {}).some(value => value !== null && value !== undefined && value !== "")) addMissing("changes");
    if (action.type === "reschedule_item" && !["date", "start", "end"].some(key => action.changes?.[key] !== null && action.changes?.[key] !== undefined)) addMissing("date or time");
  } else if (action.type === "postpone_item") {
    if (!action.targetId) addMissing("targetId");
    if (!Number.isInteger(action.postponeMinutes) || action.postponeMinutes <= 0) addMissing("postponeMinutes");
  } else if (Object.hasOwn(ACTION_REQUIREMENTS, action.type)) {
    if (!action.targetId) addMissing("targetId");
    if (action.type === "restore_item" && context.items?.find(item => item.id === action.targetId)?.status !== "cancelled") invalidFields.push("targetId");
  }
  return { complete: missingFields.length === 0 && invalidFields.length === 0, missingFields, invalidFields };
}

const GEMINI_SYSTEM_INSTRUCTION = `You are Matson Time, the personal schedule-management assistant for Matson's personal calendar. “Reserve,” “block,” “schedule,” “add,” “set aside,” “put on my calendar,” and “make time for” can create schedule items. Interpret only with supplied context. Use the supplied Africa/Kampala local date for relative dates; never shift dates through UTC. Application-prepared context contains matching items and IDs, resolved scopes, calculated facts, and candidate slots. Do not invent IDs, ask for supplied facts, or recalculate them.

Completeness contract: create activity requires type, title, local date, start, and end; task requires type, title, and date (times optional); routine requires explicit recurrence, title, and date/recurrence start, with time only when time-based. Updates need a real target and a supported change; reschedule needs target and date/start/end; postpone needs a target and positive minutes; status actions need a target; restore needs a cancelled target; deletion and every write require trusted confirmation. A plan needs at least two independently valid actions. Bulk actions need a resolved operation/scope, matching real IDs, exact count, and confirmation. Complete requests produce proposals immediately. Clarify only for genuinely absent required fields, name each missing field in both message and pendingClarification.missingFields, and inspect the current message plus all supplied conversation, entity, schedule, planning, operation, memory, and calculated context first. Never claim an unspecified detail is missing. Ask one focused question; retain known fields. Gemini proposes; trusted application logic validates and executes only after confirmation.

Interpret exact times (2 PM=14:00; noon=12:00; midnight=00:00); a shared meridiem in “from 2 to 5 PM” applies to both. Tasks need no time. Category uncertainty never blocks creation: studio/rehearsal/practice→Music, gym/exercise→Health, meetings/calls→Meetings, otherwise Personal. Generate a concise title from a clear subject. Use supplied candidate slots for planning. Cancel preserves history; delete is permanent; never guess “clear” or broaden “all.” Return schema-valid structured output only.

Compact examples: “Reserve tomorrow 2–5 PM for a studio session” → timed activity proposal, 14:00–17:00, Music, confirmation; “Remind me to send Raymond the files tomorrow” → untimed task proposal; “Move the supplied call to 4 PM” → real target, preserve supplied duration; “Block Friday afternoon for practice” → ask exact start and end; “clear everything planned” → resolve scope then cancel/delete method; “remove an exact duplicate and move the remainder” → recommend oldest to keep, ask only missing time, then one confirmed plan; “cancel gym and add a walk” → one ordered confirmed plan.`;

/* ========== 3. Structured Response Schema ========== */
const GEMINI_ACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    type: { type: "STRING", enum: ["create_item", "update_item", "reschedule_item", "postpone_item", "complete_item", "mark_missed", "cancel_item", "restore_item", "delete_item"] },
    targetId: { type: "STRING", nullable: true },
    item: {
      type: "OBJECT", nullable: true,
      properties: {
        type: { type: "STRING", enum: ["activity", "task", "routine"] },
        title: { type: "STRING" },
        date: { type: "STRING", nullable: true },
        start: { type: "STRING", nullable: true },
        end: { type: "STRING", nullable: true },
        category: { type: "STRING" },
        notes: { type: "STRING" },
        recurrence: {
          type: "OBJECT", nullable: true,
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
      type: "OBJECT", nullable: true,
      properties: {
        title: { type: "STRING", nullable: true }, date: { type: "STRING", nullable: true },
        start: { type: "STRING", nullable: true }, end: { type: "STRING", nullable: true },
        category: { type: "STRING", nullable: true }, notes: { type: "STRING", nullable: true },
        status: { type: "STRING", nullable: true, enum: ["upcoming", "in-progress", "overdue", "completed", "missed", "cancelled", "postponed", "awaiting-check-in"] }
      },
    },
    postponeMinutes: { type: "INTEGER", nullable: true }
  },
  required: ["type", "targetId", "item", "changes", "postponeMinutes"]
};

const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["answer", "clarification", "proposed_action", "plan_proposal", "bulk_proposal", "no_action", "error"] },
    message: { type: "STRING" },
    requiresConfirmation: { type: "BOOLEAN" },
    action: { ...GEMINI_ACTION_SCHEMA, nullable: true },
    plan: {
      type: "OBJECT", nullable: true,
      properties: {
        title: { type: "STRING" },
        actions: { type: "ARRAY", items: GEMINI_ACTION_SCHEMA }
      },
      required: ["title", "actions"]
    },
    bulkAction: {
      type: "OBJECT", nullable: true,
      properties: {
        type: { type: "STRING", enum: ["cancel_items", "delete_items", "complete_items", "reschedule_items", "update_items", "deduplicate_items"] },
        scope: {
          type: "OBJECT",
          properties: {
            scopeType: { type: "STRING", enum: ["current_item", "selected_item", "referenced_items", "today", "tomorrow", "specific_date", "date_range", "current_week", "next_week", "current_month", "future", "overdue", "completed", "missed", "cancelled", "routines", "tasks", "activities", "category", "title_match", "all_active", "absolutely_all"] },
            startDate: { type: "STRING", nullable: true }, endDate: { type: "STRING", nullable: true },
            statuses: { type: "ARRAY", items: { type: "STRING" } }, itemTypes: { type: "ARRAY", items: { type: "STRING", enum: ["activity", "task", "routine"] } },
            categories: { type: "ARRAY", items: { type: "STRING" } }, titleQuery: { type: "STRING", nullable: true },
            includeCompleted: { type: "BOOLEAN" }, includeCancelled: { type: "BOOLEAN" }
          },
          required: ["scopeType", "startDate", "endDate", "statuses", "itemTypes", "categories", "titleQuery", "includeCompleted", "includeCancelled"]
        },
        targetIds: { type: "ARRAY", items: { type: "STRING" } }, affectedCount: { type: "INTEGER" },
        changes: { type: "OBJECT", nullable: true, properties: { date: { type: "STRING", nullable: true }, start: { type: "STRING", nullable: true }, end: { type: "STRING", nullable: true }, title: { type: "STRING", nullable: true }, category: { type: "STRING", nullable: true }, notes: { type: "STRING", nullable: true }, status: { type: "STRING", nullable: true } } }
      },
      required: ["type", "scope", "targetIds", "affectedCount", "changes"]
    },
    planningContext: {
      type: "OBJECT", nullable: true,
      properties: {
        topic: { type: "STRING" },
        proposedItems: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              temporaryId: { type: "STRING" }, type: { type: "STRING", enum: ["activity", "task", "routine"] },
              title: { type: "STRING" }, date: { type: "STRING", nullable: true },
              start: { type: "STRING", nullable: true }, end: { type: "STRING", nullable: true },
              durationMinutes: { type: "INTEGER", nullable: true }, category: { type: "STRING" }
            },
            required: ["temporaryId", "type", "title", "date", "start", "end", "durationMinutes", "category"]
          }
        },
        constraints: { type: "ARRAY", items: { type: "STRING" } },
        goal: { type: "STRING" }
      },
      required: ["topic", "proposedItems", "constraints", "goal"]
    },
    pendingClarification: {
      type: "OBJECT", nullable: true,
      properties: {
        intent: { type: "STRING", enum: ["create_item", "update_item", "reschedule_item", "postpone_item", "complete_item", "mark_missed", "cancel_item", "restore_item", "delete_item", "bulk_scope", "destructive_method", "deduplicate_and_reschedule", "unknown"] },
        knownFields: { type: "OBJECT", properties: { type: { type: "STRING", nullable: true }, title: { type: "STRING", nullable: true }, date: { type: "STRING", nullable: true }, start: { type: "STRING", nullable: true }, end: { type: "STRING", nullable: true } } },
        missingFields: { type: "ARRAY", items: { type: "STRING" } }
      },
      required: ["intent", "knownFields", "missingFields"]
    }
  },
  required: ["kind", "message", "requiresConfirmation", "action", "plan", "bulkAction", "planningContext", "pendingClarification"]
};

/* ========== 4. Input Validation ========== */
function validateRequest(body) {
  if (!body || typeof body !== "object") return "Invalid request body";
  if (!body.message || typeof body.message !== "string") return "Message is required";
  if (body.message.length > MAX_MESSAGE_LENGTH) return "Message too long";
  if (body.context !== undefined && (!Array.isArray(body.context) || body.context.some(item => !item || typeof item !== "object" || Array.isArray(item)))) return "Invalid context";
  if (body.pendingClarification !== undefined && body.pendingClarification !== null && (typeof body.pendingClarification !== "object" || Array.isArray(body.pendingClarification))) return "Invalid pendingClarification";
  if (body.activePlanningContext !== undefined && body.activePlanningContext !== null && (typeof body.activePlanningContext !== "object" || Array.isArray(body.activePlanningContext))) return "Invalid activePlanningContext";
  if (body.priorContext !== undefined && body.priorContext !== null && (typeof body.priorContext !== "object" || Array.isArray(body.priorContext))) return "Invalid priorContext";
  if (body.conversationContext !== undefined && body.conversationContext !== null && (typeof body.conversationContext !== "object" || Array.isArray(body.conversationContext))) return "Invalid conversationContext";
  if (body.calculatedFacts !== undefined && body.calculatedFacts !== null && (typeof body.calculatedFacts !== "object" || Array.isArray(body.calculatedFacts))) return "Invalid calculatedFacts";
  if (body.pendingOperation !== undefined && body.pendingOperation !== null && (typeof body.pendingOperation !== "object" || Array.isArray(body.pendingOperation))) return "Invalid pendingOperation";
  if (body.referencedSets !== undefined && body.referencedSets !== null && !Array.isArray(body.referencedSets)) return "Invalid referencedSets";
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

function isValidLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function buildRequestContext(message, scheduleItems, pendingClarification, compactFacts, activePlanningContext, priorContext, conversationContext, calculatedFacts, pendingOperation, referencedSets) {
  const localDate = getCurrentLocalDate();
  const [year, month, day] = localDate.split("-").map(Number);
  const weekStartDate = new Date(year, month - 1, day);
  weekStartDate.setDate(weekStartDate.getDate() - ((weekStartDate.getDay() + 6) % 7));
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  const formatLocalDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    message: String(message || "").trim().slice(0, 1200),
    temporalContext: { localDate, localTime: getCurrentLocalTime(), timezone: TIMEZONE, weekStart: formatLocalDate(weekStartDate), weekEnd: formatLocalDate(weekEndDate) },
    currentDate: localDate,
    currentTime: getCurrentLocalTime(),
    timezone: TIMEZONE,
    availableItemTypes: ["activity", "task", "routine"],
    availableCategories: ["Music", "Health", "Personal", "Meetings", "Travel"],
    allowedActions: ["create_item", "update_item", "reschedule_item", "postpone_item", "complete_item", "mark_missed", "cancel_item", "restore_item", "delete_item", "cancel_items", "delete_items", "complete_items", "reschedule_items", "update_items", "deduplicate_items"],
    pendingClarification: pendingClarification,
    activePlanningContext: activePlanningContext || null,
    conversationContext: conversationContext && typeof conversationContext === "object" ? {
      conversationId: typeof conversationContext.conversationId === "string" ? conversationContext.conversationId.slice(0, 160) : null,
      summary: String(conversationContext.summary || "").slice(0, 700),
      latestMessages: Array.isArray(conversationContext.latestMessages) ? conversationContext.latestMessages.slice(-6).map(entry => ({ role: entry.role === "user" ? "user" : "assistant", text: String(entry.text || "").slice(0, 240), referencedItemIds: Array.isArray(entry.referencedItemIds) ? entry.referencedItemIds.filter(id => typeof id === "string").slice(0, 10) : [] })) : [],
      currentTopic: typeof conversationContext.currentTopic === "string" ? conversationContext.currentTopic.slice(0, 160) : null,
      continuesPreviousTopic: Boolean(conversationContext.continuesPreviousTopic),
      recentEntities: Array.isArray(conversationContext.recentEntities) ? conversationContext.recentEntities.slice(-10).filter(entity => entity && typeof entity.id === "string" && (entity.deleted || scheduleItems.some(item => item.id === entity.id))).map(entity => ({ ...entity, id: entity.id.slice(0, 160), title: String(entity.title || "").slice(0, 120), mentionedAs: Array.isArray(entity.mentionedAs) ? entity.mentionedAs.slice(-8).map(value => String(value).slice(0, 120)) : [] })) : []
    } : null,
    referencedSets: Array.isArray(referencedSets) ? referencedSets.slice(-5).map(set => ({ alias: String(set.alias || "").slice(0, 100), targetIds: Array.isArray(set.targetIds) ? set.targetIds.filter(id => typeof id === "string").slice(0, 20) : [] })) : [],
    pendingOperation: pendingOperation && typeof pendingOperation === "object" ? {
      intent: String(pendingOperation.intent || "").slice(0, 60), state: String(pendingOperation.state || "").slice(0, 40), operation: String(pendingOperation.operation || "").slice(0, 40), targetIds: Array.isArray(pendingOperation.targetIds) ? pendingOperation.targetIds.filter(id => typeof id === "string").slice(0, 20) : [],
      knownFields: pendingOperation.knownFields && typeof pendingOperation.knownFields === "object" ? pendingOperation.knownFields : {},
      missingFields: Array.isArray(pendingOperation.missingFields) ? pendingOperation.missingFields.slice(0, 8).map(value => String(value).slice(0, 40)) : [],
      decisions: pendingOperation.decisions && typeof pendingOperation.decisions === "object" ? pendingOperation.decisions : {}, scope: pendingOperation.scope || null
    } : null,
    actionContract: {
      create_item: "requires item; targetId and changes must be null",
      update_item: "requires a supplied real targetId and non-empty changes; item must be null",
      reschedule_item: "requires a supplied real targetId and changes containing date, start, or end; item must be null",
      postpone_item: "requires supplied real targetId and positive postponeMinutes",
      complete_item: "requires supplied real targetId",
      mark_missed: "requires supplied real targetId",
      cancel_item: "requires supplied real targetId",
      restore_item: "requires a supplied cancelled targetId",
      delete_item: "requires supplied real targetId and explicit permanent deletion intent",
      cancel_items: "requires non-empty real targetIds and resolved scope; preserves history",
      delete_items: "requires non-empty real targetIds, resolved scope, and explicit permanent deletion intent",
      complete_items: "requires non-empty real targetIds and resolved scope",
      reschedule_items: "requires non-empty timed activity targetIds and resolved scope",
      update_items: "requires non-empty real targetIds and resolved scope",
      deduplicate_items: "requires exact duplicate targetIds, resolved scope, and explicit confirmation",
      plan_proposal: "requires two or more valid actions; validate all before confirmation",
      answer: "factual message from supplied context",
      clarification: "one focused question and pending context",
      no_action: "unrelated request or no safe schedule interpretation"
    },
    calculatedFacts: calculatedFacts && typeof calculatedFacts === "object" ? {
      todayItems: Array.isArray(calculatedFacts.todayItems) ? calculatedFacts.todayItems.slice(0, 20).filter(entry => scheduleItems.some(item => item.id === entry.id)).map(entry => ({ id: entry.id, title: String(entry.title || "").slice(0, 120), start: entry.start || null, end: entry.end || null })) : [],
      nextItem: calculatedFacts.nextItem && scheduleItems.some(item => item.id === calculatedFacts.nextItem.id) ? { id: calculatedFacts.nextItem.id } : null,
      durations: Array.isArray(calculatedFacts.durations) ? calculatedFacts.durations.slice(0, 20).filter(entry => scheduleItems.some(item => item.id === entry.id) && Number.isFinite(entry.minutes)).map(entry => ({ id: entry.id, minutes: entry.minutes })) : [],
      gaps: Array.isArray(calculatedFacts.gaps) ? calculatedFacts.gaps.slice(0, 20).filter(entry => scheduleItems.some(item => item.id === entry.afterId) && scheduleItems.some(item => item.id === entry.beforeId) && Number.isFinite(entry.minutes)).map(entry => ({ afterId: entry.afterId, beforeId: entry.beforeId, minutes: entry.minutes })) : [],
      conflicts: Array.isArray(calculatedFacts.conflicts) ? calculatedFacts.conflicts.slice(0, 20).filter(entry => Array.isArray(entry.itemIds) && entry.itemIds.every(id => scheduleItems.some(item => item.id === id))).map(entry => ({ date: String(entry.date || "").slice(0, 10), itemIds: entry.itemIds.slice(0, 2) })) : [],
      postponementHistory: Array.isArray(calculatedFacts.postponementHistory) ? calculatedFacts.postponementHistory.slice(0, 20).filter(entry => scheduleItems.some(item => item.id === entry.id) && Number.isInteger(entry.count)).map(entry => ({ id: entry.id, count: entry.count })) : [],
      candidateTimeSlots: Array.isArray(calculatedFacts.candidateTimeSlots) ? calculatedFacts.candidateTimeSlots.slice(0, 10).filter(slot => isValidLocalDate(slot.date) && /^\d{2}:\d{2}$/.test(slot.start || "") && /^\d{2}:\d{2}$/.test(slot.end || "")).map(slot => ({ date: slot.date, start: slot.start, end: slot.end, minutes: Number.isFinite(slot.minutes) ? slot.minutes : null })) : []
    } : null,
    relevantItems: scheduleItems.slice(0, 20).map(item => ({
      id: item.id, title: item.title, type: item.type, date: item.date,
      start: item.start || null, end: item.end || null,
      category: item.category, notes: item.notes, status: item.status,
      postponed: item.postponed || 0, recurrence: item.recurrence || null
    })),
    compactFacts: compactFacts,
    priorContext: priorContext && typeof priorContext === "object" ? {
      conversations: Array.isArray(priorContext.conversations) ? priorContext.conversations.slice(0, 5).map(entry => ({
        title: String(entry.title || "").slice(0, 80),
        summary: String(entry.summary || "").slice(0, 180),
        messages: Array.isArray(entry.messages) ? entry.messages.slice(-2).map(message => ({ role: message.role === "user" ? "user" : "assistant", text: String(message.text || "").slice(0, 140) })) : []
      })) : [],
      memories: Array.isArray(priorContext.memories) ? priorContext.memories.slice(0, 10).map(memory => ({ type: String(memory.type || "").slice(0, 50), text: String(memory.text || "").slice(0, 180) })) : []
    } : null
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
    const [year, month, day] = today.split("-").map(Number);
    const date = new Date(year, month - 1, day + i);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
    return { error: error?.name === "AbortError" ? SAFE_TIMEOUT_MESSAGE : "Network error", details: "Failed to reach the language service.", category: error?.name === "AbortError" ? "timeout" : "invalid_request" };
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
function itemMatchesBulkScope(item, scope) {
  if (!item || !scope) return false;
  if (scope.scopeType === "absolutely_all") return scope.includeCompleted === true && scope.includeCancelled === true;
  if (scope.scopeType === "all_active" && !["upcoming", "in-progress", "postponed", "overdue", "awaiting-check-in"].includes(item.status)) return false;
  if (scope.statuses?.length && !scope.statuses.includes(item.status)) return false;
  if (scope.itemTypes?.length && !scope.itemTypes.includes(item.type)) return false;
  if (scope.categories?.length && !scope.categories.includes(item.category)) return false;
  if (scope.titleQuery && !String(item.title || "").toLowerCase().includes(String(scope.titleQuery).toLowerCase())) return false;
  if (!scope.includeCompleted && item.status === "completed" && scope.scopeType !== "completed") return false;
  if (!scope.includeCancelled && item.status === "cancelled" && scope.scopeType !== "cancelled") return false;
  if (["completed", "missed", "cancelled", "overdue"].includes(scope.scopeType) && item.status !== scope.scopeType) return false;
  const scopedType = { tasks: "task", activities: "activity", routines: "routine" }[scope.scopeType];
  if (scopedType && item.type !== scopedType) return false;
  if (scope.startDate && item.date < scope.startDate) return false;
  if (scope.endDate && item.date > scope.endDate) return false;
  return true;
}

function validateGeminiResponse(response, suppliedItems, currentMessage = "") {
  if (!response || typeof response !== "object") return "Invalid response format";
  if (typeof response.message !== "string") return "Invalid response message";
  if (!["answer", "clarification", "proposed_action", "plan_proposal", "bulk_proposal", "no_action", "error"].includes(response.kind)) return "Unsupported response kind";
  const validateAction = action => {
    const allowed = ["create_item", "update_item", "reschedule_item", "postpone_item", "complete_item", "mark_missed", "cancel_item", "restore_item", "delete_item"];
    if (!action || !allowed.includes(action.type)) return "Unsupported action type";
    if (action.type === "create_item" && (!action.item || action.targetId || action.changes)) return "create_item requires item and forbids targetId and changes";
    const target = action.type === "create_item" ? null : suppliedItems.find(item => item.id === action.targetId);
    if (action.type !== "create_item" && (!action.targetId || !target)) return `${action.type} requires a supplied targetId`;
    if (action.type === "restore_item" && target.status !== "cancelled") return "restore_item requires a cancelled targetId";
    if (action.type === "update_item" && (!action.changes || typeof action.changes !== "object" || !Object.keys(action.changes).some(key => action.changes[key] !== null && action.changes[key] !== undefined) || action.item)) return "update_item requires targetId and non-empty changes";
    if (action.type === "reschedule_item" && (!action.changes || !["date", "start", "end"].some(key => action.changes[key] !== null && action.changes[key] !== undefined) || action.item)) return "reschedule_item requires targetId and date/time changes";
    if (["update_item", "reschedule_item"].includes(action.type) && action.changes) {
      const changes = Object.fromEntries(Object.entries(action.changes).filter(([, value]) => value !== null && value !== undefined));
      if (changes.start && changes.end === undefined && target.start && target.end) {
        const toMinutes = value => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
        const newEnd = toMinutes(changes.start) + toMinutes(target.end) - toMinutes(target.start);
        changes.end = `${String(Math.floor(newEnd / 60) % 24).padStart(2, "0")}:${String(newEnd % 60).padStart(2, "0")}`;
        action.changes.end = changes.end;
      }
      const next = { ...target, ...changes };
      if (action.type === "reschedule_item" && target.type !== "activity") return "reschedule_item requires an activity target";
      if (next.date && !isValidLocalDate(next.date)) return "Changes contain an invalid date";
      if (next.start && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(next.start)) return "Changes contain an invalid start time";
      if (next.end && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(next.end)) return "Changes contain an invalid end time";
      if (next.start && next.end && next.start >= next.end) return "End time must be after start time";
    }
    if (action.type === "postpone_item" && (!Number.isInteger(action.postponeMinutes) || action.postponeMinutes <= 0)) return "postpone_item requires targetId and positive postponeMinutes";
    if (action.item) {
      const item = action.item;
      if (!["activity", "task", "routine"].includes(item.type)) return "Invalid item type";
      if (!item.title || !item.title.trim()) return "Title is required";
      if (action.type === "create_item" && !isValidLocalDate(item.date)) return "create_item requires a valid date";
      if (item.date != null && !isValidLocalDate(item.date)) return "Invalid date format";
      if (item.start && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.start)) return "Invalid start time format";
      if (item.end && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.end)) return "Invalid end time format";
      if (["create_item", "reschedule_item"].includes(action.type) && item.type === "activity" && (!item.start || !item.end)) return "Activity times are required";
      if (item.start && item.end && item.start >= item.end) return "End time must be after start time";
    }
    const completeness = evaluateActionCompleteness(action, { items: suppliedItems });
    if (!completeness.complete) return `missing_required_field:${completeness.missingFields.join(",")}`;
    if (completeness.invalidFields.length) return `invalid_action_shape:${completeness.invalidFields.join(",")}`;
    return null;
  };
  if (response.kind === "clarification") {
    const pending = response.pendingClarification;
    if (response.requiresConfirmation || response.action !== null || response.plan !== null || response.bulkAction !== null || !pending || !Array.isArray(pending.missingFields) || pending.missingFields.length === 0) return "invalid_clarification:missing_fields";
    const labels = { "item.type": /type/i, "item.title": /title|what (?:is|should .* be called)/i, "item.date": /date|which day/i, date: /date|which day/i, "item.start": /start|begin|from what time/i, start: /start|begin|from what time/i, "item.end": /end|finish|until|to what time/i, end: /end|finish|until|to what time/i, recurrence: /recurr|which days|how often/i, targetId: /which item|what item|which .* (?:move|change|cancel|delete|complete)/i, scope: /scope|which (?:items|date|week)/i, operation: /cancel or delete|which (?:action|method)/i, changes: /what .* change|which change/i, postponeMinutes: /how many minutes|how long/i };
    const allowedMissing = new Set(["item.type", "item.title", "item.date", "item.start", "item.end", "type", "title", "date", "start", "end", "recurrence", "targetId", "changes", "postponeMinutes", "scope", "operation", "keepId"]);
    for (const field of pending.missingFields) {
      if (!allowedMissing.has(field)) return "invalid_clarification:unsupported_field";
      const key = ({ "item.type": "type", "item.title": "title", "item.date": "date", "item.start": "start", "item.end": "end" })[field] || field;
      if (pending.knownFields?.[key] !== undefined && pending.knownFields?.[key] !== null && pending.knownFields?.[key] !== "") return "invalid_clarification:field_already_known";
      if (labels[field] && !labels[field].test(response.message)) return "invalid_clarification:unnamed_missing_field";
    }
    const normalizedMessage = String(currentMessage).toLowerCase();
    const explicitTimes = [...normalizedMessage.matchAll(/\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/gi)];
    const supplied = new Set();
    if (/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i.test(normalizedMessage)) supplied.add("date");
    if (explicitTimes.length >= 1) supplied.add("start");
    if (explicitTimes.length >= 2 || /\bfrom\s+\d{1,2}\s+to\s+\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(normalizedMessage)) supplied.add("end");
    if (/\b(for|to)\s+(?:a|an|the)\s+[a-z][\w -]{1,50}/i.test(normalizedMessage) || /\b(remind me to|meeting with|gym|studio session|rehearsal|practice|call)\b/i.test(normalizedMessage)) supplied.add("title");
    if (pending.missingFields.some(field => supplied.has(({ "item.date": "date", "item.start": "start", "item.end": "end", "item.title": "title" })[field] || field))) return "complete_request_misclassified";
  }
  if (response.kind === "proposed_action") {
    if (!response.requiresConfirmation) return "Proposed action must require confirmation";
    const error = validateAction(response.action);
    if (error) return error;
  }
  if (response.kind === "plan_proposal") {
    if (!response.requiresConfirmation || !response.plan || !Array.isArray(response.plan.actions) || response.plan.actions.length < 2 || response.plan.actions.length > 20) return "Invalid plan proposal";
    for (const action of response.plan.actions) {
      const error = validateAction(action);
      if (error) return error;
    }
  }
  if (response.kind === "bulk_proposal") {
    const bulk = response.bulkAction;
    if (!response.requiresConfirmation || response.action !== null || response.plan !== null || !bulk || !Array.isArray(bulk.targetIds) || !bulk.targetIds.length || bulk.targetIds.length > 450 || new Set(bulk.targetIds).size !== bulk.targetIds.length || bulk.affectedCount !== bulk.targetIds.length) return "Invalid bulk proposal";
    const validScopes = ["current_item", "selected_item", "referenced_items", "today", "tomorrow", "specific_date", "date_range", "current_week", "next_week", "current_month", "future", "overdue", "completed", "missed", "cancelled", "routines", "tasks", "activities", "category", "title_match", "all_active", "absolutely_all"];
    if (!["cancel_items", "delete_items", "complete_items", "reschedule_items", "update_items", "deduplicate_items"].includes(bulk.type) || !bulk.scope || !validScopes.includes(bulk.scope.scopeType)) return "Bulk proposal requires an operation and resolved scope";
    if (bulk.scope.scopeType === "absolutely_all" && (bulk.scope.includeCompleted !== true || bulk.scope.includeCancelled !== true)) return "All schedule items scope must include completed and cancelled items";
    if (bulk.scope.scopeType === "specific_date" && !isValidLocalDate(bulk.scope.startDate)) return "A specific date scope requires a valid date";
    if (bulk.scope.scopeType === "date_range" && (!isValidLocalDate(bulk.scope.startDate) || !isValidLocalDate(bulk.scope.endDate) || bulk.scope.startDate > bulk.scope.endDate)) return "A date range scope requires valid start and end dates";
    if (bulk.scope.scopeType === "category" && !bulk.scope.categories?.length) return "A category scope requires a category";
    if (bulk.scope.scopeType === "title_match" && !bulk.scope.titleQuery) return "A title scope requires a title match";
    const targets = bulk.targetIds.map(id => suppliedItems.find(item => item.id === id));
    if (targets.some(item => !item) || targets.some(item => !itemMatchesBulkScope(item, bulk.scope))) return "Bulk proposal target IDs do not match the supplied scope";
    if (["delete_items", "deduplicate_items"].includes(bulk.type) && !["absolutely_all", "completed", "cancelled", "missed", "overdue", "today", "tomorrow", "current_week", "next_week", "current_month", "future", "routines", "tasks", "activities", "category", "title_match", "referenced_items", "selected_item", "specific_date", "date_range", "all_active"].includes(bulk.scope.scopeType)) return "Bulk deletion requires a specific resolved scope";
  }
  if (!Object.hasOwn(response, "planningContext")) return "Planning context field is required";
  if (response.planningContext !== null && (!response.planningContext || typeof response.planningContext !== "object" || !Array.isArray(response.planningContext.proposedItems) || !Array.isArray(response.planningContext.constraints) || typeof response.planningContext.goal !== "string")) return "Invalid planning context";
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
      requestContext = buildRequestContext(message, contextItems, body.pendingClarification || null, body.compactFacts || null, body.activePlanningContext || null, body.priorContext || null, body.conversationContext || null, body.calculatedFacts || null, body.pendingOperation || null, body.referencedSets || null);
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
      if (error?.name === "AbortError") {
        sendJson(res, 504, { kind: "error", message: SAFE_TIMEOUT_MESSAGE });
        return;
      }
      sendJson(res, 502, { kind: "error", message: "Unable to process that request right now." });
      return;
    }
    if (result.error) {
      if (result.category !== "missing_environment_configuration") {
        console.error("Assistant request failed", { category: result.category || "invalid_request" });
      }
      if (result.category === "timeout") {
        sendJson(res, 504, { kind: "error", message: SAFE_TIMEOUT_MESSAGE });
        return;
      }
      sendJson(res, 502, { kind: "error", message: "Unable to process that request right now." });
      return;
    }
    let response = result.response;
    let responseError;
    try {
      responseError = validateGeminiResponse(response, contextItems, message);
    } catch (error) {
      logAssistantStageFailure("normalized-response-validation", error, requestContext);
      sendJson(res, 502, { kind: "error", message: "Unable to process that request right now." });
      return;
    }
    if (responseError) {
      const category = responseError.startsWith("invalid_clarification:") ? "invalid_clarification" : responseError === "complete_request_misclassified" ? "complete_request_misclassified" : responseError.startsWith("missing_required_field:") ? "missing_required_field" : "invalid_action_shape";
      console.error("Assistant request failed", { category, reason: responseError });
      if (category === "invalid_clarification") {
        sendJson(res, 200, { kind: "error", message: "I could not identify what information is missing. Please try the request again.", action: null, plan: null, bulkAction: null, planningContext: null, pendingClarification: null, requiresConfirmation: false });
        return;
      }
      sendJson(res, 502, { kind: "error", message: "Unable to process that request right now.", ...(process.env.NODE_ENV === "production" ? {} : { reason: responseError }) });
      return;
    }
    sendJson(res, 200, response);
  } catch (error) {
    logAssistantStageFailure("normalized-response-validation", error, body);
    if (error?.name === "AbortError") {
      sendJson(res, 504, { kind: "error", message: SAFE_TIMEOUT_MESSAGE });
      return;
    }
    sendJson(res, 500, { kind: "error", message: "Unable to process that request right now." });
  }
};
