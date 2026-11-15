import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { assessChanges, evaluatePullRequest } from "./sonar-inputs.mjs";

const properties = [
  "sonar.sources=api/src,db/src,ingest,shared/src,web",
  "sonar.tests=api/src,db/src,ingest,shared/src,web",
].join("\n");

const manifest = {
  name: "fixture",
  scripts: { "test:coverage": "vitest run --coverage" },
  dependencies: { example: "1.0.0" },
  devDependencies: { vitest: "4.0.0" },
  optionalDependencies: { optional: "1.0.0" },
  peerDependencies: { peer: "1.0.0" },
  pnpm: { overrides: { example: "1.0.0" }, onlyBuiltDependencies: ["esbuild"] },
};

const workflow = [
  "name: CI",
  "on:",
  "  pull_request:",
  "    branches: [main]",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  test-web:",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "  sonarcloud:",
  "    name: SonarCloud",
  "    steps:",
  "      - name: Generate coverage reports",
  "        run: pnpm test:coverage:sonar",
  "      - uses: SonarSource/sonarqube-scan-action@v7",
].join("\n");

const workspaceManifests = [
  "package.json",
  "api/package.json",
  "db/package.json",
  "ingest/package.json",
  "shared/package.json",
  "web/package.json",
];

function assess(paths, { changes = {}, scaEnabled = "false", previous = {} } = {}) {
  const files = {
    "sonar-project.properties": properties,
    ".github/workflows/ci.yml": workflow,
    ...Object.fromEntries(workspaceManifests.map((path) => [path, JSON.stringify(manifest)])),
    ...previous,
  };

  return assessChanges({
    paths,
    before(path) {
      return files[path] ?? null;
    },
    after(path) {
      if (Object.hasOwn(changes, path)) {
        return changes[path];
      }

      return files[path] ?? null;
    },
    scaEnabled,
  });
}

test("dependency-only updates skip code analysis when SCA is disabled", () => {
  const updated = {
    ...manifest,
    dependencies: { example: "2.0.0" },
    devDependencies: { vitest: "4.1.0" },
    optionalDependencies: { optional: "2.0.0" },
    peerDependencies: { peer: "2.0.0" },
    pnpm: { ...manifest.pnpm, overrides: { example: "2.0.0" } },
  };
  const changes = Object.fromEntries(workspaceManifests.map((path) => [path, JSON.stringify(updated)]));
  const decision = assess([...workspaceManifests, "pnpm-lock.yaml"], { changes });

  assert.equal(decision.scan, false);
  assert.ok(decision.reason.length > 0);
});

for (const scaEnabled of ["true", "unknown", undefined]) {
  test(`dependency inputs preserve analysis when SCA state is ${scaEnabled}`, () => {
    const decision = assessChanges({
      paths: ["pnpm-lock.yaml"],
      before(path) {
        return path === "sonar-project.properties" ? properties : null;
      },
      after(path) {
        return path === "sonar-project.properties" ? properties : null;
      },
      scaEnabled,
    });

    assert.equal(decision.scan, true);
  });
}

for (const path of [
  "api/src/index.ts",
  "db/src/index.ts",
  "ingest/lib/pipeline.ts",
  "shared/src/schema/message.ts",
  "web/components/Map.tsx",
  "web/components/Map.test.tsx",
  "ingest/__mocks__/fixtures/sources/sample.md",
  "ingest/crawlers/example/fixtures/response.json",
  "web/test/setup.ts",
  "api/vitest.config.ts",
  "db/vitest.config.mts",
  "shared/tsconfig.json",
  "api/tests/helper.ts",
  "db/fixtures/result.json",
  "shared/root.test.ts",
  "sonar-project.properties",
  ".github/scripts/sonar-inputs.mjs",
  ".github/scripts/sonar-inputs.test.mjs",
]) {
  test(`analysis input runs the scan: ${path}`, () => {
    assert.equal(assess([path]).scan, true);
  });
}

test("mixed dependency and source changes remain analyzed", () => {
  assert.equal(assess(["pnpm-lock.yaml", "web/lib/source.ts"]).scan, true);
});

test("a fixture named package.json remains a test input", () => {
  assert.equal(assess(["ingest/__mocks__/package.json"]).scan, true);
});

test("source roots follow the Sonar configuration", () => {
  const configuration = "sonar.sources=custom/src\nsonar.tests=custom/tests\n";

  assert.equal(assess(["custom/src/example.ts"], {
    previous: { "sonar-project.properties": configuration },
  }).scan, true);
  assert.equal(assess(["custom/tests/example.test.ts"], {
    previous: { "sonar-project.properties": configuration },
  }).scan, true);
});

for (const [root, path] of [
  [".", "scripts/example.ts"],
  ["./web", "web/lib/example.ts"],
  ["web/", "web/lib/example.ts"],
  ["web/lib/example.ts", "web/lib/example.ts"],
]) {
  test(`supported Sonar root syntax includes changed inputs: ${root}`, () => {
    const configuration = `sonar.sources=${root}\nsonar.tests=${root}\n`;

    assert.equal(assess([path], {
      previous: { "sonar-project.properties": configuration },
    }).scan, true);
  });
}

test("single-file Sonar roots preserve exact file boundaries", () => {
  const configuration = "sonar.sources=web/lib/example.ts\nsonar.tests=web/lib/example.test.ts\n";

  assert.equal(assess(["web/lib/another.ts"], {
    previous: { "sonar-project.properties": configuration },
  }).scan, false);
});

for (const declaration of ["sonar.sources=web\n", "sonar.tests=web\n"]) {
  test(`incomplete Sonar roots fail instead of skipping: ${declaration.trim()}`, () => {
    assert.throws(() => {
      assess(["web/lib/example.ts"], {
        previous: { "sonar-project.properties": declaration },
      });
    }, /Cannot determine Sonar source and test roots/);
  });
}

for (const root of ["/web", "C:/web", "web\\lib", "web/**", "../web", "web,"]) {
  test(`unsupported Sonar roots fail instead of skipping: ${root}`, () => {
    const configuration = `sonar.sources=${root}\nsonar.tests=web\n`;

    assert.throws(() => {
      assess(["web/lib/example.ts"], {
        previous: { "sonar-project.properties": configuration },
      });
    });
  });
}

test("documentation and unrelated workflows skip analysis", () => {
  const decision = assess([
    "README.md",
    "docs/setup/example.md",
    ".github/workflows/deploy.yml",
    ".github/dependabot.yml",
  ]);

  assert.equal(decision.scan, false);
});

test("generated build and coverage outputs skip analysis", () => {
  assert.equal(assess([
    "web/.next/server.js",
    "api/dist/index.js",
    "ingest/node_modules/example/index.js",
    "shared/coverage/lcov.info",
  ]).scan, false);
});

test("generated fixture directories outside Sonar roots skip analysis", () => {
  assert.equal(assess(["api/dist/fixtures/result.json"]).scan, false);
});

for (const field of ["scripts", "type", "exports", "main", "pnpm"]) {
  test(`manifest changes to ${field} remain analysis inputs`, () => {
    const updated = { ...manifest, [field]: field === "pnpm" ? { onlyBuiltDependencies: [] } : "changed" };

    assert.equal(assess(["web/package.json"], {
      changes: { "web/package.json": JSON.stringify(updated) },
    }).scan, true);
  });
}

for (const content of [null, "{ invalid JSON", "[]"]) {
  test(`missing or malformed manifest content fails conservatively: ${content}`, () => {
    assert.equal(assess(["api/package.json"], {
      changes: { "api/package.json": content },
    }).scan, true);
  });
}

test("a newly added workspace manifest requires analysis", () => {
  assert.equal(assess(["api/package.json"], {
    previous: { "api/package.json": null },
    changes: { "api/package.json": JSON.stringify(manifest) },
  }).scan, true);
});

test("reordering manifest fields does not turn a dependency update into source analysis", () => {
  const reordered = Object.fromEntries(Object.entries(manifest).reverse());

  assert.equal(assess(["package.json"], {
    changes: { "package.json": JSON.stringify(reordered) },
  }).scan, false);
});

test("a checkout bump in an unrelated CI job skips Sonar", () => {
  assert.equal(assess([".github/workflows/ci.yml"], {
    changes: { ".github/workflows/ci.yml": workflow.replace("actions/checkout@v4", "actions/checkout@v5") },
  }).scan, false);
});

test("a scanner action update requires analysis", () => {
  assert.equal(assess([".github/workflows/ci.yml"], {
    changes: { ".github/workflows/ci.yml": workflow.replace("sonarqube-scan-action@v7", "sonarqube-scan-action@v8") },
  }).scan, true);
});

test("changing the dedicated coverage command requires analysis", () => {
  assert.equal(assess([".github/workflows/ci.yml"], {
    changes: { ".github/workflows/ci.yml": workflow.replace("run: pnpm test:coverage:sonar", "run: pnpm test:coverage:new") },
  }).scan, true);
});

test("top-level workflow environment changes require analysis", () => {
  assert.equal(assess([".github/workflows/ci.yml"], {
    changes: { ".github/workflows/ci.yml": workflow.replace("jobs:\n", "env:\n  NODE_OPTIONS: --max-old-space-size=4096\njobs:\n") },
  }).scan, true);
});

test("unrecognized CI structure fails conservatively", () => {
  assert.equal(assess([".github/workflows/ci.yml"], {
    changes: { ".github/workflows/ci.yml": "jobs: {}\n" },
  }).scan, true);
});

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "sonar-inputs-"));

  t.after(() => {
    assert.equal(dirname(resolve(cwd)), resolve(tmpdir()));
    assert.ok(cwd.startsWith(join(tmpdir(), "sonar-inputs-")));
    rmSync(cwd, { recursive: true, force: true });
  });

  function git(...args) {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  function write(path, content = "fixture\n") {
    const destination = join(cwd, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }

  function commit() {
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  }

  git("init", "--initial-branch=main");
  git("config", "user.name", "Sonar input test");
  git("config", "user.email", "sonar-input-test@example.invalid");
  write("sonar-project.properties", properties);
  write("package.json", JSON.stringify(manifest));
  write("web/lib/source.ts", "export const value = 1;\n");
  write("docs/example.md");
  const base = commit();

  function evaluate(head, overrides = {}) {
    return evaluatePullRequest({ base, head, cwd, scaEnabled: "false", ...overrides });
  }

  return { cwd, base, git, write, commit, evaluate };
}

test("git diff includes source renamed outside the analyzed roots", (t) => {
  const repo = repository(t);
  renameSync(join(repo.cwd, "web/lib/source.ts"), join(repo.cwd, "docs/moved.ts"));

  assert.equal(repo.evaluate(repo.commit()).scan, true);
});

test("git diff includes a document renamed into an analyzed root", (t) => {
  const repo = repository(t);
  renameSync(join(repo.cwd, "docs/example.md"), join(repo.cwd, "web/lib/new.md"));

  assert.equal(repo.evaluate(repo.commit()).scan, true);
});

test("git diff includes deleted source files", (t) => {
  const repo = repository(t);
  rmSync(join(repo.cwd, "web/lib/source.ts"));

  assert.equal(repo.evaluate(repo.commit()).scan, true);
});

test("git diff handles a relevant filename containing spaces", (t) => {
  const repo = repository(t);
  repo.write("web/lib/source with spaces.ts");

  assert.equal(repo.evaluate(repo.commit()).scan, true);
});

test("git diff handles a relevant filename containing a newline", {
  skip: process.platform === "win32" ? "Windows filenames cannot contain newlines" : false,
}, (t) => {
  const repo = repository(t);
  repo.write("web/lib/source\nwith-newline.ts");

  assert.equal(repo.evaluate(repo.commit()).scan, true);
});

test("git diff finds source changes after more than 300 unrelated paths", (t) => {
  const repo = repository(t);

  for (let index = 0; index < 350; index += 1) {
    repo.write(`docs/generated-${index}.md`);
  }

  repo.write("web/lib/source.ts", "export const value = 2;\n");
  assert.equal(repo.evaluate(repo.commit()).scan, true);
});

test("git comparison uses the merge base when the target branch advances", (t) => {
  const repo = repository(t);
  repo.git("checkout", "-b", "feature");
  repo.write("package.json", JSON.stringify({ ...manifest, dependencies: { example: "2.0.0" } }));
  const head = repo.commit();
  repo.git("checkout", "main");
  repo.write("package.json", JSON.stringify({ ...manifest, scripts: { "test:coverage": "new coverage command" } }));
  const advancedBase = repo.commit();

  assert.equal(repo.evaluate(head, { base: advancedBase }).scan, false);
});

test("git dependency-only changes skip while preserving an enabled SCA scan", (t) => {
  const repo = repository(t);
  repo.write("package.json", JSON.stringify({ ...manifest, dependencies: { example: "2.0.0" } }));
  repo.write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  const head = repo.commit();

  assert.equal(repo.evaluate(head).scan, false);
  assert.equal(repo.evaluate(head, { scaEnabled: "true" }).scan, true);
});

test("invalid git refs fail instead of reporting an intentional skip", (t) => {
  const repo = repository(t);

  assert.throws(() => {
    repo.evaluate("missing-head-ref");
  });
});

test("a nonexistent full commit SHA fails instead of reporting an intentional skip", (t) => {
  const repo = repository(t);

  assert.throws(() => {
    repo.evaluate("f".repeat(40));
  }, /Command failed: git merge-base/);
});
