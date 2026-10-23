# Agents — contribution workflow

Repeatable workflow for shipping a feature or fix in this repo.

## Standard flow (do this for every task)

1. **Start from fresh master**
   - `git checkout master && git pull`
   - `git checkout -b feature/<short-name>`

2. **Implement with TDD**
   - Write a failing test first, then implement the minimal change.
   - Keep changes scoped to the requested behavior.

3. **Verify**
   - Frontend: `npm test` (or `npx vitest run`), `npx tsc -b`
   - Backend: `go test ./...`
   - Report the counts before claiming success.

4. **Ship**
   - `git add <files> && git commit -m "…"`
   - `git push -u origin <branch>`
   - `gh pr create --base master --head <branch> --title "…" --body "…"`

## Publish to dev — ONLY when the user explicitly requests it

Do **not** apply the label or notify the user unless the user asks to
"publish to dev" / "label with image publish" (or similar). Otherwise stop
after opening the PR.

When requested:

1. Apply the `publish-dev-image` label to trigger the `Dev image` workflow:
   `gh api repos/tomekbielaszewski/groceries/issues/<PR> -f 'labels[]=publish-dev-image'`
2. To re-trigger after new commits, remove then re-add the label:
   `gh api -X DELETE repos/.../issues/<PR>/labels/publish-dev-image`
   `gh api repos/.../issues/<PR>/labels -f 'labels[]=publish-dev-image'`
3. Watch the run, then notify via ntfy:
   `curl -H "Title: OpenCode Alert" -H "Tags: laptop,gear" -d "<message>" ntfy.sh/tbw-opencode`
