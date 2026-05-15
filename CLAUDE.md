## Tech Stack
- Frontend: TypeScript + React + Zustand (persist UI state to localStorage when relevant)
- Backend: Go
- Testing: frontend has 186+ vitest tests, backend has 63+ Go tests — both must pass before completion
- Icons: use Heroicons

## Scope Discipline
- Make the minimum change requested; do not expand edits to adjacent views, modes, or files unless explicitly asked
- Do not start dev servers or long-running processes unless the user requests it
- When fixing CI/deprecation warnings, address ALL occurrences across ALL jobs in one pass (grep the full workflow file first)

## Workflow Requirements
- Always follow TDD: write a failing test first, then implement the fix, then verify all tests pass. Do not guess at root causes based on reading implementation code alone. The test is the proof of understanding — if you can't write a test that fails in the expected way, you don't yet understand the bug.
- Use the Read tool for file inspection, never sed/cat/head/tail for viewing file contents
- After any code change, run the relevant test suite and report results before claiming success
- Never claim a build/test passes without actually running and verifying it

## Two-Agent TDD Workflow (required for all new features)

For every new feature, use the two specialist subagents in sequence:

1. **test-writer** agent — explores the codebase, writes ONLY failing tests, commits them to `test/<feature-name>` branch. Never writes implementation code.
2. **implementer** agent — runs failing tests, writes minimal implementation code to pass them, iterates until `npm test`, `npm run typecheck`, and `go test ./...` all pass. Never edits test files.

**Invoke via:**
```
Agent(subagent_type="test-writer", prompt="Write failing tests for: <feature description>")
Agent(subagent_type="implementer", prompt="Make the failing tests on branch test/<feature-name> pass")
```

**Rules:**
- The test-writer commits tests before the implementer starts
- The implementer must not modify any test files
- Both agents must run the full test suite and report counts before declaring success
- A feature is complete only when all frontend + backend tests pass with no typecheck errors
