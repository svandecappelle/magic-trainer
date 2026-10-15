#!/usr/bin/env bash
# Audits the top decks of each format on mtgtop8, then lets Claude Code fix the most important problems on a new
# branch, following the card-audit skill. Nothing is pushed: review the branch, then merge it.
#
#   npm run fix-meta                                     # all formats, 8 decks each, up to 5 cards fixed
#   npm run fix-meta -- --formats ST,MO --max-fixes 3    # some formats, fewer fixes
#   npm run fix-meta -- --report audit-reports/2026-10-15/report.json   # skip the audit, reuse a report
#   npm run fix-meta -- --dry-run                        # audit and show the instructions, change nothing
#
# Options: --formats CODES (ST,PI,MO,LE,VI,PAU,PREM,EDH,cEDH), --decks N (8), --max-fixes N (5),
# --budget USD (10: Claude Code stops when it is spent), --model NAME, --report FILE, --dry-run.
set -euo pipefail
cd "$(dirname "$0")/.."

formats="" decks=8 max_fixes=5 budget=10 model="" report="" dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --formats) formats="$2"; shift 2 ;;
    --decks) decks="$2"; shift 2 ;;
    --max-fixes) max_fixes="$2"; shift 2 ;;
    --budget) budget="$2"; shift 2 ;;
    --model) model="$2"; shift 2 ;;
    --report) report="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) echo "Unknown option: $1 (see the top of $0)" >&2; exit 2 ;;
  esac
done

if [ "$dry_run" = 0 ]; then
  command -v claude >/dev/null || { echo "Claude Code (the claude command) is needed to fix: https://claude.com/claude-code" >&2; exit 1; }
  if [ -n "$(git status --porcelain)" ]; then
    echo "Commit or stash your changes first: the fixes go on a new branch." >&2
    exit 1
  fi
fi

# 1. The audit (or a report from an earlier run).
if [ -z "$report" ]; then
  audit_args=(--decks "$decks")
  [ -n "$formats" ] && audit_args+=(--formats "$formats")
  report=$(npx tsx scripts/audit-meta.ts "${audit_args[@]}")
fi
[ -f "$report" ] || { echo "No report at $report" >&2; exit 1; }
summary="${report%.json}.md"
echo "Report: $summary"

prompt="Use the card-audit skill (.claude/skills/card-audit/SKILL.md).

A metagame audit of the top mtgtop8 decks is in $report (readable summary: $summary; the cards are saved in
$(dirname "$report")/cards.json, usable with npm run audit-cards -- --cards). Its \"problems\" list is ranked: cards that
play WRONGLY first (\"wrong\": true: a line silently ignored, or a cost the engine can't pay), then the most played.

Fix up to $max_fixes cards from that list, in order. For each card:
- Compare its Oracle text with how the engine reads it (npm run audit-cards -- \"<name>\"), and play it in a throwaway
  test when in doubt (delete the test afterwards).
- Fix it following the skill's rules: never half-simulate; a card the engine can't fully handle stays \"not simulated\".
  Prefer fixes that also help other cards in the list (the same wording or mechanic).
- Add a test with the card's real Oracle text to src/lib/engine/meta.test.ts.
- Run npx tsc -b, npx vitest run and npm run build. A changed fixture snapshot (src/lib/engine/fixtures/*.audit.txt)
  is accepted with npx vitest run -u only when the diff is what the fix intends.
- Commit (one commit per card or per shared mechanic) with a message naming the cards.
Skip a card whose fix needs a large new engine feature (layers, a new card type, emblems…): don't start it.

Never push, never change branches, never rewrite history. When done (or out of fixes), add a section
\"Metagame audit $(basename "$(dirname "$report")")\" to TODO.md listing the most played problems still open (skipped
ones with the reason, then the next ones of the list), commit it, and finish with a short summary: cards fixed,
cards skipped and why, and the commits made."

if [ "$dry_run" = 1 ]; then
  echo "--- Instructions for Claude Code (dry run, nothing changed) ---"
  echo "$prompt"
  exit 0
fi

# 2. A branch for the fixes.
branch="audit/meta-$(date +%Y%m%d-%H%M)"
git switch -c "$branch"
echo "Fixing on branch $branch (budget \$$budget)…"

# 3. Claude Code, headless: it may edit files, run the checks and commit; nothing else.
claude_args=(-p "$prompt" --permission-mode acceptEdits --max-budget-usd "$budget"
  --allowedTools "Read" "Edit" "Write" "Grep" "Glob" "Skill"
  "Bash(npx tsc *)" "Bash(npx vitest *)" "Bash(npm run *)" "Bash(npx tsx scripts/*)"
  "Bash(git status*)" "Bash(git diff*)" "Bash(git log*)" "Bash(git show*)" "Bash(git add *)" "Bash(git commit *)"
  "Bash(rm src/lib/engine/zz-*)")
[ -n "$model" ] && claude_args+=(--model "$model")
claude "${claude_args[@]}"

echo
echo "Done. Review the fixes on $branch:"
git log --oneline "main..$branch"
echo "Merge them with: git switch main && git merge $branch"
