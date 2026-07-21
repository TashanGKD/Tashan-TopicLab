import base64
import io
import json
import os
import pathlib
import subprocess
import tarfile

import pytest


RUNTIME = {
    "orchestrator": "agentscope",
    "provider": "aistar",
    "model": "glm5.2",
}


def _request(kind: str = "skill") -> dict:
    return {
        "kind": kind,
        "target": "https://github.com/example/research-skill",
        "depth": "full",
        "evaluation_profile": "complete",
        "runtime": RUNTIME,
        "requester_id": 17,
        "source": "topiclab-skill-hub",
    }


def _basic_request(kind: str = "skill") -> dict:
    return {
        **_request(kind),
        "depth": "basic",
        "evaluation_profile": "basic",
    }


def _standard_request(kind: str = "skill") -> dict:
    return {
        **_request(kind),
        "depth": "standard",
        "evaluation_profile": "standard",
    }


def _write_skill(root: pathlib.Path, *, insecure: bool = False) -> pathlib.Path:
    skill = root / "research-skill"
    skill.mkdir(parents=True)
    body = (
        "---\n"
        "name: research-skill\n"
        "description: Reviews a research result using source-backed checks.\n"
        "---\n"
        "Review the supplied research result and report the evidence.\n"
    )
    if insecure:
        body += "Example credential: " + "sk-" + ("A" * 24) + "\n"
    (skill / "SKILL.md").write_text(body, encoding="utf-8")
    return skill


def test_research_scripts_resolve_from_builtin_runtime_roots(
    monkeypatch, tmp_path
):
    from app import critic_runner

    kernel = tmp_path / "mcp-kernel"
    (kernel / "src" / "core").mkdir(parents=True)
    research = tmp_path / "research-skills"
    (research / "skills" / "find-science-skills" / "scripts").mkdir(parents=True)
    (research / "skills" / "skill-criticagent").mkdir(parents=True)
    (research / "skills" / "skill-criticagent" / "SKILL.md").write_text(
        "# CriticAgent\n", encoding="utf-8"
    )
    monkeypatch.setattr(critic_runner, "DEFAULT_CRITIC_RESEARCH_ROOTS", (research,))

    assert critic_runner._critic_research_root(kernel) == research.resolve()


def test_vendored_kernel_can_be_resolved_from_research_root(tmp_path):
    from app.critic_runner import _vendored_kernel_root

    research = tmp_path / "research-skills"
    vendor = research / "skills" / "skill-criticagent" / "vendor" / "mcp_criticagent"
    (vendor / "src" / "core").mkdir(parents=True)
    (vendor / "src" / "core" / "skill_validator.py").write_text("# validator\n", encoding="utf-8")

    assert _vendored_kernel_root(research) == vendor.resolve()


def test_runner_rejects_non_github_and_credentialed_targets():
    from app.critic_runner import parse_github_target

    with pytest.raises(ValueError, match="GitHub HTTPS"):
        parse_github_target("https://example.com/org/repo")
    with pytest.raises(ValueError, match="credentials"):
        parse_github_target("https://user:token@github.com/org/repo")
    with pytest.raises(ValueError, match="port"):
        parse_github_target("https://github.com:8443/org/repo")
    with pytest.raises(ValueError, match="query or fragment"):
        parse_github_target("https://github.com/org/repo?token=untrusted")

    parsed = parse_github_target(
        "https://github.com/org/repo/tree/main/skills/research-skill"
    )
    assert parsed == {
        "repository_url": "https://github.com/org/repo.git",
        "requested_ref": "main",
        "requested_subpath": "skills/research-skill",
    }


def test_locate_skill_dir_accepts_skill_file_subpath(tmp_path):
    from app.critic_runner import _locate_skill_dir

    source = tmp_path / "source"
    source.mkdir()
    (source / "SKILL.md").write_text("# Root skill\n", encoding="utf-8")

    assert _locate_skill_dir(source, "SKILL.md") == source.resolve()


def test_github_contents_api_fallback_preserves_source_provenance(monkeypatch, tmp_path):
    from app import critic_runner

    job = tmp_path / "job"
    job.mkdir()
    content = "---\nname: research-skill\ndescription: Read-only review.\n---\n"
    payloads = {
        "/commits/main": {"sha": "commit-sha"},
        "/contents/skills/research-skill": [
            {
                "type": "file",
                "path": "skills/research-skill/SKILL.md",
                "sha": "blob-sha",
            }
        ],
        "/contents/skills/research-skill/SKILL.md": {
            "type": "file",
            "path": "skills/research-skill/SKILL.md",
            "sha": "blob-sha",
            "encoding": "base64",
            "content": base64.b64encode(content.encode()).decode(),
        },
    }

    class FakeResponse:
        status = 200

        def __init__(self, payload):
            self.payload = json.dumps(payload).encode()

        def read(self):
            return self.payload

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_urlopen(request, timeout):
        requested_url = request.full_url.split("?", 1)[0]
        for suffix, payload in sorted(payloads.items(), key=lambda item: len(item[0]), reverse=True):
            if requested_url.endswith(suffix):
                return FakeResponse(payload)
        raise AssertionError(request.full_url)

    def unexpected_clone(command, **kwargs):
        raise AssertionError("a GitHub subpath should use the read-only contents snapshot first")

    monkeypatch.setattr(critic_runner.subprocess, "Popen", lambda *args, **kwargs: None)
    monkeypatch.setattr(critic_runner, "_run_bounded_process", unexpected_clone)
    monkeypatch.setattr(critic_runner.urllib.request, "urlopen", fake_urlopen)

    source, provenance = critic_runner._acquire_github(
        "https://github.com/org/repo/tree/main/skills/research-skill",
        job,
    )

    assert source == (job / "source-api").resolve()
    assert (source / "skills" / "research-skill" / "SKILL.md").read_text() == content
    assert provenance["acquisition"] == "github-contents-api-read-only-source-review"
    assert provenance["commit_sha"] == "commit-sha"
    assert provenance["files"][0]["blob_sha"] == "blob-sha"


def test_github_repository_prefers_official_codeload_archive(monkeypatch, tmp_path):
    from app import critic_runner

    job = tmp_path / "job"
    job.mkdir()
    archive_buffer = io.BytesIO()
    with tarfile.open(fileobj=archive_buffer, mode="w:gz") as archive:
        payload = b"# Context7\n"
        member = tarfile.TarInfo("context7-HEAD/README.md")
        member.size = len(payload)
        archive.addfile(member, io.BytesIO(payload))
    archive_bytes = archive_buffer.getvalue()

    class FakeResponse:
        headers = {"ETag": '"archive-etag"'}

        def __init__(self):
            self.offset = 0

        def read(self, size=-1):
            if size < 0:
                size = len(archive_bytes) - self.offset
            chunk = archive_bytes[self.offset:self.offset + size]
            self.offset += len(chunk)
            return chunk

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_urlopen(request, timeout):
        assert request.full_url == "https://codeload.github.com/upstash/context7/tar.gz/HEAD"
        assert timeout == 45
        return FakeResponse()

    def unexpected_clone(command, **kwargs):
        raise AssertionError("the official read-only archive should be used before git clone")

    monkeypatch.setattr(critic_runner.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(critic_runner, "_run_bounded_process", unexpected_clone)

    source, provenance = critic_runner._acquire_github(
        "https://github.com/upstash/context7",
        job,
    )

    assert source == (job / "source-archive" / "context7-HEAD").resolve()
    assert (source / "README.md").read_text() == "# Context7\n"
    assert provenance["acquisition"] == "github-codeload-archive-read-only-source-review"
    assert provenance["archive_sha256"] == critic_runner.hashlib.sha256(archive_bytes).hexdigest()
    assert provenance["archive_etag"] == '"archive-etag"'


def test_github_codeload_archive_rejects_path_escape(monkeypatch, tmp_path):
    from app import critic_runner

    job = tmp_path / "job"
    job.mkdir()
    archive_buffer = io.BytesIO()
    with tarfile.open(fileobj=archive_buffer, mode="w:gz") as archive:
        payload = b"escape"
        member = tarfile.TarInfo("../escape.txt")
        member.size = len(payload)
        archive.addfile(member, io.BytesIO(payload))
    archive_bytes = archive_buffer.getvalue()

    class FakeResponse:
        headers = {}

        def __init__(self):
            self.offset = 0

        def read(self, size=-1):
            if size < 0:
                size = len(archive_bytes) - self.offset
            chunk = archive_bytes[self.offset:self.offset + size]
            self.offset += len(chunk)
            return chunk

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(critic_runner.urllib.request, "urlopen", lambda request, timeout: FakeResponse())

    with pytest.raises(RuntimeError, match="unsafe path"):
        critic_runner._acquire_github_archive(
            critic_runner.parse_github_target("https://github.com/upstash/context7"),
            job,
            "https://github.com/upstash/context7",
            "",
        )
    assert not (tmp_path / "escape.txt").exists()


def test_github_codeload_archive_uses_short_ephemeral_root_for_long_job_path(monkeypatch, tmp_path):
    from app import critic_runner

    job = tmp_path
    while len(str((job / "source-archive").resolve())) <= 160:
        job /= "long-job-path"
    job.mkdir(parents=True)
    short_temp = tmp_path / "short"
    archive_buffer = io.BytesIO()
    with tarfile.open(fileobj=archive_buffer, mode="w:gz") as archive:
        payload = b"# Context7\n"
        member = tarfile.TarInfo("context7-HEAD/deep/path/README.md")
        member.size = len(payload)
        archive.addfile(member, io.BytesIO(payload))
    archive_bytes = archive_buffer.getvalue()

    class FakeResponse:
        headers = {}

        def __init__(self):
            self.offset = 0

        def read(self, size=-1):
            if size < 0:
                size = len(archive_bytes) - self.offset
            chunk = archive_bytes[self.offset:self.offset + size]
            self.offset += len(chunk)
            return chunk

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(critic_runner.urllib.request, "urlopen", lambda request, timeout: FakeResponse())
    monkeypatch.setattr(critic_runner.tempfile, "gettempdir", lambda: str(short_temp))

    source, provenance = critic_runner._acquire_github_archive(
        critic_runner.parse_github_target("https://github.com/upstash/context7"),
        job,
        "https://github.com/upstash/context7",
        "",
    )

    assert provenance["ephemeral_source_snapshot"] is True
    assert job.resolve() not in source.parents
    assert (source / "deep" / "path" / "README.md").is_file()


def test_provider_environment_uses_skillhub_scnet_api_key(monkeypatch):
    from app.critic_runner import _provider_environment

    monkeypatch.delenv("skillhub_scnet_api_key", raising=False)
    monkeypatch.setenv("skillhub_scnet_api_key", "skillhub-scnet-test-key")
    monkeypatch.setenv("SCNET_API_KEY", "topiclink-scnet-test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://secret.invalid/topiclab")
    monkeypatch.setenv("JWT_SECRET", "must-not-reach-runner")
    monkeypatch.delenv("SCNET_BASE_URL", raising=False)

    environment, base_url, model = _provider_environment()

    assert environment["CRITIC_WORKER_PROVIDER_KEY"] == "skillhub-scnet-test-key"
    assert "SCNET_API_KEY" not in environment
    assert "DATABASE_URL" not in environment
    assert "JWT_SECRET" not in environment
    assert base_url == "https://api.scnet.cn/api/llm/v1"
    assert model == "GLM-5.2"


def test_mcp_provider_environment_adapts_worker_secret_to_original_engine(monkeypatch):
    from app.critic_runner import _mcp_provider_environment

    monkeypatch.setenv("skillhub_scnet_api_key", "memory-only-test-key")

    environment = _mcp_provider_environment()

    assert environment["OPENAI_API_KEY"] == "memory-only-test-key"
    assert environment["OPENAI_BASE_URL"] == "https://api.scnet.cn/api/llm/v1"
    assert environment["OPENAI_MODEL"] == "GLM-5.2"


def test_provider_repair_command_is_read_only_without_mounting_a_skill(tmp_path):
    from app.critic_runner import _provider_command

    command = _provider_command(
        tmp_path / "runner.py",
        workspace=tmp_path / "workspace",
        prompt=tmp_path / "repair-prompt.txt",
        output=tmp_path / "provider-report.json",
        model="GLM-5.2",
        base_url="https://provider.example/v1",
        skill_dir=None,
        skill_only=False,
    )

    assert "--allow-no-tool" in command
    assert "--guidance-only" in command
    assert "--skill-dir" not in command
    assert "--allow-command" not in command
    assert "--allow-output" not in command


def test_provider_stage_retries_missing_mounted_skill_invocation_once(monkeypatch, tmp_path):
    from app import critic_runner

    attempts = []
    output = tmp_path / "provider-report.json"

    def fake_run(command, *, cwd, archive_prefix, timeout, env):
        attempts.append((command, cwd, archive_prefix, timeout, env))
        payload = {
            "status": "missing_skill_invocation" if len(attempts) == 1 else "pass",
            "skill_invocation_count": 0 if len(attempts) == 1 else 1,
        }
        output.write_text(json.dumps(payload), encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(critic_runner, "_run_archived_command", fake_run)
    report = critic_runner._run_provider_stage(
        tmp_path / "runner.py",
        stage_dir=tmp_path / "stage",
        prompt=tmp_path / "prompt.txt",
        output=output,
        environment={"CRITIC_WORKER_PROVIDER_KEY": "memory-only"},
        model="GLM-5.2",
        base_url="https://provider.example/v1",
        skill_dir=tmp_path / "skill",
        skill_only=True,
    )

    assert report["status"] == "pass"
    assert len(attempts) == 2
    assert output.with_name("provider-report.invalid-attempt-1.json").is_file()


def test_basic_criticagent_uses_one_mounted_source_review_call(monkeypatch, tmp_path):
    from app import critic_runner

    research = tmp_path / "research"
    scripts = research / "skills" / "find-science-skills" / "scripts"
    scripts.mkdir(parents=True)
    (scripts / "run_agentscope_critic_provider.py").write_text("# provider\n", encoding="utf-8")
    critic_skill = research / "skills" / "skill-criticagent"
    critic_skill.mkdir(parents=True)
    (critic_skill / "SKILL.md").write_text("# Critic\n", encoding="utf-8")
    source = tmp_path / "source"
    _write_skill(source)
    job = tmp_path / "job"
    job.mkdir()
    calls = []

    monkeypatch.setattr(critic_runner, "_critic_research_root", lambda _: research)
    monkeypatch.setattr(
        critic_runner,
        "_provider_environment",
        lambda _home=None: ({"CRITIC_WORKER_PROVIDER_KEY": "memory-only"}, "https://provider.invalid/v1", "GLM-5.2"),
    )

    def fake_provider(*args, **kwargs):
        calls.append((args, kwargs))
        return {
            "status": "pass",
            "skill_invocation_count": 1,
            "final_text": json.dumps(
                {
                    "schema": "topiclab_critic_basic_review_v1",
                    "score": 82,
                    "verdict": "recommend_trial",
                    "dimensions": [
                        {"key": "compliance_security", "score": 26, "summary": "规范清楚"},
                        {"key": "instruction_quality", "score": 21, "summary": "步骤完整"},
                        {"key": "task_actionability", "score": 20, "summary": "可直接使用"},
                        {"key": "boundary_clarity", "score": 15, "summary": "边界明确"},
                    ],
                    "limitations": ["未执行真实带与不带 Skill 的任务对照"],
                },
                ensure_ascii=False,
            ),
        }

    monkeypatch.setattr(critic_runner, "_run_provider_stage", fake_provider)
    result = critic_runner.run_basic_criticagent(
        _basic_request(), source / "research-skill", job, kernel_root=tmp_path / "kernel"
    )

    assert result["status"] == "completed"
    assert result["score"] == 82
    assert result["evidence"]["source_review_calls"] == 1
    assert result["evidence"]["behavior_pairs"] == 0
    assert len(calls) == 1
    assert calls[0][1]["skill_dir"] == critic_skill
    assert calls[0][1]["skill_only"] is True
    assert calls[0][1]["retry_missing_skill_invocation"] is False


def test_standard_criticagent_uses_exactly_four_mounted_calls(monkeypatch, tmp_path):
    from app import critic_runner

    research = tmp_path / "research"
    scripts = research / "skills" / "find-science-skills" / "scripts"
    scripts.mkdir(parents=True)
    (scripts / "run_agentscope_critic_provider.py").write_text("# provider\n", encoding="utf-8")
    critic_skill = research / "skills" / "skill-criticagent"
    critic_skill.mkdir(parents=True)
    (critic_skill / "SKILL.md").write_text("# Critic\n", encoding="utf-8")
    source = tmp_path / "source"
    skill_dir = _write_skill(source)
    job = tmp_path / "job"
    job.mkdir()
    calls = []
    outputs = [
        {
            "schema": "topiclab_critic_standard_v1",
            "stage": "plan",
            "execution_mode": "guidance",
            "task": {"prompt": "Draft a concise study plan", "expected_output": "A study plan"},
            "triggers": [
                {"query": f"query-{index}", "should_trigger": index < 4, "reason": "source-backed"}
                for index in range(8)
            ],
        },
        {
            "schema": "topiclab_critic_standard_v1",
            "stage": "execution",
            "status": "completed",
            "response_summary": "Produced the requested study plan",
            "response": "Plan with objective, variables, procedure, and limitations.",
            "artifacts": [],
        },
        {
            "schema": "topiclab_critic_standard_v1",
            "stage": "triggers",
            "decisions": [
                {"query": f"query-{index}", "should_trigger": index < 4, "reason": "matched"}
                for index in range(8)
            ],
        },
        {
            "schema": "topiclab_critic_standard_v1",
            "stage": "review",
            "score": 84,
            "verdict": "recommend_trial",
            "dimensions": [
                {"key": "compliance_security", "score": 27, "summary": "No critical issue"},
                {"key": "task_effectiveness", "score": 22, "summary": "Representative task completed"},
                {"key": "trigger_quality", "score": 20, "summary": "Eight decisions matched"},
                {"key": "boundary_clarity", "score": 15, "summary": "Limitations are stated"},
            ],
            "limitations": ["No with/without comparison was run"],
        },
    ]

    monkeypatch.setattr(critic_runner, "_critic_research_root", lambda _: research)
    monkeypatch.setattr(
        critic_runner,
        "_provider_environment",
        lambda _home=None: ({"CRITIC_WORKER_PROVIDER_KEY": "memory-only"}, "https://provider.invalid/v1", "GLM-5.2"),
    )

    def fake_provider(*args, **kwargs):
        calls.append((args, kwargs))
        return {
            "status": "pass",
            "skill_invocation_count": 1,
            "final_text": json.dumps(outputs[len(calls) - 1]),
        }

    monkeypatch.setattr(critic_runner, "_run_provider_stage", fake_provider)
    result = critic_runner.run_standard_criticagent(
        _standard_request(), skill_dir, job, kernel_root=tmp_path / "kernel"
    )

    assert result["status"] == "completed"
    assert result["score"] == 84
    assert result["evidence"]["provider_calls"] == 4
    assert result["evidence"]["behavior_cases"] == 1
    assert result["evidence"]["behavior_pairs"] == 0
    assert result["evidence"]["trigger_queries"] == 8
    assert result["evidence"]["final_adjudications"] == 1
    assert len(calls) == 4
    assert [call[1]["skill_dir"] for call in calls] == [skill_dir, skill_dir, skill_dir, critic_skill]
    assert all(call[1]["retry_missing_skill_invocation"] is False for call in calls)
    prompts = [
        (job / "standard-review" / name / "prompt.txt").read_text(encoding="utf-8")
        for name in ("plan", "execution", "triggers", "adjudication")
    ]
    assert all("所有面向用户的叙述必须使用简体中文" in prompt for prompt in prompts)
    assert "Sealed source snapshot:" in prompts[1]
    assert "Every dimensions object must include its numeric score" in prompts[3]
    trace = [
        json.loads(line)
        for line in (job / "progress-events.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [event["kind"] for event in trace if event["kind"] != "status"] == [
        "reasoning",
        "execution",
        "evidence",
        "result",
    ]
    assert next(event for event in trace if event["kind"] == "reasoning")["details"] == [
        "使用方式：guidance",
        "代表任务：Draft a concise study plan",
        "触发样例：4 条应触发，4 条不应触发",
    ]
    assert next(event for event in trace if event["kind"] == "execution")["summary"] == (
        "Produced the requested study plan"
    )
    trigger_event = next(event for event in trace if event["kind"] == "evidence")
    assert trigger_event["summary"] == "8 / 8 条触发判断符合预期"
    assert len(trigger_event["details"]) == 8
    result_event = next(event for event in trace if event["kind"] == "result")
    assert result_event["summary"] == "建议试用 · 84 分"
    assert result_event["details"] == [
        "规范与安全：No critical issue",
        "实际帮助：Representative task completed",
        "触发边界：Eight decisions matched",
        "适用边界：Limitations are stated",
    ]
    assert [event["summary"] for event in trace if event["kind"] == "status"] == [
        "正在判断使用方式并设计一项代表性任务",
        "模型响应已返回，正在校验任务设计与挂载记录",
        "正在执行一项代表性任务",
        "代表任务结果已返回，正在核验执行内容",
        "正在一次性核对八条触发请求",
        "触发判断已返回，正在核验八条结果",
        "正在由 CriticAgent 形成最终结论",
        "CriticAgent 已返回结论，正在核验评分一致性",
    ]


def test_standard_execution_repairs_unescaped_quotes_without_another_provider_call():
    from app.critic_runner import _extract_standard_execution

    result = _extract_standard_execution(
        "```json\n"
        '{"schema":"topiclab_critic_standard_v1","stage":"execution","status":"completed",'
        '"response_summary":"Applied the decision tree","response":"Use the "single unit" '
        'branch, then report the result.","artifacts":[]}\n'
        "```"
    )

    assert result["response"] == 'Use the "single unit" branch, then report the result.'


def test_trace_writer_skips_exact_duplicate_events(tmp_path):
    from app.critic_runner import _write_trace_event

    _write_trace_event(tmp_path, "validation", "status", "规范与安全", "正在封存来源")
    _write_trace_event(tmp_path, "validation", "status", "规范与安全", "正在封存来源")

    events = (tmp_path / "progress-events.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(events) == 1


def test_skill_static_pass_is_archived_but_not_reported_as_complete(tmp_path):
    from app.critic_runner import evaluate_acquired_source

    source = tmp_path / "source"
    _write_skill(source)
    job_dir = tmp_path / "job"
    kernel = tmp_path / "critic-kernel"
    kernel.mkdir()

    def validate(skill_dir, kernel_root):
        assert skill_dir.name == "research-skill"
        assert kernel_root == kernel
        return {
            "valid": True,
            "errors": [],
            "warnings": [],
            "summary": {"security_findings": []},
        }

    result = evaluate_acquired_source(
        _request(),
        source,
        job_dir,
        kernel_root=kernel,
        provenance={"repository_url": "https://github.com/example/research-skill.git", "commit_sha": "abc123"},
        validator=validate,
    )

    assert result["status"] == "blocked"
    assert result["evaluation_profile_status"] == "incomplete"
    assert result["blocker"] == "skill_execution_engine_missing"
    assert "score" not in result
    assert "verdict" not in result
    assert result["evidence"]["source_before_sha256"] == result["evidence"]["source_after_sha256"]
    assert json.loads((job_dir / "static-validation.json").read_text(encoding="utf-8"))["valid"] is True
    assert (job_dir / "source-manifest.json").is_file()
    assert (job_dir / "provenance.json").is_file()


def test_skill_complete_engine_requires_full_behavior_trigger_and_adjudication_evidence(tmp_path):
    from app.critic_runner import evaluate_acquired_source

    source = tmp_path / "source"
    skill = _write_skill(source)
    job_dir = tmp_path / "job"
    kernel = tmp_path / "critic-kernel"
    kernel.mkdir()
    calls = []

    def evaluate(request, skill_dir, run_dir):
        calls.append((request, skill_dir, run_dir))
        progress = json.loads((run_dir / "progress.json").read_text(encoding="utf-8"))
        assert progress == {
            "current_step": "behavior",
            "completed_steps": ["validation"],
            "total_steps": 4,
            "message": "正在准备真实任务与隔离对照",
        }
        return {
            "status": "completed",
            "verdict": "recommend_install",
            "dimensions": [
                {"key": "behavior", "label": "实际任务", "status": "passed", "summary": "3/3"},
                {"key": "triggers", "label": "触发判断", "status": "passed", "summary": "8/8"},
                {"key": "verdict", "label": "安装结论", "status": "passed", "summary": "建议采用"},
            ],
            "evidence": {
                "behavior_cases": 3,
                "behavior_pairs": 6,
                "trigger_queries": 8,
                "final_adjudications": 1,
                "artifacts": 17,
            },
        }

    result = evaluate_acquired_source(
        _request(),
        source,
        job_dir,
        kernel_root=kernel,
        provenance={"repository_url": "https://github.com/example/research-skill.git", "commit_sha": "abc123"},
        validator=lambda *_: {"valid": True, "errors": [], "warnings": [], "summary": {}},
        skill_evaluator=evaluate,
    )

    assert calls == [(_request(), skill.resolve(), job_dir)]
    assert result["status"] == "completed"
    assert result["evaluation_profile_status"] == "complete"
    assert result["evidence"]["behavior_pairs"] == 6
    assert result["evidence"]["trigger_queries"] == 8
    assert result["evidence"]["final_adjudications"] == 1


def test_skill_basic_engine_accepts_one_source_review_without_behavior_claims(tmp_path):
    from app.critic_runner import evaluate_acquired_source

    source = tmp_path / "source"
    skill = _write_skill(source)
    job_dir = tmp_path / "job"
    kernel = tmp_path / "critic-kernel"
    kernel.mkdir()

    def evaluate(request, skill_dir, run_dir):
        assert request == _basic_request()
        assert skill_dir == skill.resolve()
        assert json.loads((run_dir / "progress.json").read_text(encoding="utf-8")) == {
            "current_step": "behavior",
            "completed_steps": ["validation"],
            "total_steps": 4,
            "message": "规范与安全检查已通过，正在进行一次基础内容评审",
        }
        return {
            "status": "completed",
            "verdict": "建议试用",
            "score": 82,
            "dimensions": [
                {"key": "quality", "label": "内容质量", "status": "passed", "summary": "步骤清楚"},
            ],
            "limitations": ["基础评测未执行真实任务对照"],
            "evidence": {
                "source_review_calls": 1,
                "behavior_cases": 0,
                "behavior_pairs": 0,
                "trigger_queries": 0,
                "final_adjudications": 0,
            },
        }

    result = evaluate_acquired_source(
        _basic_request(),
        source,
        job_dir,
        kernel_root=kernel,
        provenance={"repository_url": "https://github.com/example/research-skill.git", "commit_sha": "abc123"},
        validator=lambda *_: {"valid": True, "errors": [], "warnings": [], "summary": {}},
        skill_evaluator=evaluate,
    )

    assert result["status"] == "completed"
    assert result["evaluation_profile_status"] == "basic_complete"
    assert result["score"] == 82
    assert result["evidence"]["source_review_calls"] == 1
    assert result["evidence"]["behavior_pairs"] == 0


def test_skill_complete_engine_fails_closed_when_any_contract_layer_is_missing(tmp_path):
    from app.critic_runner import evaluate_acquired_source

    source = tmp_path / "source"
    _write_skill(source)
    job_dir = tmp_path / "job"
    kernel = tmp_path / "critic-kernel"
    kernel.mkdir()

    result = evaluate_acquired_source(
        _request(),
        source,
        job_dir,
        kernel_root=kernel,
        provenance={"repository_url": "https://github.com/example/research-skill.git", "commit_sha": "abc123"},
        validator=lambda *_: {"valid": True, "errors": [], "warnings": [], "summary": {}},
        skill_evaluator=lambda *_: {
            "status": "completed",
            "verdict": "recommend_install",
            "evidence": {
                "behavior_cases": 3,
                "behavior_pairs": 6,
                "trigger_queries": 8,
                "final_adjudications": 0,
            },
        },
    )

    assert result["status"] == "blocked"
    assert result["blocker"] == "skill_evidence_incomplete"
    assert result["evaluation_profile_status"] == "incomplete"


def test_skill_evaluation_block_preserves_stage_without_blaming_skill(tmp_path):
    from app.critic_runner import evaluate_acquired_source

    source = tmp_path / "source"
    _write_skill(source)
    job_dir = tmp_path / "job"
    kernel = tmp_path / "critic-kernel"
    kernel.mkdir()

    result = evaluate_acquired_source(
        _request(),
        source,
        job_dir,
        kernel_root=kernel,
        provenance={"repository_url": "https://github.com/example/research-skill.git", "commit_sha": "abc123"},
        validator=lambda *_: {"valid": True, "errors": [], "warnings": [], "summary": {}},
        skill_evaluator=lambda *_: {
            "status": "blocked",
            "blocker": "skill_complete_evaluation_blocked",
            "message": "评测任务设计未通过来源一致性复核，未对 Skill 形成质量结论",
            "failure_type": "ValueError",
            "failure_stage": "independent Eval Reviewer did not approve the package",
        },
    )

    assert result["message"] == "评测任务设计未通过来源一致性复核，未对 Skill 形成质量结论"
    assert result["failure_type"] == "ValueError"
    assert result["failure_stage"] == "independent Eval Reviewer did not approve the package"


def test_security_failure_is_terminal_without_behavior_claims(tmp_path):
    from app.critic_runner import evaluate_acquired_source

    source = tmp_path / "source"
    _write_skill(source, insecure=True)
    job_dir = tmp_path / "job"
    kernel = tmp_path / "kernel"
    kernel.mkdir()

    result = evaluate_acquired_source(
        _request(),
        source,
        job_dir,
        kernel_root=kernel,
        provenance={"repository_url": "https://github.com/example/research-skill.git", "commit_sha": "abc123"},
        validator=lambda *_: {
            "valid": False,
            "errors": ["Security (hardcoded-secret) at SKILL.md:6: redacted"],
            "warnings": [],
            "summary": {
                "security_findings": [
                    {"severity": "high", "rule": "hardcoded-secret", "path": "SKILL.md", "line": 6}
                ]
            },
        },
    )

    assert result["status"] == "blocked"
    assert result["blocker"] == "security_blocked"
    assert result["evaluation_profile_status"] == "not_started"
    assert result["evidence"]["behavior_cases"] == 0
    assert result["evidence"]["trigger_queries"] == 0
    assert "score" not in result


def test_mcp_source_is_archived_and_honestly_blocked_without_engine(tmp_path):
    from app.critic_runner import evaluate_acquired_source

    source = tmp_path / "source"
    source.mkdir()
    (source / "README.md").write_text("# Example MCP", encoding="utf-8")
    job_dir = tmp_path / "job"

    request = _request("mcp")
    request["target"] = "https://github.com/example/mcp"
    result = evaluate_acquired_source(
        request,
        source,
        job_dir,
        kernel_root=tmp_path / "unused-kernel",
        provenance={"repository_url": "https://github.com/example/mcp.git", "commit_sha": "abc123"},
    )

    assert result["status"] == "blocked"
    assert result["blocker"] == "mcp_execution_engine_missing"
    assert result["evaluation_profile_status"] == "not_started"
    assert result["evidence"]["source_before_sha256"] == result["evidence"]["source_after_sha256"]
    assert "score" not in result


def test_mcp_complete_engine_requires_and_archives_all_three_layers(tmp_path):
    from app.critic_runner import evaluate_acquired_source

    source = tmp_path / "source"
    source.mkdir()
    (source / "README.md").write_text("# Example MCP", encoding="utf-8")
    job_dir = tmp_path / "job"

    def evaluate(request, source_root, run_dir):
        assert request["target"] == "https://github.com/example/mcp"
        assert source_root == source.resolve()
        assert run_dir == job_dir
        return {
            "status": "completed",
            "verdict": "谨慎使用",
            "score": 78,
            "layers": {
                "deploy_protocol": {
                    "status": "passed",
                    "deployment_success": True,
                    "communication_success": True,
                    "available_tools_count": 3,
                    "first_tool_call_attempted": True,
                },
                "behavior": {
                    "status": "passed",
                    "generated_cases": 3,
                    "executed_cases": 3,
                    "passed_cases": 2,
                    "smart_test_provider_calls": 4,
                },
                "repository_health": {
                    "status": "passed",
                    "final_score": 81,
                },
            },
            "dimensions": [],
            "limitations": [],
        }

    request = _request("mcp")
    request["target"] = "https://github.com/example/mcp"
    result = evaluate_acquired_source(
        request,
        source,
        job_dir,
        kernel_root=tmp_path / "unused-kernel",
        provenance={"repository_url": "https://github.com/example/mcp.git", "commit_sha": "abc123"},
        mcp_evaluator=evaluate,
    )

    assert result["status"] == "completed"
    assert result["evaluation_profile_status"] == "complete"
    assert result["evidence"]["mcp_layers_completed"] == 3
    assert result["evidence"]["source_before_sha256"] == result["evidence"]["source_after_sha256"]
    assert json.loads((job_dir / "mcp-evaluation.json").read_text(encoding="utf-8"))["score"] == 78


def test_mcp_engine_output_missing_behavior_evidence_fails_closed(tmp_path):
    from app.critic_runner import evaluate_acquired_source

    source = tmp_path / "source"
    source.mkdir()
    (source / "README.md").write_text("# Example MCP", encoding="utf-8")

    result = evaluate_acquired_source(
        _request("mcp"),
        source,
        tmp_path / "job",
        kernel_root=tmp_path / "unused-kernel",
        provenance={"repository_url": "https://github.com/example/mcp.git", "commit_sha": "abc123"},
        mcp_evaluator=lambda *_: {
            "status": "completed",
            "layers": {
                "deploy_protocol": {"status": "passed"},
                "repository_health": {"status": "passed"},
            },
        },
    )

    assert result["status"] == "blocked"
    assert result["blocker"] == "mcp_evidence_incomplete"
    assert result["evaluation_profile_status"] == "incomplete"
    assert "score" not in result


def test_mcp_engine_blocker_is_not_relabelled_as_skill_evidence_failure(tmp_path):
    from app.critic_runner import evaluate_acquired_source

    source = tmp_path / "source"
    source.mkdir()
    (source / "README.md").write_text("# Example MCP", encoding="utf-8")
    result = evaluate_acquired_source(
        _request("mcp"),
        source,
        tmp_path / "job",
        kernel_root=tmp_path / "unused-kernel",
        provenance={"repository_url": "https://github.com/example/mcp.git", "commit_sha": "abc123"},
        mcp_evaluator=lambda *_: {
            "status": "blocked",
            "blocker": "mcp_provider_unconfigured",
            "message": "provider missing",
        },
    )

    assert result["status"] == "blocked"
    assert result["blocker"] == "mcp_provider_unconfigured"
    assert result["message"] == "provider missing"


def test_mcp_report_adapter_requires_real_agent_invocations(tmp_path):
    from app.critic_runner import adapt_mcp_critic_report

    report = {
        "deployment_success": True,
        "communication_success": True,
        "available_tools_count": 2,
        "test_results": [
            {"test_name": "search", "success": True, "duration": 0.2},
            {"test_name": "lookup", "success": False, "duration": 0.3},
        ],
        "error_messages": [],
        "evaluation_result": {
            "status": "success",
            "final_score": 84,
            "sustainability": {"total_score": 40},
            "popularity": {"total_score": 44},
        },
    }
    invoke = tmp_path / "logs" / "run-1" / "invoke"
    invoke.mkdir(parents=True)
    (invoke / "model_OpenAIChatWrapper_1.json").write_text(
        json.dumps({"model": "GLM-5.2"}), encoding="utf-8"
    )

    result = adapt_mcp_critic_report(report, tmp_path)

    assert result["status"] == "completed"
    assert result["layers"]["behavior"] == {
        "status": "failed",
        "generated_cases": 2,
        "executed_cases": 2,
        "passed_cases": 1,
        "smart_test_provider_calls": 1,
    }
    assert result["layers"]["repository_health"]["final_score"] == 84
    assert result["verdict"] == "暂不采用"


def test_mcp_report_adapter_rejects_silent_basic_fallback(tmp_path):
    from app.critic_runner import adapt_mcp_critic_report

    result = adapt_mcp_critic_report(
        {
            "deployment_success": True,
            "communication_success": True,
            "available_tools_count": 1,
            "test_results": [{"test_name": "tools/list", "success": True}],
            "evaluation_result": {"status": "success", "final_score": 80},
        },
        tmp_path,
    )

    assert result["status"] == "blocked"
    assert result["blocker"] == "mcp_smart_test_evidence_missing"


def test_bounded_process_terminates_process_on_timeout(monkeypatch, tmp_path):
    from app import critic_runner

    command = ["slow-tool", "--child"]

    class FakeProcess:
        pid = 4242
        returncode = None
        calls = 0
        killed = False

        def communicate(self, timeout=None):
            self.calls += 1
            if self.calls == 1:
                raise subprocess.TimeoutExpired(command, timeout, output="partial", stderr="waiting")
            self.returncode = 1
            return "partial", "terminated"

        def kill(self):
            self.killed = True

    process = FakeProcess()
    cleanup_commands = []
    killed_groups = []
    monkeypatch.setattr(critic_runner.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(critic_runner.os, "killpg", lambda pid, sig: killed_groups.append((pid, sig)))
    monkeypatch.setattr(
        critic_runner.subprocess,
        "run",
        lambda cleanup, **kwargs: cleanup_commands.append(cleanup)
        or subprocess.CompletedProcess(cleanup, 0, stdout="", stderr=""),
    )

    with pytest.raises(subprocess.TimeoutExpired):
        critic_runner._run_bounded_process(command, cwd=tmp_path, timeout=1)

    if os.name == "nt":
        assert cleanup_commands == [["taskkill", "/PID", "4242", "/T", "/F"]]
        assert process.killed is False
    else:
        assert cleanup_commands == []
        assert killed_groups == [(4242, critic_runner.signal.SIGKILL)]
        assert process.killed is False
    assert process.calls == 2


def test_mcp_compatibility_script_is_valid_python():
    from app.critic_runner import _mcp_compatibility_script

    script = _mcp_compatibility_script()
    compile(script, "<mcp-compatibility>", "exec")
    assert "_resolve_url_to_tool" in script
    assert "URLMCPProcessor" in script
    assert "_construct_package_from_github_url" in script
    assert "MCP_TARGET_SOURCE_ROOT" in script
    assert "_package_tool_info" in script
    assert "metadata_info.github_url" in script


def test_original_mcp_criticagent_runs_inside_job_and_preserves_engine(monkeypatch, tmp_path):
    from app.critic_runner import run_mcp_criticagent

    engine = tmp_path / "MCP-CriticAgent"
    (engine / "src").mkdir(parents=True)
    (engine / "src" / "main.py").write_text("# original engine\n", encoding="utf-8")
    job = tmp_path / "job"
    job.mkdir()
    source = job / "source"
    source.mkdir()
    (source / "README.md").write_text("# target\n", encoding="utf-8")
    monkeypatch.setenv("skillhub_scnet_api_key", "memory-only-test-key")

    def execute(command, **kwargs):
        assert kwargs["cwd"] == job
        assert command[1] == "-c"
        assert "_display_evaluation_result" in command[2]
        assert "test_success_rate" in command[2]
        assert "curl.exe" in command[2]
        assert "_evaluator.requests" in command[2]
        assert command[3:5] == ["test-url", "https://github.com/example/mcp"]
        reports = job / "data" / "test_results"
        reports.mkdir(parents=True)
        (reports / "mcp_test_1.json").write_text(
            json.dumps(
                {
                    "deployment_success": True,
                    "communication_success": True,
                    "available_tools_count": 1,
                    "test_results": [{"test_name": "lookup", "success": True}],
                    "evaluation_result": {"status": "success", "final_score": 88},
                    "error_messages": [],
                }
            ),
            encoding="utf-8",
        )
        invoke = job / "logs" / "run-1" / "invoke"
        invoke.mkdir(parents=True)
        (invoke / "model_OpenAIChatWrapper_1.json").write_text("{}", encoding="utf-8")
        cache = engine / "src" / "__pycache__"
        cache.mkdir()
        (cache / "main.cpython-312.pyc").write_bytes(b"generated-cache")
        return subprocess.CompletedProcess(command, 0, stdout="ok", stderr="")

    monkeypatch.setattr("app.critic_runner._run_bounded_process", execute)

    result = run_mcp_criticagent(
        {"target": "https://github.com/example/mcp"},
        source,
        job,
        engine_root=engine,
    )

    assert result["status"] == "completed"
    assert result["layers"]["behavior"]["smart_test_provider_calls"] == 1
    assert (job / "mcp-runner.stdout.txt").read_text(encoding="utf-8") == "ok"
    manifest = json.loads((job / "mcp-engine-manifest.json").read_text(encoding="utf-8"))
    assert manifest["before_sha256"] == manifest["after_sha256"]


def test_original_mcp_criticagent_retries_only_failed_repository_health(monkeypatch, tmp_path):
    from app.critic_runner import run_mcp_criticagent

    engine = tmp_path / "MCP-CriticAgent"
    (engine / "src").mkdir(parents=True)
    (engine / "src" / "main.py").write_text("# original engine\n", encoding="utf-8")
    job = tmp_path / "job"
    job.mkdir()
    source = job / "source"
    source.mkdir()
    (source / "README.md").write_text("# target\n", encoding="utf-8")
    monkeypatch.setenv("skillhub_scnet_api_key", "memory-only-test-key")
    commands = []

    def execute(command, **kwargs):
        commands.append(command)
        if len(command) > 3 and command[3] in {"test-url", "test-package"}:
            reports = job / "data" / "test_results"
            reports.mkdir(parents=True)
            (reports / "mcp_test_1.json").write_text(
                json.dumps(
                    {
                        "deployment_success": True,
                        "communication_success": True,
                        "available_tools_count": 1,
                        "test_results": [{"test_name": "lookup", "success": True}],
                        "tool_info": {"github_url": "https://github.com/example/mcp"},
                        "evaluation_result": {"status": "error", "message": "TLS EOF"},
                        "error_messages": [],
                    }
                ),
                encoding="utf-8",
            )
            invoke = job / "logs" / "run-1" / "invoke"
            invoke.mkdir(parents=True)
            (invoke / "model_OpenAIChatWrapper_1.json").write_text("{}", encoding="utf-8")
            return subprocess.CompletedProcess(command, 0, stdout="first", stderr="")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout='noise\n__MCP_HEALTH_RESULT__{"status":"success","final_score":82}\n',
            stderr="",
        )

    monkeypatch.setattr("app.critic_runner._run_bounded_process", execute)

    result = run_mcp_criticagent(
        {"target": "https://github.com/example/mcp"},
        source,
        job,
        engine_root=engine,
    )

    assert result["status"] == "completed"
    assert len(commands) == 2
    assert (job / "mcp-repository-health-first-failure.json").is_file()
    assert json.loads((job / "mcp-repository-health-retry.json").read_text(encoding="utf-8"))["status"] == "success"


def test_run_request_acquires_npm_source_before_mcp_evaluation(monkeypatch, tmp_path):
    from app import critic_runner

    source = tmp_path / "npm-source"
    source.mkdir()
    (source / "package.json").write_text('{"name":"@scope/mcp"}', encoding="utf-8")
    acquisitions = []

    def acquire(package, job_dir):
        acquisitions.append((package, job_dir))
        return source, {
            "requested_target": package,
            "requested_subpath": None,
            "package_version": "1.2.3",
            "tarball_sha256": "abc123",
        }

    monkeypatch.setattr(critic_runner, "_acquire_npm", acquire)
    monkeypatch.setattr(
        critic_runner,
        "run_standard_criticagent",
        lambda request, source_root, job_dir, *, kernel_root: {
            "status": "completed",
            "score": 90,
            "verdict": "建议采用",
            "evidence": {
                "provider_calls": 4,
                "behavior_cases": 1,
                "trigger_queries": 8,
                "final_adjudications": 1,
            },
        },
    )
    request = _standard_request("mcp")
    request["target"] = "@scope/mcp"

    result = critic_runner.run_request(request, tmp_path / "job", kernel_root=tmp_path / "kernel")

    assert result["status"] == "completed"
    assert acquisitions == [("@scope/mcp", tmp_path / "job")]
