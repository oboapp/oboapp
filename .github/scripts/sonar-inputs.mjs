import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const workspacePackages = ["api", "db", "ingest", "shared", "web"];
const manifests = new Set([
  "package.json",
  ...workspacePackages.map((name) => `${name}/package.json`),
]);
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

function analysisManifest(content) {
  const manifest = JSON.parse(content);

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Workspace manifest must be a JSON object.");
  }

  for (const field of dependencyFields) {
    delete manifest[field];
  }

  if (manifest.pnpm) {
    delete manifest.pnpm.overrides;

    if (Object.keys(manifest.pnpm).length === 0) {
      delete manifest.pnpm;
    }
  }

  return manifest;
}

function manifestAffectsAnalysis(previous, current) {
  if (previous === null || current === null) {
    return true;
  }

  try {
    return !isDeepStrictEqual(
      analysisManifest(previous),
      analysisManifest(current),
    );
  } catch {
    return true;
  }
}

function analysisWorkflow(content) {
  if (content === null) {
    return null;
  }

  const normalized = content.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const jobs = lines.indexOf("jobs:");
  const sonar = lines.indexOf("  sonarcloud:");

  if (jobs === -1 || sonar <= jobs) {
    return null;
  }

  let end = sonar + 1;

  while (end < lines.length && !/^  [\w-]+:/.test(lines[end])) {
    end += 1;
  }

  // Workflow permissions, environment and triggers also apply to this job.
  return [...lines.slice(0, jobs), ...lines.slice(sonar, end)].join("\n");
}

function sourceRoots(content) {
  if (content === null) {
    throw new Error("Cannot read Sonar analysis configuration.");
  }

  const declarations = new Map();

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*sonar\.(sources|tests)\s*=\s*(.+)$/);

    if (match) {
      declarations.set(match[1], match[2]);
    }
  }

  if (!declarations.has("sources") || !declarations.has("tests")) {
    throw new Error("Cannot determine Sonar source and test roots.");
  }

  return [...declarations.values()].flatMap((value) => {
    return value.split(",").map((value) => {
      const root = value.trim();

      if (!root || /[\\:*?]/.test(root) || posix.isAbsolute(root)) {
        throw new Error("Unsupported Sonar source or test root.");
      }

      const normalized = posix.normalize(root).replace(/\/$/, "");

      if (normalized === ".." || normalized.startsWith("../")) {
        throw new Error("Sonar source and test roots must stay inside the repository.");
      }

      return normalized;
    });
  });
}

export function assessChanges({ paths, before, after, scaEnabled }) {
  const relevant = [];
  const dependencies = [];
  const configuration = "sonar-project.properties";

  if (paths.includes(configuration)) {
    return { scan: true, reason: "Sonar analysis configuration changed." };
  }

  const roots = sourceRoots(after(configuration));

  for (const path of paths) {
    if (manifests.has(path)) {
      dependencies.push(path);

      if (manifestAffectsAnalysis(before(path), after(path))) {
        relevant.push(path);
      }
    } else if (path === "pnpm-lock.yaml") {
      dependencies.push(path);
    } else if (path === ".github/workflows/ci.yml") {
      const previous = analysisWorkflow(before(path));
      const current = analysisWorkflow(after(path));

      if (previous === null || current === null || previous !== current) {
        relevant.push(path);
      }
    } else if (
      path.startsWith(".github/scripts/sonar-") ||
      path === "pnpm-workspace.yaml" ||
      path === ".npmrc" ||
      path === ".pnpmfile.cjs" ||
      path.startsWith("patches/") ||
      /^(api|db|shared)\/(tsconfig[^/]*\.json|vitest\.[^/]+)$/.test(path) ||
      (
        workspacePackages.some((name) => path.startsWith(`${name}/`)) &&
        (
          /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
          /\/(test|tests|__tests__|__mocks__|fixtures)\//.test(path)
        ) &&
        !/(^|\/)(node_modules|dist|coverage|\.next)\//.test(path)
      )
    ) {
      relevant.push(path);
    } else if (
      roots.some((root) => root === "." || path === root || path.startsWith(`${root}/`)) &&
      !/(^|\/)(node_modules|dist|coverage|\.next)\//.test(path)
    ) {
      // Include mocks and fixture assets because they can affect test coverage.
      relevant.push(path);
    }
  }

  if (relevant.length > 0) {
    return {
      scan: true,
      reason: `${relevant.length} changed path(s) affect source, tests, coverage or analysis settings.`,
    };
  }

  if (dependencies.length > 0 && scaEnabled !== "false") {
    return {
      scan: true,
      reason: "Dependency inputs changed; SCA is enabled or its state is unknown.",
    };
  }

  return {
    scan: false,
    reason: "No source, test, coverage or analysis settings changed. Dependency-only changes do not require Sonar while SCA is disabled.",
  };
}

export function evaluatePullRequest({ base, head, scaEnabled, cwd }) {
  for (const revision of [base, head]) {
    if (!/^[a-f\d]{40}$/i.test(revision ?? "")) {
      throw new Error("PR base and head must be full commit SHAs.");
    }
  }

  function git(args) {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  function readAt(revision, path) {
    const exists = git(["ls-tree", "--name-only", revision, "--", path]);

    if (!exists) {
      return null;
    }

    return git(["show", `${revision}:${path}`]);
  }

  const mergeBase = git(["merge-base", base, head]).trim();
  const paths = git([
    "diff", "--name-only", "--no-renames", "-z", `${mergeBase}..${head}`, "--",
  ]).split("\0").filter(Boolean);

  return assessChanges({
    paths,
    before(path) {
      return readAt(mergeBase, path);
    },
    after(path) {
      return readAt(head, path);
    },
    scaEnabled,
  });
}

function main() {
  const decision = process.env.GITHUB_EVENT_NAME === "pull_request"
    ? evaluatePullRequest({
        base: process.env.PR_BASE_SHA,
        head: process.env.PR_HEAD_SHA,
        scaEnabled: process.env.SONAR_SCA_ENABLED,
      })
    : { scan: true, reason: "Main branch analysis runs on every push." };

  console.log(`${decision.scan ? "Run" : "Skip"} Sonar: ${decision.reason}`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `scan=${decision.scan}\n`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Sonar analysis decision\n\n${decision.scan ? "Run" : "Skip"}: ${decision.reason}\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
