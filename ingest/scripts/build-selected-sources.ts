import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { getSelectedSourceIds } from "@/sources/registry";

function reportDiagnostics(diagnostics: readonly ts.Diagnostic[]): void {
  if (diagnostics.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    }));
  }
}

function isSelectedCrawlerFile(
  fileName: string,
  ingestDirectory: string,
  selectedIds: ReadonlySet<string>,
): boolean {
  const [directory, sourceId] = relative(ingestDirectory, fileName).split(sep);
  return directory !== "crawlers" || sourceId === "shared" || selectedIds.has(sourceId);
}

/** Ordinary application roots plus each selected source's entrypoint. */
export function createSelectedBuildConfig(
  ingestDirectory: string,
  selectedIds: readonly string[],
): ts.ParsedCommandLine {
  const directory = resolve(ingestDirectory);
  const configPath = join(directory, "tsconfig.build.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    reportDiagnostics([config.error]);
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, directory);
  reportDiagnostics(parsed.errors);
  parsed.fileNames = parsed.fileNames.filter((fileName) => {
    const parts = relative(directory, fileName).split(sep);
    return parts[0] !== "crawlers" && !parts.includes("__mocks__");
  });

  const selected = new Set<string>();
  for (const sourceId of selectedIds) {
    if (!sourceId || sourceId === "." || sourceId === ".." || sourceId === "shared" || /[\\/]/.test(sourceId)) {
      throw new Error(`Invalid selected source ID: ${sourceId}`);
    }
    if (selected.has(sourceId)) {
      throw new Error(`Duplicate selected source ID: ${sourceId}`);
    }
    selected.add(sourceId);
    const entrypoint = join(directory, "crawlers", sourceId, "index.ts");
    if (!existsSync(entrypoint)) {
      throw new Error(`Selected source ${sourceId} has no crawler entrypoint`);
    }
    parsed.fileNames.push(entrypoint);
  }
  return parsed;
}

/** Compile the selected sources into a fresh production output directory. */
export function buildSelectedSources(
  ingestDirectory: string,
  selectedIds: readonly string[],
): void {
  const directory = resolve(ingestDirectory);
  const config = createSelectedBuildConfig(directory, selectedIds);
  const outputDirectory = resolve(config.options.outDir ?? "");
  if (outputDirectory !== join(directory, "dist")) {
    throw new Error("Selected source builds require outDir to be the ingest dist directory");
  }
  rmSync(outputDirectory, { recursive: true, force: true });

  const program = ts.createProgram(config.fileNames, config.options);
  const selected = new Set(selectedIds);
  for (const sourceFile of program.getSourceFiles()) {
    if (!isSelectedCrawlerFile(sourceFile.fileName, directory, selected)) {
      throw new Error(`Production code imports an unselected crawler: ${sourceFile.fileName}`);
    }
  }
  reportDiagnostics(ts.getPreEmitDiagnostics(program));
  const result = program.emit();
  reportDiagnostics(result.diagnostics);
  if (result.emitSkipped) {
    throw new Error("Selected source compilation skipped emission");
  }

  const crawlerOutput = join(outputDirectory, "crawlers");
  const emittedIds = existsSync(crawlerOutput)
    ? readdirSync(crawlerOutput, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "shared")
      .map((entry) => entry.name)
    : [];
  if (emittedIds.length !== selected.size || emittedIds.some((id) => !selected.has(id))) {
    throw new Error("Compiled crawler directories differ from the selected sources");
  }
}

if (require.main === module) {
  try {
    buildSelectedSources(process.cwd(), getSelectedSourceIds());
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
