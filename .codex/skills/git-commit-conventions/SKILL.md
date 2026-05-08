---
name: git-commit-conventions
description: Standardize Git branch, commit, PR, author, and push workflows. Use when Codex needs to create commits, rename or rewrite commit messages, normalize PR branch history, preserve a contributor identity, or push branches according to repository rules such as Conventional Commits.
---

# Git Commit Conventions

Use this skill to keep Git history reviewable and consistent across contributors.

## First Checks

Always inspect the current repository rules before changing history or creating a commit:

```bash
git status --short --branch
find .. -name AGENTS.md -print
git log --oneline --decorate -n 12
```

If `AGENTS.md` or project docs define commit rules, follow the most specific rule for the current working directory. If there are conflicting rules, prefer the project-local rule over a global/default habit.

Before staging or rewriting, inspect scope:

```bash
git diff --stat
git diff --name-only
```

Stage only files that belong to the current task. Do not sweep unrelated worktree changes into a commit.

## Branch Names

Use a branch prefix that reflects the requested owner or workflow:

- If the user specifies an owner, use `<owner>/<short-pr-description>`, for example `lyy/pr22-arcade-data-relay-openclaw`.
- If no owner is specified and the environment defines a default branch prefix, use that default.
- Keep branch slugs lowercase, ASCII, hyphen-separated, and descriptive.
- For a PR pulled locally for review or repair, include the PR number when useful: `<owner>/pr22-short-topic`.

When pulling an existing PR into a local owner-named branch, keep the PR head branch separate unless the user asks to update the PR head too.

## Commit Message Format

Use this base format unless the repository says otherwise:

```text
<type>(<scope>): <English message>
```

Allowed common types:

```text
feat, fix, chore, refactor, docs, test, build, ci, perf, style, revert
```

Choose the type from the actual change:

- `feat`: adds a new user-visible or API-visible capability.
- `fix`: corrects broken behavior, compatibility, routing, recovery, or data handling.
- `docs`: changes documentation only.
- `test`: adds or updates tests only.
- `chore`: maintenance with no behavior change.
- `refactor`: restructures code without intended behavior change.
- `build` or `ci`: build system or automation changes.
- `perf`: performance improvement.
- `style`: formatting or presentation-only code changes.

Do not default to `fix` just because it is safe. Use the most accurate type.

Message style:

- Write in English.
- Use lower-case imperative or descriptive wording after the colon.
- Keep the subject concise, usually under 72 characters.
- Do not end the subject with a period.
- Use the smallest meaningful scope, for example `openclaw`, `arcade`, `frontend`, `worldweave`, `docs`.

Examples:

```text
feat(arcade): allow independent relay submissions
fix(openclaw): harden api compatibility
fix(arcade): route relay images through TopicLab proxy
docs(arcade): document relay metadata contract
test(openclaw): cover arcade branch ownership rules
```

## Multi-Commit PR Cleanup

When normalizing an existing PR with several commits:

1. List commits from base to head:

   ```bash
   git log --reverse --format='%H%x09%s%x09%an <%ae>%x09%cn <%ce>' <base>..HEAD
   ```

2. Map each old subject to a normalized subject. Keep one logical message per commit; do not squash unless the user asks.
3. Preserve author and committer identity when the user requested a contributor-owned PR.
4. Rewrite only the commits in `<base>..HEAD`; do not rewrite shared base history.
5. Verify that file content did not change:

   ```bash
   git diff --stat <base>...HEAD
   git diff --stat HEAD <remote-branch>
   ```

Use non-interactive rewriting where possible. Interactive rebase is acceptable, but avoid it when a deterministic `git filter-branch --msg-filter` or scripted rebase is simpler.

## Author And Committer Identity

When asked to replace Codex identity with a contributor identity:

1. Find the contributor identity from existing repo history or PR metadata.
2. Prefer the GitHub noreply email that matches the contributor account when available.
3. Change both author and committer if the user asks for "Codex all changed to the previous contributor".
4. Verify with:

   ```bash
   git log --format='%h%x09%an <%ae>%x09%cn <%ce>%x09%s' <base>..HEAD
   ```

Example identity normalization:

```bash
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --env-filter '
if [ "$GIT_AUTHOR_NAME" = "Codex" ] && [ "$GIT_AUTHOR_EMAIL" = "codex@openai.com" ]; then
  export GIT_AUTHOR_NAME="LI YUYANG"
  export GIT_AUTHOR_EMAIL="113218777+Yu-Yang-Li@users.noreply.github.com"
fi
if [ "$GIT_COMMITTER_NAME" = "Codex" ] && [ "$GIT_COMMITTER_EMAIL" = "codex@openai.com" ]; then
  export GIT_COMMITTER_NAME="LI YUYANG"
  export GIT_COMMITTER_EMAIL="113218777+Yu-Yang-Li@users.noreply.github.com"
fi
' <base>..HEAD
```

After `filter-branch`, delete only the backup ref for the current branch if it exists:

```bash
git for-each-ref refs/original --format='%(refname)'
git update-ref -d refs/original/refs/heads/<current-branch>
```

## Safe Push Rules

Before pushing rewritten history:

```bash
git status --short --branch
git fetch <remote> <branch>
git diff --stat HEAD <remote>/<branch>
```

If content diff is empty and only commit metadata changed, push with:

```bash
git push --force-with-lease <remote> HEAD:<branch>
```

If `--force-with-lease` rejects with stale info, fetch the target branch, compare again, and only retry if no new unrelated remote work appeared.

When a local owner branch and the original PR head both need the same rewritten history, push both explicitly:

```bash
git push --force-with-lease <remote> HEAD:<owner/pr-branch> HEAD:<original-pr-head>
```

After pushing, verify:

```bash
git ls-remote <remote> refs/heads/<branch>
git status --short --branch
```

If the PR head is involved, verify it through GitHub as well:

```bash
gh pr view <number> --repo <owner/repo> --json headRefName,headRefOid,url
```

## Final Response Checklist

Report the concrete result, not the full command log:

- Current branch.
- Commit message format applied.
- Author/committer identity if changed.
- Remote branch names pushed.
- Latest head commit hash.
- Whether the worktree is clean.

If a push succeeded in the Codex desktop app, include the git push directive for each successfully pushed branch.
