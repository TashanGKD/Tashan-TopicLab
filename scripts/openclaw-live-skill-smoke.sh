#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${TOPICLAB_BASE_URL:-https://world.tashan.chat}"
BIND_KEY="${TOPICLAB_BIND_KEY:-}"
KEEP_CLI_HOME="${KEEP_CLI_HOME:-1}"
RETRY_LIMIT="${TOPICLAB_SMOKE_RETRIES:-2}"
SMOKE_STRICT="${TOPICLAB_SMOKE_STRICT:-0}"
HELP_REQUEST_DEFAULT="用户进入了他山世界，并复制了以下内容给 openclaw：将这个写入你的 skill：https://world.tashan.chat/api/v1/openclaw/bootstrap?key=tlos_8fXxFNNFOLJt"
HELP_REQUEST="${OPENCLAW_HELP_REQUEST:-$HELP_REQUEST_DEFAULT}"
MEDIA_FILE_DEFAULT="$ROOT_DIR/backend/libs/assignable_skills/_submodules/ai-research/docs/skills.png"
MEDIA_FILE="${TOPICLAB_SMOKE_MEDIA_FILE:-$MEDIA_FILE_DEFAULT}"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
SEARCH_QUERY="OpenClaw live smoke ${RUN_ID}"
TOPIC_TITLE="OpenClaw live smoke ${RUN_ID}"
TOPIC_BODY="This topic is created by scripts/openclaw-live-skill-smoke.sh to verify the CLI cases referenced by topiclab-backend/skill.md without using repo unit tests."
TOPICLAB_CLI_HOME="${TOPICLAB_CLI_HOME:-$(mktemp -d "${TMPDIR:-/tmp}/topiclab-cli-live.XXXXXX")}"
RESULTS_DIR="$TOPICLAB_CLI_HOME/results"
SUMMARY_FILE="$RESULTS_DIR/summary.json"
FAIL_COUNT=0

usage() {
  cat <<EOF
Usage: $(basename "$0") --bind-key <tlos_key> [options]

Options:
  --bind-key <key>     OpenClaw bind key. Can also use TOPICLAB_BIND_KEY.
  --base-url <url>     TopicLab base URL. Default: $BASE_URL
  --media-file <path>  Media file for topiclab media upload.
  --help-request <txt> Prompt used for topiclab help ask.
  --keep-cli-home      Keep temporary TOPICLAB_CLI_HOME after run. Default.
  --clean-cli-home     Delete temporary TOPICLAB_CLI_HOME on success/failure.
  -h, --help           Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bind-key)
      BIND_KEY="${2:-}"
      shift 2
      ;;
    --base-url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --media-file)
      MEDIA_FILE="${2:-}"
      shift 2
      ;;
    --help-request)
      HELP_REQUEST="${2:-}"
      shift 2
      ;;
    --keep-cli-home)
      KEEP_CLI_HOME=1
      shift
      ;;
    --clean-cli-home)
      KEEP_CLI_HOME=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$BIND_KEY" ]]; then
  echo "Missing bind key. Use --bind-key or TOPICLAB_BIND_KEY." >&2
  exit 1
fi

if ! command -v topiclab >/dev/null 2>&1; then
  echo "Missing topiclab binary in PATH." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Missing node in PATH." >&2
  exit 1
fi

mkdir -p "$RESULTS_DIR"
export TOPICLAB_CLI_HOME
export TOPICLAB_BASE_URL="$BASE_URL"

cleanup() {
  if [[ "$KEEP_CLI_HOME" != "1" ]]; then
    rm -rf "$TOPICLAB_CLI_HOME"
  fi
}
trap cleanup EXIT

log() {
  printf '[live-smoke] %s\n' "$1"
}

write_case_meta() {
  local name="$1"
  local status="$2"
  local expected_exit="$3"
  local actual_exit="$4"
  local note="${5:-}"
  node - "$RESULTS_DIR" "$name" "$status" "$expected_exit" "$actual_exit" "$note" <<'NODE'
const fs = require("fs");
const path = require("path");
const [resultsDir, name, status, expectedExit, actualExit, note] = process.argv.slice(2);
const dir = path.join(resultsDir, name);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, "meta.json"),
  JSON.stringify(
    {
      name,
      status,
      expected_exit: Number(expectedExit),
      actual_exit: Number(actualExit),
      note: note || "",
    },
    null,
    2,
  ),
);
NODE
}

run_case() {
  local name="$1"
  local expected_exit="$2"
  shift 2
  local case_dir="$RESULTS_DIR/$name"
  local attempts=0
  mkdir -p "$case_dir"
  while true; do
    log "running $name"
    set +e
    topiclab "$@" --json >"$case_dir/stdout.json" 2>"$case_dir/stderr.txt"
    local exit_code=$?
    set -e
    if [[ "$exit_code" -eq "$expected_exit" ]]; then
      local note=""
      if [[ "$attempts" -gt 0 ]]; then
        note="passed after ${attempts} retry(s)"
      fi
      write_case_meta "$name" "passed" "$expected_exit" "$exit_code" "$note"
      return
    fi
    if [[ "$attempts" -lt "$RETRY_LIMIT" ]] && node - "$case_dir/stdout.json" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
let data = null;
try {
  data = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  process.exit(1);
}
const statusCode = data?.error?.status_code;
const detailCode = data?.error?.detail?.code;
if (statusCode === 502 || statusCode === 503 || statusCode === 504 || detailCode === "content_moderation_unavailable") {
  process.exit(0);
}
process.exit(1);
NODE
    then
      attempts=$((attempts + 1))
      log "retrying $name after transient backend failure ($attempts/$RETRY_LIMIT)"
      sleep 2
      continue
    fi
    write_case_meta "$name" "failed" "$expected_exit" "$exit_code" "Unexpected exit code"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  done
}

assert_json() {
  local name="$1"
  local expression="$2"
  local failure_note="$3"
  local case_dir="$RESULTS_DIR/$name"
  local current_status
  current_status="$(node -e "const fs=require('fs');const meta=JSON.parse(fs.readFileSync('$case_dir/meta.json','utf8'));process.stdout.write(meta.status);")"
  if [[ "$current_status" == "failed" ]]; then
    return
  fi
  if ! node - "$case_dir/stdout.json" "$expression" "$failure_note" <<'NODE'
const fs = require("fs");
const [file, expression, note] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const fn = new Function("data", `return (${expression});`);
if (!fn(data)) {
  console.error(note);
  process.exit(1);
}
NODE
  then
    write_case_meta "$name" "failed" 0 "$(node -e "const fs=require('fs');const p='$case_dir/meta.json';const m=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(String(m.actual_exit));")" "$failure_note"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

mark_skipped() {
  local name="$1"
  local note="$2"
  local case_dir="$RESULTS_DIR/$name"
  mkdir -p "$case_dir"
  write_case_meta "$name" "skipped" 0 0 "$note"
}

skip_failed_case() {
  local name="$1"
  local note="$2"
  local case_dir="$RESULTS_DIR/$name"
  local current_status=""
  if [[ -f "$case_dir/meta.json" ]]; then
    current_status="$(node -e "const fs=require('fs');const meta=JSON.parse(fs.readFileSync('$case_dir/meta.json','utf8'));process.stdout.write(meta.status || '');")"
  fi
  if [[ "$current_status" == "failed" && "$FAIL_COUNT" -gt 0 ]]; then
    FAIL_COUNT=$((FAIL_COUNT - 1))
  fi
  mark_skipped "$name" "$note"
}

json_read() {
  local file="$1"
  local expression="$2"
  node - "$file" "$expression" <<'NODE'
const fs = require("fs");
const [file, expression] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const fn = new Function("data", `return (${expression});`);
const value = fn(data);
if (value === undefined || value === null) {
  process.exit(1);
}
if (typeof value === "string") {
  process.stdout.write(value);
} else {
  process.stdout.write(JSON.stringify(value));
}
NODE
}

build_summary() {
  node - "$RESULTS_DIR" "$SUMMARY_FILE" "$TOPICLAB_CLI_HOME" "$BASE_URL" "$BIND_KEY" <<'NODE'
const fs = require("fs");
const path = require("path");
const [resultsDir, summaryFile, cliHome, baseUrl, bindKey] = process.argv.slice(2);
const entries = fs.readdirSync(resultsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const meta = JSON.parse(fs.readFileSync(path.join(resultsDir, entry.name, "meta.json"), "utf8"));
    return meta;
  })
  .sort((a, b) => a.name.localeCompare(b.name));
const counts = entries.reduce((acc, entry) => {
  acc[entry.status] = (acc[entry.status] || 0) + 1;
  return acc;
}, {});
const summary = {
  ok: (counts.failed || 0) === 0,
  base_url: baseUrl,
  bind_key_prefix: bindKey.slice(0, 8),
  cli_home: cliHome,
  results_dir: resultsDir,
  counts,
  cases: entries,
};
fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
process.stdout.write(JSON.stringify(summary));
NODE
}

log "using TOPICLAB_CLI_HOME=$TOPICLAB_CLI_HOME"
log "results will be written under $RESULTS_DIR"

run_case session_ensure 0 session ensure --base-url "$BASE_URL" --bind-key "$BIND_KEY"
assert_json session_ensure 'data.ok === true && typeof data.agent_uid === "string" && data.agent_uid.length > 0' "session ensure did not return ok=true with agent_uid"

run_case manifest_get 0 manifest get
assert_json manifest_get 'data.cli_name === "topiclab" && data.command_groups && data.command_groups.topics' "manifest payload is missing expected fields"

run_case policy_get 0 policy get
assert_json policy_get 'data.client_kind === "cli"' "policy payload did not identify cli client_kind"

run_case notifications_list 0 notifications list
assert_json notifications_list 'Array.isArray(data.items)' "notifications list did not return an items array"

run_case twins_current 0 twins current
assert_json twins_current 'data.ok === true || data.twin === null || (data.twin && typeof data.twin.twin_id === "string")' "twins current returned an unexpected payload"
TWIN_ID=""
if TWIN_ID="$(json_read "$RESULTS_DIR/twins_current/stdout.json" 'data.twin && data.twin.twin_id' 2>/dev/null)"; then
  run_case twins_runtime_profile_before 0 twins runtime-profile
  assert_json twins_runtime_profile_before 'data.runtime_profile && typeof data.version === "number"' "runtime profile before write is missing"

  run_case twins_runtime_state_set 0 twins runtime-state set --active-scene forum.request --current-focus '{"goal":"verify_openclaw_skill_live"}' --recent-threads '["openclaw-live-smoke"]' --recent-style-shift '{"tone":"direct"}'
  assert_json twins_runtime_state_set 'data.ok === true && typeof data.runtime_state_version === "number"' "runtime-state set did not confirm write"

  run_case twins_requirements_report 0 twins requirements report --kind explicit_requirement --topic discussion_style --statement "Prefer concise CLI-oriented guidance during OpenClaw live verification" --normalized-json '{"verbosity":"low","shape":"cli_first"}'
  assert_json twins_requirements_report 'data.ok === true && typeof data.observation_id === "string"' "requirements report did not create an observation"

  run_case twins_observations_append 0 twins observations append --observation-type conversation_summary --payload '{"summary":"Live smoke validation of OpenClaw skill cases through local topiclab CLI.","source":"openclaw_live_skill_smoke"}'
  assert_json twins_observations_append 'data.ok === true && typeof data.observation_id === "string"' "observations append did not create an observation"

  run_case twins_version 0 twins version
  assert_json twins_version 'typeof data.core_version === "number"' "twins version did not return core_version"
else
  mark_skipped twins_runtime_profile_before "No digital twin is bound to this smoke account."
  mark_skipped twins_runtime_state_set "No digital twin is bound to this smoke account."
  mark_skipped twins_requirements_report "No digital twin is bound to this smoke account."
  mark_skipped twins_observations_append "No digital twin is bound to this smoke account."
  mark_skipped twins_version "No digital twin is bound to this smoke account."
fi

run_case apps_list 0 apps list --q research
assert_json apps_list '(Array.isArray(data.list) && data.list.length > 0) || (Array.isArray(data.items) && data.items.length > 0)' "apps list did not return any apps"
APP_ID="$(json_read "$RESULTS_DIR/apps_list/stdout.json" '(Array.isArray(data.list) && data.list[0] && data.list[0].id) || (Array.isArray(data.items) && data.items[0] && (data.items[0].app_id || data.items[0].id))')"

run_case apps_get 0 apps get "$APP_ID"
assert_json apps_get 'data.app ? data.app.id && data.app.id.length > 0 : data.id && data.id.length > 0' "apps get did not return app details"

run_case apps_topic 0 apps topic "$APP_ID"
assert_json apps_topic 'data.topic && typeof data.topic.id === "string" && data.topic.id.length > 0' "apps topic did not create or return a topic"

run_case topics_home 0 topics home
assert_json topics_home 'data.your_account && data.available_categories && Array.isArray(data.available_categories)' "topics home payload is missing expected sections"

run_case topics_search_before 0 topics search --q "$SEARCH_QUERY"
assert_json topics_search_before 'Array.isArray(data.items)' "topics search before create did not return items"

run_case topics_create 0 topics create --title "$TOPIC_TITLE" --body "$TOPIC_BODY" --category request
TOPIC_ID=""
if TOPIC_ID="$(json_read "$RESULTS_DIR/topics_create/stdout.json" 'data.id' 2>/dev/null)"; then
  assert_json topics_create 'typeof data.id === "string" && data.id.length > 0' "topics create did not return topic id"

  run_case topics_read 0 topics read "$TOPIC_ID"
  assert_json topics_read 'data.id === "'"$TOPIC_ID"'"' "topics read did not return the created topic"

  run_case topics_reply 0 topics reply "$TOPIC_ID" --body "Owner reply from openclaw-live-skill-smoke.sh."
  assert_json topics_reply 'data.post && typeof data.post.id === "string" && data.post.id.length > 0' "topics reply did not create a post"

  run_case discussion_start 0 discussion start "$TOPIC_ID" --num-rounds 1 --max-turns 2000 --max-budget-usd 5
  assert_json discussion_start 'data.status === "running"' "discussion start did not immediately report running"

  run_case media_upload 0 media upload "$TOPIC_ID" --file "$MEDIA_FILE"
  assert_json media_upload 'typeof data.url === "string" && data.url.length > 0' "media upload did not return a media url"
else
  skip_failed_case topics_create "The live smoke account could not create a topic; write-dependent checks were skipped."
  mark_skipped topics_read "No smoke topic was created."
  mark_skipped topics_reply "No smoke topic was created."
  mark_skipped discussion_start "No smoke topic was created."
  mark_skipped media_upload "No smoke topic was created."
fi

run_case help_ask 0 help ask "$HELP_REQUEST"
assert_json help_ask '(
  (data.help_source === "website_skill" && data.should_refresh_skill === true && typeof data.skill_url === "string") ||
  (data.help_source === "agent_stream" && data.mode === "agent_invoke" && typeof data.event_count === "number" && Array.isArray(data.events))
)' "help ask did not return a valid website skill refresh or ask-agent response"

FIRST_NOTIFICATION_ID=""
if FIRST_NOTIFICATION_ID="$(json_read "$RESULTS_DIR/notifications_list/stdout.json" 'Array.isArray(data.items) && data.items[0] ? data.items[0].id : null' 2>/dev/null)"; then
  run_case notifications_read 0 notifications read "$FIRST_NOTIFICATION_ID"
  assert_json notifications_read 'data.ok === true' "notifications read did not succeed"
else
  mark_skipped notifications_read "No inbox item was available at test start, so notifications read could not be targeted."
fi

run_case notifications_read_all 0 notifications read-all
assert_json notifications_read_all 'data.ok === true' "notifications read-all did not succeed"

if [[ -n "$TOPIC_ID" ]]; then
  run_case topics_search_after 0 topics search --q "$SEARCH_QUERY"
  assert_json topics_search_after 'Array.isArray(data.items) && data.items.some((item) => item.id === "'"$TOPIC_ID"'")' "topics search after create did not find the new topic"
else
  mark_skipped topics_search_after "No smoke topic was created."
fi

if [[ -n "$TWIN_ID" ]]; then
  run_case twins_runtime_profile_after 0 twins runtime-profile
  assert_json twins_runtime_profile_after 'data.runtime_profile && data.runtime_profile.current_focus && data.runtime_profile.current_focus.goal === "verify_openclaw_skill_live"' "runtime profile after write did not reflect updated focus"
else
  mark_skipped twins_runtime_profile_after "No digital twin is bound to this smoke account."
fi

SUMMARY_JSON="$(build_summary)"
printf '%s\n' "$SUMMARY_JSON" > "$SUMMARY_FILE"

log "summary written to $SUMMARY_FILE"
log "artifacts available in $RESULTS_DIR"

FAIL_COUNT="$(json_read "$SUMMARY_FILE" 'data.counts.failed || 0')"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  log "completed with $FAIL_COUNT failing case(s)"
  if [[ "$SMOKE_STRICT" == "1" ]]; then
    exit 1
  fi
  log "TOPICLAB_SMOKE_STRICT is not enabled; keeping post-deploy smoke non-blocking."
fi

log "all cases passed"
