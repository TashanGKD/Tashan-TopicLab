import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TOPICLAB_BASE_URL = process.env.TOPICLAB_BASE_URL || "http://127.0.0.1:8001";
const TOPICLAB_CLI_HOME = process.env.TOPICLAB_CLI_HOME || "/tmp/topiclab-cli";
const TOPICLAB_CLI_BIN = process.env.TOPICLAB_CLI_BIN || "topiclab";
const TOPICLAB_CLI_PREFIX = JSON.parse(process.env.TOPICLAB_CLI_PREFIX_JSON || "[]");
const TOPICLAB_SMOKE_MEDIA_FILE =
  process.env.TOPICLAB_SMOKE_MEDIA_FILE || path.resolve("frontend/public/media/logo_complete.webp");
const TOPICLAB_SMOKE_SKIP_MEDIA_UPLOAD = process.env.TOPICLAB_SMOKE_SKIP_MEDIA_UPLOAD === "1";
const TOPICLAB_PROTOCOL_SMOKE_ALLOW_REMOTE_WRITES =
  process.env.TOPICLAB_PROTOCOL_SMOKE_ALLOW_REMOTE_WRITES === "1";

function logStep(message) {
  process.stdout.write(`[protocol-smoke] ${message}\n`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isSkippableMediaUploadError(error) {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    detail.includes("Missing required OSS env") ||
    detail.includes('"status_code":503') ||
    detail.includes("HTTP 503")
  );
}

function uniquePhone(prefix = "139") {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8);
  return `${prefix}${suffix}`;
}

function assertLocalBaseUrl() {
  const parsed = new URL(TOPICLAB_BASE_URL);
  const hostname = parsed.hostname.toLowerCase();
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local");
  if (!isLocal && !TOPICLAB_PROTOCOL_SMOKE_ALLOW_REMOTE_WRITES) {
    throw new Error(
      `Refusing to run write-heavy protocol smoke against non-local URL ${TOPICLAB_BASE_URL}. ` +
        "Set TOPICLAB_PROTOCOL_SMOKE_ALLOW_REMOTE_WRITES=1 only for an intentional remote smoke run.",
    );
  }
}

async function requestJson(method, requestPath, { token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${TOPICLAB_BASE_URL}${requestPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  const parsed = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${requestPath}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function runCli(args, { expectExitCode = 0 } = {}) {
  try {
    const { stdout } = await execFileAsync(TOPICLAB_CLI_BIN, [...TOPICLAB_CLI_PREFIX, ...args], {
      env: {
        ...process.env,
        TOPICLAB_BASE_URL,
        TOPICLAB_CLI_HOME,
      },
    });
    const payload = JSON.parse(stdout.trim());
    if (expectExitCode !== 0) {
      throw new Error(`Expected exit code ${expectExitCode} for ${TOPICLAB_CLI_BIN} ${args.join(" ")}, but command succeeded`);
    }
    return payload;
  } catch (error) {
    const exitCode = typeof error?.code === "number" ? error.code : null;
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    if (exitCode === expectExitCode && stdout) {
      return JSON.parse(stdout);
    }
    const detail = stdout || stderr || String(error);
    throw new Error(`${TOPICLAB_CLI_BIN} ${args.join(" ")} failed with exit ${exitCode ?? "unknown"}: ${detail}`);
  }
}

async function registerUser({ phone, username, password }) {
  const config = await requestJson("GET", "/auth/register-config");
  let code = "";
  if (config.registration_requires_sms !== false) {
    const sendCode = await requestJson("POST", "/auth/send-code", {
      body: {
        phone,
        type: "register",
      },
    });
    assert(typeof sendCode.dev_code === "string" && sendCode.dev_code.length === 6, "Missing dev_code from /auth/send-code");
    code = sendCode.dev_code;
  }

  return requestJson("POST", "/auth/register", {
    body: {
      phone,
      username,
      password,
      code,
    },
  });
}

async function main() {
  assertLocalBaseUrl();
  await fs.rm(TOPICLAB_CLI_HOME, { recursive: true, force: true });
  await fs.mkdir(TOPICLAB_CLI_HOME, { recursive: true });

  const password = "Password123!";
  const ownerPhone = uniquePhone("139");
  const helperPhone = uniquePhone("138");

  logStep("registering owner and helper users");
  const ownerAuth = await registerUser({
    phone: ownerPhone,
    username: `owner_${ownerPhone.slice(-4)}`,
    password,
  });
  const helperAuth = await registerUser({
    phone: helperPhone,
    username: `helper_${helperPhone.slice(-4)}`,
    password,
  });

  logStep("creating owner openclaw bind key");
  const ownerKey = await requestJson("POST", "/api/v1/auth/openclaw-key", {
    token: ownerAuth.token,
  });
  const bindKey = ownerKey.bind_key || ownerKey.key;
  assert(typeof bindKey === "string" && bindKey.length > 0, "Missing bind key");
  process.env.TOPICLAB_BIND_KEY = bindKey;

  logStep("upserting minimal twin");
  const twinUpsert = await requestJson("POST", "/api/v1/auth/digital-twins/upsert", {
    token: ownerAuth.token,
    body: {
      agent_name: "my_twin",
      display_name: "Smoke Twin",
      expert_name: "smoke_twin",
      visibility: "private",
      exposure: "brief",
      source: "protocol_smoke",
      role_content: "# Smoke Twin\n\n## Identity\n\nProtocol smoke tester\n\n## Expertise\n\nProtocol verification",
    },
  });
  assert(typeof twinUpsert.twin_id === "string" && twinUpsert.twin_id.length > 0, "Missing twin_id after upsert");

  logStep("checking CLI manifest and policy");
  const manifest = await runCli(["manifest", "get", "--json"]);
  assert(manifest.cli_name === "topiclab", "Unexpected manifest payload");
  const policy = await runCli(["policy", "get", "--json"]);
  assert(policy.client_kind === "cli", "Unexpected policy payload");

  logStep("bootstrapping session");
  const session = await runCli(["session", "ensure", "--json"]);
  assert(session.ok === true, "session ensure failed");

  logStep("checking notifications");
  const emptyNotifications = await runCli(["notifications", "list", "--json"]);
  assert(Array.isArray(emptyNotifications.items), "notifications list did not return items");

  logStep("reading twin current/runtime profile");
  const currentTwin = await runCli(["twins", "current", "--json"]);
  const twinId = currentTwin?.twin?.twin_id;
  assert(typeof twinId === "string" && twinId.length > 0, "twins current did not resolve twin_id");
  const runtimeProfileBefore = await runCli(["twins", "runtime-profile", "--json"]);
  assert(runtimeProfileBefore.runtime_profile, "runtime-profile missing runtime_profile");

  logStep("writing runtime state and requirement event");
  const runtimeState = await runCli([
    "twins",
    "runtime-state",
    "set",
    "--active-scene",
    "forum.request",
    "--current-focus",
    '{"goal":"verify_cli_runner"}',
    "--recent-threads",
    '["protocol-smoke"]',
    "--recent-style-shift",
    '{"tone":"direct"}',
    "--json",
  ]);
  assert(runtimeState.ok === true, "runtime-state set failed");

  const requirement = await runCli([
    "twins",
    "requirements",
    "report",
    "--kind",
    "explicit_requirement",
    "--topic",
    "reply_style",
    "--statement",
    "Prefer concise updates during smoke runs",
    "--normalized-json",
    '{"verbosity":"low","shape":"concise"}',
    "--json",
  ]);
  assert(typeof requirement.observation_id === "string", "requirements report did not create observation");

  const observation = await runCli([
    "twins",
    "observations",
    "append",
    "--observation-type",
    "conversation_summary",
    "--payload",
    '{"summary":"Protocol smoke validation via topiclab CLI.","source":"protocol_smoke"}',
    "--json",
  ]);
  assert(typeof observation.observation_id === "string", "observations append did not create observation");

  const version = await runCli(["twins", "version", "--json"]);
  assert(typeof version.core_version === "number", "twins version missing core_version");

  logStep("reading topics home/search and creating topic");
  const home = await runCli(["topics", "home", "--json"]);
  assert(typeof home === "object" && home !== null, "topics home returned unexpected payload");
  const searchTerm = `protocol smoke ${Date.now()}`;
  const searchBefore = await runCli(["topics", "search", "--q", searchTerm, "--json"]);
  assert(Array.isArray(searchBefore.items), "topics search missing items");

  const createdTopic = await runCli([
    "topics",
    "create",
    "--title",
    `Protocol smoke ${Date.now()}`,
    "--body",
    "This topic is created by the TopicLab protocol smoke test.",
    "--category",
    "request",
    "--json",
  ]);
  const topicId = createdTopic.id;
  assert(typeof topicId === "string" && topicId.length > 0, "topics create did not return topic id");

  logStep("reading topic and replying as owner/helper");
  const topic = await runCli(["topics", "read", topicId, "--json"]);
  assert(topic.id === topicId, "topics read returned wrong topic");

  const ownerReply = await runCli([
    "topics",
    "reply",
    topicId,
    "--body",
    "Owner reply from protocol smoke.",
    "--json",
  ]);
  const parentPostId = ownerReply?.post?.id;
  assert(typeof parentPostId === "string" && parentPostId.length > 0, "owner reply did not create post");

  await requestJson("POST", `/api/v1/topics/${topicId}/posts`, {
    token: helperAuth.token,
    body: {
      author: helperAuth.user.username,
      body: "Helper reply that should create an inbox notification.",
      in_reply_to_id: parentPostId,
    },
  });

  logStep("reading and clearing notifications");
  const notifications = await runCli(["notifications", "list", "--json"]);
  assert(Array.isArray(notifications.items) && notifications.items.length > 0, "expected at least one notification");
  const messageId = notifications.items[0]?.id;
  assert(typeof messageId === "string" && messageId.length > 0, "notification id missing");

  const inbox = await runCli(["topics", "inbox", "--json"]);
  assert(Array.isArray(inbox.items), "topics inbox did not return items");

  const readOne = await runCli(["notifications", "read", messageId, "--json"]);
  assert(readOne.ok === true, "notifications read failed");
  const readAll = await runCli(["notifications", "read-all", "--json"]);
  assert(readAll.ok === true, "notifications read-all failed");

  logStep("uploading media");
  let media = null;
  let mediaUploadSkipped = false;
  let mediaUploadSkipReason = null;
  if (TOPICLAB_SMOKE_SKIP_MEDIA_UPLOAD) {
    mediaUploadSkipped = true;
    mediaUploadSkipReason = "disabled_by_env";
    logStep("skipping media upload because OSS env is incomplete");
  } else {
    try {
      media = await runCli(["media", "upload", topicId, "--file", TOPICLAB_SMOKE_MEDIA_FILE, "--json"]);
      assert(typeof media.url === "string" && media.url.length > 0, "media upload failed");
    } catch (error) {
      if (!isSkippableMediaUploadError(error)) {
        throw error;
      }
      mediaUploadSkipped = true;
      mediaUploadSkipReason = "infra_unavailable";
      logStep(`media upload skipped after infrastructure failure: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  logStep("starting discussion");
  const discussion = await runCli([
    "discussion",
    "start",
    topicId,
    "--num-rounds",
    "1",
    "--max-turns",
    "2000",
    "--max-budget-usd",
    "5",
    "--json",
  ]);
  assert(discussion.status === "running", "discussion start did not return running status");

  logStep("verifying help skill refresh response");
  const help = await runCli(["help", "ask", "I hit a 401 during smoke.", "--json"]);
  assert(
    help?.help_source === "website_skill" || help?.help_source === "agent_stream",
    "help ask did not return a supported help source",
  );
  if (help?.help_source === "website_skill") {
    assert(help?.should_refresh_skill === true, "help ask did not request skill refresh");
    assert(typeof help?.skill_url === "string" && help.skill_url.includes("/api/v1/openclaw/skill.md"), "help ask did not return skill_url");
  } else {
    assert(help?.mode === "agent_invoke", "help ask agent response did not report agent_invoke mode");
    assert(typeof help?.event_count === "number", "help ask agent response did not report event_count");
    assert(Array.isArray(help?.events), "help ask agent response did not include events");
  }

  const runtimeProfileAfter = await runCli(["twins", "runtime-profile", "--json"]);
  assert(runtimeProfileAfter.runtime_profile, "runtime-profile failed after writes");

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      cli_bin: TOPICLAB_CLI_BIN,
      cli_prefix: TOPICLAB_CLI_PREFIX,
      owner_phone: ownerPhone,
      helper_phone: helperPhone,
      topic_id: topicId,
      twin_id: twinId,
      notification_id: messageId,
      media_upload_skipped: mediaUploadSkipped,
      media_upload_skip_reason: mediaUploadSkipReason,
      media_url: media?.url || null,
      discussion_status: discussion.status,
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `[protocol-smoke] failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );
  process.exit(1);
});
