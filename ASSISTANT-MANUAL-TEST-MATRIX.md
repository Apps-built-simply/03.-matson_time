# Matson Time Assistant manual test matrix

Run each item with a test account and verify the proposal before confirming. Confirmed changes should persist after refresh. Destructive cases must never write before confirmation.

| Area | Try | Expected result |
| --- | --- | --- |
| Creation | “Add a studio session tomorrow from 2 to 5 PM”; add a task; add a weekly routine; vague “in the afternoon” | Correct item type/date; ask for an exact missing time; routine only when recurrence is explicit |
| Reading | Ask what is scheduled today, tomorrow, this week, next, overdue, progress, or conflicts; search title/category | Answers use current saved schedule and calculated facts |
| References | With two matching items, say “it”, “the other one”, “both”, “all of them”, “the remainder”, “everything except gym” | Resolve only from current conversation entities/sets; ask which item if ambiguous |
| Updates | Rename, change notes/category, change date/time, reschedule a timed item by start only | Proposal targets the real saved ID; start-only changes preserve duration |
| Status | Complete, mark missed, cancel, restore a cancelled item, postpone | Each appears as a proposal; cancellation keeps history; restore only accepts cancelled items |
| Delete | Delete one; delete duplicates; delete several; delete completed tasks; say “clear” | Permanent deletion is explicit, warns it cannot be undone through normal controls, and requires confirmation; ambiguous clear asks cancel vs delete |
| Scope/bulk | Clear today/tomorrow; cancel this week; complete overdue tasks; delete routines; “clear everything planned” | Scope and affected count are shown; broad scope asks active-upcoming vs all history; bulk changes confirm atomically |
| Duplicates | Create/find exact duplicate sessions; request cleanup; “delete one because it is a repetition and move the remainder” | Exact duplicates are ordered by creation; default keeps oldest; missing time asks only for the remaining item’s new time; final coordinated plan confirms together |
| Compound | Cancel gym and add a walk; move meeting and add another item; keep one and cancel the rest | One ordered plan proposal; invalid action or conflict prevents every write |
| Continuity | Correct “the meeting” to “the gym”; say “actually tomorrow”; refresh while clarification is pending; start a new conversation | Corrections update pending context; state survives refresh; new conversation clears topic-local context |
| Recall/memory | Recall a prior item and modify it; establish a stable preference; issue a temporary command | Recall is historical context but edits require a current real item; stable preference may persist; one-off commands do not become memory |
| Failure/safety | Ambiguous target/scope, deleted target, stale proposal, failed write/batch, double-click confirmation | Ask one focused question or show actionable retry; no partial batch writes; duplicate confirmation is ignored |

For bulk previews with more than ten matches, verify the total count and that the full list can be inspected before confirming. Check Today, Calendar, Progress, Assistant, and conversation history after each confirmed status or schedule change.
