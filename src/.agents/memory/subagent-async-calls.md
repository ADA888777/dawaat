---
name: Subagent async calls
description: Calling subagent(...) with await can hit the CodeExecution tool timeout even though the job survives; use the unawaited jobId pattern instead.
---

`await subagent({...})` blocks the CodeExecution tool call itself. For any
subagent task that runs long (e.g. a full frontend design pass across many
files), the tool call can hit its own timeout and appear to fail — even
though the subagent job keeps running in the background and eventually
completes successfully.

**Why:** the CodeExecution tool call has its own timeout independent of the
subagent job's lifetime; a long subagent task can outlive the tool call that
launched it.

**How to apply:** call `subagent(...)` **without** `await` to get a job
object with a `jobId` immediately. Continue other work (e.g. backend/DB
implementation) in parallel. Later, `await waitForJob({ jobId })` to collect
the result before ending the turn — never end a turn with a relevant
subagent job still unresolved. To send it more instructions while preserving
context, use `sendFollowup({ name, message })`, not a fresh `subagent(...)`
call (which starts an unrelated new job).
