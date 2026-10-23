# Agents — contribution workflow

Repeatable workflow for shipping a feature or fix in this repo.

## Standard flow

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

5. **Publish a dev image (when asked)**
   - Apply the `publish-dev-image` label to the PR to trigger the `Dev image` workflow:
     `gh api repos/tomekbielaszewski/groceries/issues/<PR> -f 'labels[]=publish-dev-image'`
   - To re-trigger after new commits, remove then re-add the label:
     `gh api -X DELETE repos/.../issues/<PR>/labels/publish-dev-image`
     `gh api repos/.../issues/<PR>/labels -f 'labels[]=publish-dev-image'`

6. **Notify**
   - Watch the run, then ping the user via ntfy:
     `curl -H "Title: OpenCode Alert" -H "Tags: laptop,gear" -d "<message>" ntfy.sh/tbw-opencode`
