---
name: Orval zod codegen and format:uri
description: Why format:uri on OpenAPI string fields breaks zod codegen in this workspace, and the fix.
---

Giving a string field `format: uri` in `lib/api-spec/openapi.yaml` causes
orval's zod client generator to emit `zod.url()` as a top-level call. That is
a zod-v4-only API; this workspace's `zod` dependency is pinned to the v3 line
(`^3.25.76`), so the generated file fails to typecheck.

**Why:** orval's zod-string-format mapping assumes a newer zod major than
what this workspace uses, and the mismatch only shows up at typecheck time
after codegen has already "succeeded" — easy to miss until you build.

**How to apply:** when writing or editing `lib/api-spec/openapi.yaml`, do not
use `format: uri` (or other formats that map to top-level zod v4 validators)
on string schema fields. Use plain `type: string` instead, and validate URL
shape at the application layer if truly needed. Re-run
`pnpm --filter @workspace/api-spec run codegen` plus a typecheck after any
spec change involving string formats to catch this early.
