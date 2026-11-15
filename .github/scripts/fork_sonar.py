"""Trusted fork analysis tools. Fork artifacts and Git objects are data only."""

import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile


WORKFLOW_PATH = ".github/workflows/sonar-fork-pr.yml"
SOURCE_ROOTS = ("api/src", "db/src", "ingest", "shared/src", "web")
PACKAGES = ("api", "db", "ingest", "shared", "web")
COVERAGE_PATHS = {f"{package}/coverage/lcov.info" for package in PACKAGES}
MAX_ARCHIVE_SIZE = 32 * 1024 * 1024
MAX_FILE_SIZE = 16 * 1024 * 1024
MAX_SOURCE_SIZE = 128 * 1024 * 1024
SONAR_URL = "https://sonarcloud.io"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_limited(response, limit):
    data = response.read(limit + 1)
    require(len(data) <= limit, "Response exceeds size limit")
    return data


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


class GitHub:
    def __init__(self, repository, token):
        require(re.fullmatch(r"[\w.-]+/[\w.-]+", repository), "Invalid repository")
        self.base = f"https://api.github.com/repos/{repository}/"
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def get(self, path):
        request = urllib.request.Request(self.base + path, headers=self.headers)
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(read_limited(response, MAX_ARCHIVE_SIZE))

    def download(self, artifact_id):
        request = urllib.request.Request(
            self.base + f"actions/artifacts/{artifact_id}/zip", headers=self.headers
        )
        # A fresh request prevents forwarding the token to artifact storage.
        try:
            urllib.request.build_opener(NoRedirect).open(request, timeout=60)
        except urllib.error.HTTPError as error:
            require(error.code == 302, "Expected artifact download redirect")
            location = error.headers["Location"]
        else:
            raise ValueError("Missing artifact download redirect")
        require(urllib.parse.urlsplit(location).scheme == "https", "Invalid download URL")
        with urllib.request.urlopen(location, timeout=60) as response:
            return read_limited(response, MAX_ARCHIVE_SIZE)


def validate_run(event, run, workflow):
    expected = event["workflow_run"]
    repository_id = event["repository"]["id"]
    require(run["id"] == expected["id"], "Run ID mismatch")
    require(run["run_attempt"] == expected["run_attempt"], "Run attempt has changed")
    require(run["repository"]["id"] == repository_id, "Wrong run repository")
    require(run["event"] == "pull_request", "Expected a pull_request run")
    require(run["status"] == "completed" and run["conclusion"] == "success", "Coverage failed")
    require(run["path"] == WORKFLOW_PATH, "Wrong producer workflow path")
    require(workflow["path"] == WORKFLOW_PATH, "Wrong registered workflow path")
    require(run["workflow_id"] == workflow["id"] == expected["workflow_id"], "Workflow ID mismatch")
    require(run["head_repository"]["id"] != repository_id, "Expected a fork")
    require(run["head_repository"]["id"] == expected["head_repository"]["id"], "Fork changed")
    require(run["head_sha"] == expected["head_sha"], "Run head changed")
    require(re.fullmatch(r"[0-9a-f]{40}", run["head_sha"]), "Invalid head SHA")


def select_artifact(artifacts, run, repository_id):
    name = f"fork-sonar-coverage-{run['id']}-{run['run_attempt']}"
    matches = [artifact for artifact in artifacts if artifact["name"] == name]
    require(len(matches) == 1, "Expected exactly one coverage artifact for this attempt")
    artifact = matches[0]
    origin = artifact["workflow_run"]
    require(not artifact["expired"], "Artifact expired")
    require(0 < artifact["size_in_bytes"] <= MAX_ARCHIVE_SIZE, "Invalid artifact size")
    require(origin["id"] == run["id"], "Artifact run mismatch")
    require(origin["repository_id"] == repository_id, "Artifact repository mismatch")
    require(origin["head_repository_id"] == run["head_repository"]["id"], "Artifact fork mismatch")
    require(origin["head_sha"] == run["head_sha"], "Artifact head mismatch")
    return artifact


def read_artifact(data):
    expected = COVERAGE_PATHS | {"metadata.json"}
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        require(len(archive.infolist()) == len(expected), "Unexpected artifact members")
        for member in archive.infolist():
            require(member.filename in expected, "Unexpected artifact path")
            require(member.filename not in files, "Duplicate artifact path")
            mode = member.external_attr >> 16
            require(stat.S_IFMT(mode) in (0, stat.S_IFREG), "Artifact member is not a regular file")
            require(0 < member.file_size <= MAX_FILE_SIZE, "Invalid artifact member size")
            require(sum(len(value) for value in files.values()) + member.file_size <= MAX_ARCHIVE_SIZE,
                    "Expanded artifact exceeds size limit")
            files[member.filename] = archive.read(member)
    require(set(files) == expected, "Missing coverage report")
    return json.loads(files.pop("metadata.json")), files


def validate_pr(metadata, pr, run, repository_id):
    require(type(metadata["pr"]) is int and metadata["pr"] > 0, "Invalid PR number")
    require(metadata["pr"] == pr["number"] and pr["state"] == "open", "PR is not open")
    require(metadata["run_id"] == run["id"], "Metadata run mismatch")
    require(metadata["run_attempt"] == run["run_attempt"], "Metadata attempt mismatch")
    require(metadata["head_sha"] == run["head_sha"] == pr["head"]["sha"], "Stale PR head")
    require(pr["head"]["repo"]["id"] == run["head_repository"]["id"], "PR fork mismatch")
    require(pr["head"]["ref"] == run["head_branch"], "PR branch mismatch")
    require(pr["base"]["repo"]["id"] == repository_id, "PR base repository mismatch")
    require(pr["base"]["ref"] == "main", "Unexpected PR base branch")


def source_path(path):
    parts = PurePosixPath(path).parts
    require(path == PurePosixPath(path).as_posix() and not path.startswith("/"), "Invalid source path")
    require(all(part.casefold() not in ("..", ".git") for part in parts), "Unsafe source path")
    require("\\" not in path and path.isprintable(), "Unsafe source filename")
    return any(path.startswith(root + "/") for root in SOURCE_ROOTS)


def git(directory, *args):
    return subprocess.check_output(["git", "-C", str(directory), *args])


def materialize_source(directory, sha):
    """Write regular blobs directly, bypassing checkout filters and attributes."""
    entries = git(directory, "ls-tree", "-rz", sha, "--", *SOURCE_ROOTS).split(b"\0")
    size = 0
    with subprocess.Popen(
        ["git", "-C", str(directory), "cat-file", "--batch"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    ) as process:
        for entry in entries:
            if not entry:
                continue
            attributes, raw_path = entry.split(b"\t", 1)
            mode, kind, oid = attributes.split()
            path = raw_path.decode("utf-8")
            require(source_path(path), "Unexpected source root")
            require(mode in (b"100644", b"100755") and kind == b"blob", "Source links are forbidden")
            parts = PurePosixPath(path).parts
            if any(part in ("node_modules", "coverage", "dist", ".next", ".scannerwork") for part in parts):
                continue
            if parts[-1].startswith(("tsconfig", "sonar-project")):
                continue
            # These binary assets are excluded by the trusted Sonar settings.
            if PurePosixPath(path).suffix.lower() in (".png", ".ico"):
                continue
            process.stdin.write(oid + b"\n")
            process.stdin.flush()
            header = process.stdout.readline().split()
            require(len(header) == 3 and header[1] == b"blob", "Invalid Git blob")
            length = int(header[2])
            size += length
            require(length <= MAX_FILE_SIZE and size <= MAX_SOURCE_SIZE, "Source exceeds size limit")
            content = process.stdout.read(length)
            require(len(content) == length and process.stdout.read(1) == b"\n", "Truncated Git blob")
            target = directory / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        process.stdin.close()
        require(process.wait() == 0, "Git object read failed")
    for root in SOURCE_ROOTS:
        (directory / root).mkdir(parents=True, exist_ok=True)


def normalize_lcov(data, package, sources):
    result = []
    for line in data.decode("utf-8").splitlines():
        require("\x00" not in line, "Invalid LCOV data")
        if line.startswith("SF:"):
            path = line[3:]
            require(not path.startswith("/") and "\\" not in path, "LCOV must use relative paths")
            require(".." not in PurePosixPath(path).parts, "Unsafe LCOV source path")
            candidates = (path, f"{package}/{path}")
            matches = [candidate for candidate in candidates if source_path(candidate) and (sources / candidate).is_file()]
            require(len(matches) == 1, "LCOV source is missing or ambiguous")
            line = "SF:" + matches[0]
        result.append(line)
    require(any(line.startswith("SF:") for line in result), "LCOV report has no sources")
    return "\n".join(result) + "\n"


def property_value(value):
    """Escape Java properties, including newlines and non-ASCII branch names."""
    require("${" not in str(value), "Scanner property interpolation is forbidden")
    result = []
    for character in str(value):
        if character.isascii() and (character.isalnum() or character in "./_-"):
            result.append(character)
        else:
            encoded = character.encode("utf-16-be")
            for index in range(0, len(encoded), 2):
                result.append(f"\\u{int.from_bytes(encoded[index:index + 2], 'big'):04x}")
    return "".join(result)


def write_settings(workspace, pr):
    reports = ",".join(f"../coverage/{package}.info" for package in PACKAGES)
    properties = (workspace / "trusted/sonar-project.properties").read_text(encoding="utf-8")
    overrides = {
        "sonar.host.url": SONAR_URL,
        "sonar.organization": "oboapp",
        "sonar.projectKey": "oboapp_oboapp",
        "sonar.pullrequest.key": pr["number"],
        "sonar.pullrequest.branch": pr["head"]["ref"],
        "sonar.pullrequest.base": "main",
        "sonar.scm.revision": pr["head"]["sha"],
        "sonar.scm.exclusions.disabled": "true",
        "sonar.sca.enabled": "false",
        "sonar.qualitygate.wait": "true",
        "sonar.qualitygate.timeout": "300",
        "sonar.javascript.lcov.reportPaths": reports,
        "sonar.typescript.lcov.reportPaths": reports,
        "sonar.typescript.tsconfigPaths": "../tsconfig.analysis.json",
    }
    properties += "\n" + "\n".join(f"{key}={property_value(value)}" for key, value in overrides.items())
    (workspace / "analysis/sonar-project.properties").write_text(properties + "\n", encoding="utf-8")
    (workspace / "tsconfig.analysis.json").write_text(json.dumps({
        "compilerOptions": {
            "allowJs": True,
            "jsx": "preserve",
            "noEmit": True,
            "target": "ES2022",
            "module": "ESNext",
            "moduleResolution": "Bundler",
        },
        "include": [f"analysis/{root}/**/*" for root in SOURCE_ROOTS],
    }), encoding="utf-8")


def summary(message):
    with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as output:
        output.write(message + "\n")


def prepare():
    workspace = Path(os.environ["GITHUB_WORKSPACE"])
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    api = GitHub(os.environ["GITHUB_REPOSITORY"], os.environ["GH_TOKEN"])
    run = api.get(f"actions/runs/{int(event['workflow_run']['id'])}")
    workflow = api.get("actions/workflows/sonar-fork-pr.yml")
    validate_run(event, run, workflow)
    name = f"fork-sonar-coverage-{run['id']}-{run['run_attempt']}"
    artifacts = api.get(f"actions/runs/{run['id']}/artifacts?name={name}&per_page=100")
    artifact = select_artifact(artifacts["artifacts"], run, event["repository"]["id"])
    metadata, reports = read_artifact(api.download(artifact["id"]))
    require(type(metadata.get("pr")) is int and metadata["pr"] > 0, "Invalid artifact PR number")
    pr = api.get(f"pulls/{metadata['pr']}")
    validate_pr(metadata, pr, run, event["repository"]["id"])
    sources = workspace / "analysis"
    sources.mkdir()
    git(sources, "init")
    # Fetch through the base repository. No fork URL or ref reaches a shell.
    git(sources, "remote", "add", "origin", f"https://github.com/{os.environ['GITHUB_REPOSITORY']}.git")
    git(sources, "fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main",
        f"+refs/pull/{pr['number']}/head:refs/remotes/origin/fork-pr")
    fetched_sha = git(sources, "rev-parse", "refs/remotes/origin/fork-pr").decode().strip()
    require(fetched_sha == run["head_sha"], "Fetched head changed")
    git(sources, "reset", "--mixed", run["head_sha"])
    materialize_source(sources, run["head_sha"])
    coverage = workspace / "coverage"
    coverage.mkdir()
    for package in PACKAGES:
        report = normalize_lcov(reports[f"{package}/coverage/lcov.info"], package, sources)
        (coverage / f"{package}.info").write_text(report, encoding="utf-8")
    # Reject synchronize events and reruns that arrived while fetching sources.
    validate_pr(metadata, api.get(f"pulls/{pr['number']}"), run, event["repository"]["id"])
    validate_run(event, api.get(f"actions/runs/{run['id']}"), workflow)
    write_settings(workspace, pr)
    (workspace / "analysis-identity.json").write_text(json.dumps({
        "pr": pr["number"], "head_sha": run["head_sha"], "run_id": run["id"],
        "run_attempt": run["run_attempt"], "artifact_id": artifact["id"],
    }), encoding="utf-8")
    summary(f"PR #{pr['number']}\n\nHead SHA: `{run['head_sha']}`\n\nCoverage run: {run['id']} (attempt {run['run_attempt']})")


def sonar_get(path):
    request = urllib.request.Request(SONAR_URL + path, headers={
        "Authorization": f"Bearer {os.environ['SONAR_TOKEN']}",
    })
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(read_limited(response, MAX_ARCHIVE_SIZE))


def gate():
    workspace = Path(os.environ["GITHUB_WORKSPACE"])
    report = dict(line.split("=", 1) for line in (
        workspace / "analysis/.scannerwork/report-task.txt"
    ).read_text(encoding="utf-8").splitlines() if "=" in line)
    task_id = report["ceTaskId"]
    require(re.fullmatch(r"[A-Za-z0-9_-]+", task_id), "Invalid Sonar task ID")
    deadline = time.monotonic() + 300
    while True:
        task = sonar_get(f"/api/ce/task?id={task_id}")["task"]
        if task["status"] not in ("PENDING", "IN_PROGRESS"):
            break
        require(time.monotonic() < deadline, "Timed out waiting for Sonar analysis")
        time.sleep(5)
    require(task["status"] == "SUCCESS", "Sonar analysis did not complete")
    analysis_id = task["analysisId"]
    status = sonar_get("/api/qualitygates/project_status?analysisId=" + urllib.parse.quote(analysis_id))["projectStatus"]
    identity = json.loads((workspace / "analysis-identity.json").read_text(encoding="utf-8"))
    result = {**identity, "analysis_id": analysis_id, "quality_gate": status["status"], "conditions": status["conditions"]}
    (workspace / "quality-gate.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    summary(f"\nAnalysis ID: `{analysis_id}`\n\nQuality gate: **{status['status']}**")
    require(status["status"] == "OK", "Sonar quality gate did not pass")


if __name__ == "__main__":
    {"prepare": prepare, "gate": gate}[sys.argv[1]]()
