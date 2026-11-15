"""Security regressions for the trusted fork analysis boundary."""

import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest import mock
import urllib.error
import warnings
import zipfile


SPEC = importlib.util.spec_from_file_location(
    "fork_sonar", Path(__file__).with_name("fork_sonar.py")
)
sonar = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sonar)

HEAD_SHA = "a" * 40
OTHER_SHA = "b" * 40
REPOSITORY_ID = 101
FORK_ID = 202


def fixtures():
    run = {
        "id": 303,
        "run_attempt": 2,
        "repository": {"id": REPOSITORY_ID},
        "event": "pull_request",
        "status": "completed",
        "conclusion": "success",
        "path": sonar.WORKFLOW_PATH,
        "workflow_id": 404,
        "head_repository": {"id": FORK_ID},
        "head_sha": HEAD_SHA,
        "head_branch": "feature/fork-analysis",
        "pull_requests": [],
    }
    event = {
        "repository": {"id": REPOSITORY_ID},
        "workflow_run": copy.deepcopy(run),
    }
    workflow = {"id": 404, "path": sonar.WORKFLOW_PATH}
    metadata = {
        "pr": 690,
        "run_id": run["id"],
        "run_attempt": run["run_attempt"],
        "head_sha": HEAD_SHA,
    }
    pr = {
        "number": 690,
        "state": "open",
        "head": {
            "sha": HEAD_SHA,
            "ref": run["head_branch"],
            "repo": {"id": FORK_ID},
        },
        "base": {"ref": "main", "repo": {"id": REPOSITORY_ID}},
    }
    artifact = {
        "id": 505,
        "name": "fork-sonar-coverage-303-2",
        "expired": False,
        "size_in_bytes": 1024,
        "workflow_run": {
            "id": run["id"],
            "repository_id": REPOSITORY_ID,
            "head_repository_id": FORK_ID,
            "head_sha": HEAD_SHA,
        },
    }
    return event, run, workflow, metadata, pr, artifact


def replace_value(value, keys, replacement):
    for key in keys[:-1]:
        value = value[key]
    value[keys[-1]] = replacement


def artifact_entries():
    metadata = fixtures()[3]
    entries = [("metadata.json", json.dumps(metadata).encode())]
    for package in sonar.PACKAGES:
        relative = "src/index.ts" if package in ("api", "db", "shared") else "index.ts"
        entries.append((
            f"{package}/coverage/lcov.info",
            f"SF:{relative}\nDA:1,1\nend_of_record\n".encode(),
        ))
    return entries


def make_archive(entries=None):
    output = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(output, "w") as archive:
            for name, content in entries if entries is not None else artifact_entries():
                archive.writestr(name, content)
    return output.getvalue()


class NetworkBoundaryTests(unittest.TestCase):
    def test_artifact_download_sends_token_only_to_github_api(self):
        api_url = "https://api.github.com/repos/oboapp/oboapp/actions/artifacts/505/zip"
        storage_url = "https://storage.example.invalid/artifact.zip?signature=test"
        opener = mock.Mock()
        opener.open.side_effect = urllib.error.HTTPError(
            api_url, 302, "Found", {"Location": storage_url}, None,
        )
        client = sonar.GitHub("oboapp/oboapp", "api-only-token")
        with mock.patch.object(sonar.urllib.request, "build_opener", return_value=opener) as build:
            with mock.patch.object(sonar.urllib.request, "urlopen", return_value=io.BytesIO(b"archive")) as storage:
                self.assertEqual(client.download(505), b"archive")
        build.assert_called_once_with(sonar.NoRedirect)
        api_request = opener.open.call_args.args[0]
        self.assertEqual(api_request.full_url, api_url)
        self.assertEqual(api_request.get_header("Authorization"), "Bearer api-only-token")
        storage.assert_called_once_with(storage_url, timeout=60)

    def test_non_https_artifact_redirects_are_rejected(self):
        for location in (
            "http://storage.example.invalid/artifact.zip",
            "file:///tmp/artifact.zip",
            "//storage.example.invalid/artifact.zip",
        ):
            with self.subTest(location=location):
                opener = mock.Mock()
                opener.open.side_effect = urllib.error.HTTPError(
                    "https://api.github.com/", 302, "Found", {"Location": location}, None,
                )
                with mock.patch.object(sonar.urllib.request, "build_opener", return_value=opener):
                    with mock.patch.object(sonar.urllib.request, "urlopen") as storage:
                        with self.assertRaisesRegex(ValueError, "Invalid download URL"):
                            sonar.GitHub("oboapp/oboapp", "test-token").download(505)
                storage.assert_not_called()

    def test_unexpected_api_failures_are_not_treated_as_artifact_redirects(self):
        for status in (401, 403, 404, 500):
            with self.subTest(status=status):
                opener = mock.Mock()
                opener.open.side_effect = urllib.error.HTTPError(
                    "https://api.github.com/", status, "Failure", {}, None,
                )
                with mock.patch.object(sonar.urllib.request, "build_opener", return_value=opener):
                    with mock.patch.object(sonar.urllib.request, "urlopen") as storage:
                        with self.assertRaisesRegex(ValueError, "Expected artifact download redirect"):
                            sonar.GitHub("oboapp/oboapp", "test-token").download(505)
                storage.assert_not_called()

    def test_network_reads_accept_limit_and_reject_overflow(self):
        self.assertEqual(sonar.read_limited(io.BytesIO(b"1234"), 4), b"1234")
        response = mock.Mock()
        response.read.return_value = b"12345"
        with self.assertRaisesRegex(ValueError, "size limit"):
            sonar.read_limited(response, 4)
        response.read.assert_called_once_with(5)


class RunValidationTests(unittest.TestCase):
    def test_successful_fork_run_accepts_empty_pull_request_association(self):
        event, run, workflow, _, _, _ = fixtures()
        sonar.validate_run(event, run, workflow)

    def test_origin_revision_attempt_and_success_are_required(self):
        mutations = (
            ("run", ("id",), 999),
            ("run", ("run_attempt",), 3),
            ("run", ("repository", "id"), 999),
            ("run", ("event",), "push"),
            ("run", ("status",), "in_progress"),
            ("run", ("conclusion",), "failure"),
            ("run", ("path",), ".github/workflows/unrelated.yml"),
            ("workflow", ("path",), ".github/workflows/unrelated.yml"),
            ("workflow", ("id",), 999),
            ("event", ("workflow_run", "workflow_id"), 999),
            ("run", ("head_repository", "id"), REPOSITORY_ID),
            ("event", ("workflow_run", "head_repository", "id"), 999),
            ("run", ("head_sha",), OTHER_SHA),
        )
        for target, keys, replacement in mutations:
            with self.subTest(target=target, keys=keys):
                event, run, workflow, _, _, _ = fixtures()
                objects = {"event": event, "run": run, "workflow": workflow}
                replace_value(objects[target], keys, replacement)
                with self.assertRaises(ValueError):
                    sonar.validate_run(event, run, workflow)

    def test_matching_malformed_sha_is_rejected(self):
        event, run, workflow, _, _, _ = fixtures()
        run["head_sha"] = "refs/heads/main"
        event["workflow_run"]["head_sha"] = run["head_sha"]
        with self.assertRaises(ValueError):
            sonar.validate_run(event, run, workflow)


class ArtifactValidationTests(unittest.TestCase):
    def test_selects_only_the_verified_run_attempt(self):
        _, run, _, _, _, artifact = fixtures()
        previous = copy.deepcopy(artifact)
        previous["name"] = "fork-sonar-coverage-303-1"
        selected = sonar.select_artifact([previous, artifact], run, REPOSITORY_ID)
        self.assertEqual(selected["id"], artifact["id"])

    def test_artifact_origin_and_size_are_required(self):
        mutations = (
            (("expired",), True),
            (("size_in_bytes",), 0),
            (("size_in_bytes",), sonar.MAX_ARCHIVE_SIZE + 1),
            (("workflow_run", "id"), 999),
            (("workflow_run", "repository_id"), 999),
            (("workflow_run", "head_repository_id"), 999),
            (("workflow_run", "head_sha"), OTHER_SHA),
            (("name",), "fork-sonar-coverage-303-1"),
        )
        for keys, replacement in mutations:
            with self.subTest(keys=keys):
                _, run, _, _, _, artifact = fixtures()
                replace_value(artifact, keys, replacement)
                with self.assertRaises(ValueError):
                    sonar.select_artifact([artifact], run, REPOSITORY_ID)

    def test_ambiguous_and_missing_artifacts_are_rejected(self):
        _, run, _, _, _, artifact = fixtures()
        for artifacts in ([], [artifact, copy.deepcopy(artifact)]):
            with self.subTest(count=len(artifacts)):
                with self.assertRaises(ValueError):
                    sonar.select_artifact(artifacts, run, REPOSITORY_ID)

    def test_reads_exact_expected_files(self):
        metadata, reports = sonar.read_artifact(make_archive())
        self.assertEqual(metadata, fixtures()[3])
        self.assertEqual(set(reports), sonar.COVERAGE_PATHS)

    def test_zip_paths_cannot_overwrite_trusted_files(self):
        unsafe_paths = (
            "../trusted/sonar-project.properties",
            "/tmp/sonar-project.properties",
            "web/coverage/../../sonar-project.properties",
            "web\\coverage\\lcov.info",
            "web/coverage/lcov.info/",
        )
        for path in unsafe_paths:
            with self.subTest(path=path):
                entries = artifact_entries()
                entries[1] = (path, entries[1][1])
                with self.assertRaises(ValueError):
                    sonar.read_artifact(make_archive(entries))

    def test_links_and_special_files_are_rejected(self):
        for mode in (stat.S_IFLNK, stat.S_IFIFO, stat.S_IFDIR):
            with self.subTest(mode=mode):
                entries = artifact_entries()
                member = zipfile.ZipInfo(entries[1][0])
                member.create_system = 3
                member.external_attr = (mode | 0o777) << 16
                entries[1] = (member, b"../../trusted/sonar-project.properties")
                with self.assertRaises(ValueError):
                    sonar.read_artifact(make_archive(entries))

    def test_duplicate_missing_and_extra_members_are_rejected(self):
        entries = artifact_entries()
        duplicate = list(entries)
        duplicate[-1] = entries[1]
        for members in (duplicate, entries[:-1], entries + [("unexpected.txt", b"x")]):
            with self.subTest(count=len(members)):
                with self.assertRaises(ValueError):
                    sonar.read_artifact(make_archive(members))

    def test_empty_and_oversized_members_are_rejected(self):
        for content in (b"", b"x" * 1025):
            with self.subTest(length=len(content)):
                entries = artifact_entries()
                entries[1] = (entries[1][0], content)
                with mock.patch.object(sonar, "MAX_FILE_SIZE", 1024):
                    with self.assertRaises(ValueError):
                        sonar.read_artifact(make_archive(entries))

    def test_total_expanded_size_is_bounded(self):
        entries = artifact_entries()
        limit = sum(len(content) for _, content in entries) - 1
        with mock.patch.object(sonar, "MAX_ARCHIVE_SIZE", limit):
            with self.assertRaises(ValueError):
                sonar.read_artifact(make_archive(entries))


class PullRequestValidationTests(unittest.TestCase):
    def test_current_open_pr_matches_verified_run(self):
        _, run, _, metadata, pr, _ = fixtures()
        sonar.validate_pr(metadata, pr, run, REPOSITORY_ID)

    def test_stale_closed_or_unrelated_prs_are_rejected(self):
        mutations = (
            ("metadata", ("pr",), True),
            ("metadata", ("pr",), 0),
            ("metadata", ("pr",), 691),
            ("metadata", ("run_id",), 999),
            ("metadata", ("run_attempt",), 1),
            ("metadata", ("head_sha",), OTHER_SHA),
            ("pr", ("state",), "closed"),
            ("pr", ("head", "sha"), OTHER_SHA),
            ("pr", ("head", "repo", "id"), 999),
            ("pr", ("head", "ref"), "unrelated-branch"),
            ("pr", ("base", "repo", "id"), 999),
            ("pr", ("base", "ref"), "release"),
        )
        for target, keys, replacement in mutations:
            with self.subTest(target=target, keys=keys):
                _, run, _, metadata, pr, _ = fixtures()
                objects = {"metadata": metadata, "pr": pr}
                replace_value(objects[target], keys, replacement)
                with self.assertRaises(ValueError):
                    sonar.validate_pr(metadata, pr, run, REPOSITORY_ID)


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name)

    def write_source(self, path, content=b"export const value = 1;\n"):
        target = self.workspace / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return target


class CoverageTests(WorkspaceTests):
    def test_package_relative_and_repository_relative_reports_normalize(self):
        for package in sonar.PACKAGES:
            relative = "src/index.ts" if package in ("api", "db", "shared") else "index.ts"
            path = f"{package}/{relative}"
            self.write_source(path)
            for source in (relative, path):
                with self.subTest(package=package, source=source):
                    report = f"SF:{source}\r\nDA:1,1\r\nend_of_record\r\n".encode()
                    self.assertEqual(
                        sonar.normalize_lcov(report, package, self.workspace),
                        f"SF:{path}\nDA:1,1\nend_of_record\n",
                    )

    def test_absolute_traversal_missing_and_malformed_sources_are_rejected(self):
        self.write_source("web/index.ts")
        paths = (
            "/web/index.ts", "../web/index.ts", "web/../web/index.ts",
            "web\\index.ts", "./web/index.ts", "web/missing.ts", "web/index.ts\x00",
        )
        for path in paths:
            with self.subTest(path=path):
                with self.assertRaises(ValueError):
                    sonar.normalize_lcov(f"SF:{path}\nDA:1,1\n".encode(), "web", self.workspace)

    def test_ambiguous_source_and_report_without_sources_are_rejected(self):
        self.write_source("web/index.ts")
        self.write_source("web/web/index.ts")
        for report in (b"SF:web/index.ts\nDA:1,1\n", b"TN:test\nend_of_record\n"):
            with self.subTest(report=report):
                with self.assertRaises(ValueError):
                    sonar.normalize_lcov(report, "web", self.workspace)


class ScannerSettingsTests(WorkspaceTests):
    def test_property_escaping_prevents_newline_and_unicode_injection(self):
        self.assertEqual(
            sonar.property_value("branch/\n=\U0001f600"),
            r"branch/\u000a\u003d\ud83d\ude00",
        )

    def test_sonar_property_interpolation_is_rejected(self):
        for value in ("feature/${env.SONAR_TOKEN}", "feature/${sonar.token}"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    sonar.property_value(value)

    def test_branch_data_cannot_override_trusted_scanner_settings(self):
        _, _, _, _, pr, _ = fixtures()
        pr["head"]["ref"] = "feature/\nsonar.host.url=https://attacker.invalid\nsonar.sca.enabled=true"
        self.write_source("trusted/sonar-project.properties", b"sonar.sources=api/src,web\n")
        self.write_source("analysis/sonar-project.properties", b"sonar.host.url=https://fork.invalid\n")
        sonar.write_settings(self.workspace, pr)
        properties = (self.workspace / "analysis/sonar-project.properties").read_text(encoding="utf-8")
        values = dict(line.split("=", 1) for line in properties.splitlines() if "=" in line)
        self.assertEqual(values["sonar.sources"], "api/src,web")
        self.assertEqual(values["sonar.host.url"], r"https\u003a//sonarcloud.io")
        self.assertEqual(values["sonar.sca.enabled"], "false")
        self.assertEqual(values["sonar.scm.revision"], HEAD_SHA)
        self.assertEqual(values["sonar.scm.exclusions.disabled"], "true")
        self.assertEqual(values["sonar.pullrequest.key"], "690")
        self.assertEqual(values["sonar.qualitygate.wait"], "true")
        self.assertEqual(values["sonar.typescript.tsconfigPaths"], "../tsconfig.analysis.json")
        self.assertEqual(values["sonar.pullrequest.branch"], sonar.property_value(pr["head"]["ref"]))
        self.assertNotIn("fork.invalid", properties)
        self.assertNotIn("attacker.invalid\n", properties)
        config = json.loads((self.workspace / "tsconfig.analysis.json").read_text(encoding="utf-8"))
        self.assertNotIn("extends", config)
        self.assertNotIn("plugins", config["compilerOptions"])
        self.assertTrue(config["compilerOptions"]["noEmit"])


class GitMaterializationTests(WorkspaceTests):
    def setUp(self):
        super().setUp()
        self.run_git("init", "--quiet")

    def run_git(self, *args, content=None):
        result = subprocess.run(
            ["git", "-C", str(self.workspace), *args],
            input=content, capture_output=True, check=True,
        )
        return result.stdout.decode().strip()

    def add_blob(self, path, content, mode="100644"):
        oid = self.run_git("hash-object", "-w", "--stdin", content=content)
        self.run_git("update-index", "--add", "--cacheinfo", f"{mode},{oid},{path}")

    def materialize_with_captured_stderr(self, tree):
        original_popen = subprocess.Popen

        def capture_stderr(*args, **kwargs):
            return original_popen(*args, stderr=subprocess.PIPE, **kwargs)

        # Rejected blobs can close the pipe before Git finishes writing.
        with mock.patch.object(sonar.subprocess, "Popen", side_effect=capture_stderr):
            sonar.materialize_source(self.workspace, tree)

    def test_raw_blobs_preserve_export_ignored_source_and_bypass_filters(self):
        self.run_git("config", "filter.trap.smudge", "exit 71")
        self.run_git("config", "filter.trap.clean", "exit 72")
        self.run_git("config", "filter.trap.required", "true")
        self.add_blob(".gitattributes", b"ingest/kept.ts export-ignore filter=trap\n")
        self.add_blob("ingest/kept.ts", b"export const preserved = true;\n")
        self.add_blob("web/executable.ts", b"throw new Error('must only be read');\n", "100755")
        tree = self.run_git("write-tree")
        sonar.materialize_source(self.workspace, tree)
        self.assertEqual(
            (self.workspace / "ingest/kept.ts").read_bytes(),
            b"export const preserved = true;\n",
        )
        self.assertTrue((self.workspace / "web/executable.ts").is_file())
        self.assertFalse((self.workspace / ".gitattributes").exists())

    def test_fork_scanner_configs_and_generated_dependencies_are_omitted(self):
        self.add_blob("ingest/index.ts", b"export {};\n")
        omitted = (
            "ingest/tsconfig.malicious.json", "web/sonar-project.properties",
            "web/node_modules/malicious/index.js", "web/coverage/lcov.info",
            "web/dist/generated.js", "web/.next/cache.js", "web/.scannerwork/report-task.txt",
        )
        for path in omitted:
            self.add_blob(path, b"untrusted settings or generated output\n")
        sonar.materialize_source(self.workspace, self.run_git("write-tree"))
        self.assertTrue((self.workspace / "ingest/index.ts").exists())
        for path in omitted:
            with self.subTest(path=path):
                self.assertFalse((self.workspace / path).exists())

    def test_indexed_symlink_is_rejected_without_creating_a_real_link(self):
        self.add_blob("ingest/unsafe.ts", b"../../trusted/sonar-project.properties", "120000")
        with self.assertRaisesRegex(ValueError, "links"):
            sonar.materialize_source(self.workspace, self.run_git("write-tree"))
        self.assertFalse((self.workspace / "ingest/unsafe.ts").exists())

    def test_git_submodule_is_rejected(self):
        tree = self.run_git("write-tree")
        commit = self.run_git(
            "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
            "commit-tree", tree, "-m", "fixture",
        )
        self.run_git("update-index", "--add", "--cacheinfo", f"160000,{commit},ingest/submodule")
        with self.assertRaisesRegex(ValueError, "links"):
            sonar.materialize_source(self.workspace, self.run_git("write-tree"))
        self.assertFalse((self.workspace / "ingest/submodule").exists())

    def test_source_blob_size_is_bounded_before_writing(self):
        self.add_blob("ingest/large.ts", b"0123456789")
        tree = self.run_git("write-tree")
        with mock.patch.object(sonar, "MAX_FILE_SIZE", 5):
            with self.assertRaisesRegex(ValueError, "size limit"):
                self.materialize_with_captured_stderr(tree)
        self.assertFalse((self.workspace / "ingest/large.ts").exists())

    def test_large_excluded_binaries_do_not_consume_source_limits(self):
        self.add_blob("ingest/crawlers/example/_entry.png", b"x" * 128)
        self.add_blob("web/favicon.ico", b"x" * 128)
        self.add_blob("ingest/index.ts", b"export {};\n")
        tree = self.run_git("write-tree")
        with mock.patch.object(sonar, "MAX_FILE_SIZE", 32):
            with mock.patch.object(sonar, "MAX_SOURCE_SIZE", 32):
                sonar.materialize_source(self.workspace, tree)
        self.assertEqual((self.workspace / "ingest/index.ts").read_bytes(), b"export {};\n")
        self.assertFalse((self.workspace / "ingest/crawlers/example/_entry.png").exists())
        self.assertFalse((self.workspace / "web/favicon.ico").exists())

    def test_total_source_size_is_bounded(self):
        self.add_blob("ingest/first.ts", b"1234")
        self.add_blob("ingest/second.ts", b"5678")
        tree = self.run_git("write-tree")
        with mock.patch.object(sonar, "MAX_SOURCE_SIZE", 7):
            with self.assertRaisesRegex(ValueError, "size limit"):
                self.materialize_with_captured_stderr(tree)
        self.assertFalse((self.workspace / "ingest/second.ts").exists())


class PrepareTests(WorkspaceTests):
    def run_prepare(self, stale_pr=False):
        event, run, workflow, _, pr, artifact = fixtures()
        self.write_source("event.json", json.dumps(event).encode())
        self.write_source("trusted/sonar-project.properties", b"sonar.sources=api/src,db/src,ingest,shared/src,web\n")
        pull_reads = 0

        def api_get(path):
            nonlocal pull_reads
            if path == "actions/runs/303":
                return copy.deepcopy(run)
            if path == "actions/workflows/sonar-fork-pr.yml":
                return copy.deepcopy(workflow)
            if path == "actions/runs/303/artifacts?name=fork-sonar-coverage-303-2&per_page=100":
                return {"artifacts": [copy.deepcopy(artifact)]}
            if path == "pulls/690":
                pull_reads += 1
                result = copy.deepcopy(pr)
                if stale_pr and pull_reads == 2:
                    result["head"]["sha"] = OTHER_SHA
                return result
            raise AssertionError(f"Unexpected GitHub request: {path}")

        def git_output(directory, *args):
            if args[:1] == ("rev-parse",):
                self.assertEqual(args[1], "refs/remotes/origin/fork-pr")
                return (HEAD_SHA + "\n").encode()
            return b""

        def materialize(directory, sha):
            self.assertEqual(sha, HEAD_SHA)
            for package in sonar.PACKAGES:
                relative = "src/index.ts" if package in ("api", "db", "shared") else "index.ts"
                target = directory / package / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("export {};\n", encoding="utf-8")

        api = mock.Mock()
        api.get.side_effect = api_get
        api.download.return_value = make_archive()
        environment = {
            "GITHUB_WORKSPACE": str(self.workspace),
            "GITHUB_EVENT_PATH": str(self.workspace / "event.json"),
            "GITHUB_REPOSITORY": "oboapp/oboapp",
            "GH_TOKEN": "test-token",
            "GITHUB_STEP_SUMMARY": str(self.workspace / "summary.md"),
        }
        with mock.patch.dict(os.environ, environment):
            with mock.patch.object(sonar, "GitHub", return_value=api):
                with mock.patch.object(sonar, "git", side_effect=git_output):
                    with mock.patch.object(sonar, "materialize_source", side_effect=materialize):
                        sonar.prepare()
        return api

    def test_verified_run_with_empty_pr_association_prepares_analysis(self):
        api = self.run_prepare()
        identity = json.loads((self.workspace / "analysis-identity.json").read_text(encoding="utf-8"))
        self.assertEqual(identity["head_sha"], HEAD_SHA)
        self.assertEqual(identity["artifact_id"], 505)
        self.assertEqual(identity["pr"], 690)
        self.assertIn(HEAD_SHA, (self.workspace / "summary.md").read_text(encoding="utf-8"))
        self.assertTrue((self.workspace / "analysis/sonar-project.properties").exists())
        self.assertEqual(
            (self.workspace / "coverage/api.info").read_text(encoding="utf-8"),
            "SF:api/src/index.ts\nDA:1,1\nend_of_record\n",
        )
        api.download.assert_called_once_with(505)

    def test_synchronize_race_stops_before_scan_settings_are_written(self):
        with self.assertRaisesRegex(ValueError, "Stale PR head"):
            self.run_prepare(stale_pr=True)
        self.assertFalse((self.workspace / "analysis-identity.json").exists())
        self.assertFalse((self.workspace / "analysis/sonar-project.properties").exists())


class QualityGateTests(WorkspaceTests):
    def setUp(self):
        super().setUp()
        self.write_source(
            "analysis/.scannerwork/report-task.txt",
            b"ceTaskId=task-123\nceTaskUrl=https://attacker.invalid/ignored\n",
        )
        self.identity = {"pr": 690, "head_sha": HEAD_SHA, "run_id": 303}
        self.write_source("analysis-identity.json", json.dumps(self.identity).encode())
        self.environment = {
            "GITHUB_WORKSPACE": str(self.workspace),
            "GITHUB_STEP_SUMMARY": str(self.workspace / "summary.md"),
        }

    def test_gate_is_checked_for_the_completed_analysis_id(self):
        responses = (
            {"task": {"status": "PENDING"}},
            {"task": {"status": "SUCCESS", "analysisId": "analysis-690"}},
            {"projectStatus": {"status": "OK", "conditions": []}},
        )
        with mock.patch.dict(os.environ, self.environment):
            with mock.patch.object(sonar, "sonar_get", side_effect=responses) as get:
                with mock.patch.object(sonar.time, "sleep") as sleep:
                    sonar.gate()
        self.assertEqual(get.call_args_list, [
            mock.call("/api/ce/task?id=task-123"),
            mock.call("/api/ce/task?id=task-123"),
            mock.call("/api/qualitygates/project_status?analysisId=analysis-690"),
        ])
        sleep.assert_called_once_with(5)
        result = json.loads((self.workspace / "quality-gate.json").read_text(encoding="utf-8"))
        self.assertEqual(result["analysis_id"], "analysis-690")
        self.assertEqual(result["head_sha"], HEAD_SHA)
        self.assertEqual(result["quality_gate"], "OK")

    def test_failed_or_uncomputed_gate_is_recorded_and_rejected(self):
        for status in ("ERROR", "NOT_COMPUTED", "WARN"):
            with self.subTest(status=status):
                responses = (
                    {"task": {"status": "SUCCESS", "analysisId": "analysis-690"}},
                    {"projectStatus": {"status": status, "conditions": [{"status": status}]}},
                )
                with mock.patch.dict(os.environ, self.environment):
                    with mock.patch.object(sonar, "sonar_get", side_effect=responses):
                        with self.assertRaisesRegex(ValueError, "quality gate"):
                            sonar.gate()
                result = json.loads((self.workspace / "quality-gate.json").read_text(encoding="utf-8"))
                self.assertEqual(result["analysis_id"], "analysis-690")
                self.assertEqual(result["quality_gate"], status)

    def test_failed_analysis_task_cannot_pass_gate(self):
        for status in ("FAILED", "CANCELED"):
            with self.subTest(status=status):
                with mock.patch.dict(os.environ, self.environment):
                    with mock.patch.object(sonar, "sonar_get", return_value={"task": {"status": status}}) as get:
                        with self.assertRaisesRegex(ValueError, "did not complete"):
                            sonar.gate()
                get.assert_called_once_with("/api/ce/task?id=task-123")
                self.assertFalse((self.workspace / "quality-gate.json").exists())

    def test_task_id_cannot_inject_api_parameters(self):
        self.write_source("analysis/.scannerwork/report-task.txt", b"ceTaskId=task&analysisId=other\n")
        with mock.patch.dict(os.environ, self.environment):
            with mock.patch.object(sonar, "sonar_get") as get:
                with self.assertRaisesRegex(ValueError, "task ID"):
                    sonar.gate()
        get.assert_not_called()

    def test_pending_analysis_times_out(self):
        with mock.patch.dict(os.environ, self.environment):
            with mock.patch.object(sonar, "sonar_get", return_value={"task": {"status": "IN_PROGRESS"}}):
                with mock.patch.object(sonar.time, "monotonic", side_effect=(0, 301)):
                    with self.assertRaisesRegex(ValueError, "Timed out"):
                        sonar.gate()


if __name__ == "__main__":
    unittest.main()
