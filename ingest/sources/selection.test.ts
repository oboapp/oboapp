import { describe, expect, it } from "vitest";
import type { SourceMetadata } from "@oboapp/source-sdk";
import { validateSourceSelection, type SourceSelection } from "./selection";

const metadata: SourceMetadata = {
  id: "district-news",
  name: "District news",
  url: "https://example.com/news",
  localities: ["bg.plovdiv"],
};

function selection(overrides: Partial<SourceSelection> = {}): SourceSelection {
  return {
    catalog: [metadata],
    packages: [{ name: "@oboapp/source-district-news", version: "0.1.0", metadata }],
    entrypointIds: [metadata.id],
    jobsByLocality: {
      "bg.plovdiv": { news: { source: metadata.id } },
    },
    ...overrides,
  };
}

describe("selected source configuration", () => {
  it("accepts an instance containing only its selected package", () => {
    expect(() => validateSourceSelection(selection())).not.toThrow();
  });

  it("accepts mixed package and legacy sources with their existing job keys", () => {
    const legacy = { ...metadata, id: "legacy-water", emergent: true };
    expect(() => validateSourceSelection(selection({
      catalog: [metadata, legacy],
      entrypointIds: [metadata.id, legacy.id, "unselected-sofia-source"],
      jobsByLocality: {
        "bg.plovdiv": {
          news: { source: metadata.id },
          water: { source: legacy.id, emergent: true },
        },
      },
    }))).not.toThrow();
  });

  it("allows a package to support more localities than the instance selects", () => {
    expect(() => validateSourceSelection(selection({
      packages: [{
        name: "@oboapp/source-district-news",
        version: "1.2.3-beta.1",
        metadata: { ...metadata, localities: ["bg.plovdiv", "bg.sofia"] },
      }],
    }))).not.toThrow();
  });

  it("treats omitted and explicit false metadata and schedule flags equally", () => {
    expect(() => validateSourceSelection(selection({
      catalog: [{ ...metadata, experimental: false, emergent: false }],
      jobsByLocality: {
        "bg.plovdiv": { news: { source: metadata.id, emergent: false } },
      },
    }))).not.toThrow();
  });

  it.each([
    "0.0.0",
    "1.2.3-beta.1",
    "1.2.3+build.01",
    "1.2.3-beta-1.0+build-1.001",
    "1.2.3-01alpha",
    "999999999999999999999.2.3",
  ])("accepts the exact SemVer version %s", (version) => {
    expect(() => validateSourceSelection(selection({
      packages: [{ name: "@oboapp/source-district-news", version, metadata }],
    }))).not.toThrow();
  });

  it.each([
    "^0.1.0",
    "~0.1.0",
    "latest",
    "workspace:*",
    "file:../source",
    "v1.2.3",
    "1.2",
    "1.2.3.4",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2.3-",
    "1.2.3-alpha..1",
    "1.2.3-01",
    "1.2.3-alpha.01",
    "1.2.3-alpha_beta",
    "1.2.3+",
    "1.2.3+build..1",
    "1.2.3+build+other",
    "1.2.3+build_1",
    " 1.2.3",
    "1.2.3 ",
    "1.2.3-beta 1",
    "",
  ])(
    "rejects an unpinned or invalid SemVer version: %s",
    (version) => {
      expect(() => validateSourceSelection(selection({
        packages: [{ name: "@oboapp/source-district-news", version, metadata }],
      }))).toThrow("@oboapp/source-district-news must use an exact package version");
    },
  );

  it.each([
    { field: "name", changed: { ...metadata, name: "Renamed district" } },
    { field: "url", changed: { ...metadata, url: "https://example.com/other" } },
    { field: "experimental", changed: { ...metadata, experimental: true } },
    { field: "emergent", changed: { ...metadata, emergent: true } },
  ])("rejects package metadata drift in $field", ({ field, changed }) => {
    expect(() => validateSourceSelection(selection({
      packages: [{ name: "@oboapp/source-district-news", version: "0.1.0", metadata: changed }],
    }))).toThrow(`metadata ${field} differs from catalog source district-news`);
  });

  it("rejects a catalog locality unsupported by the installed package", () => {
    expect(() => validateSourceSelection(selection({
      packages: [{
        name: "@oboapp/source-district-news",
        version: "0.1.0",
        metadata: { ...metadata, localities: ["bg.sofia"] },
      }],
    }))).toThrow("does not support catalog locality bg.plovdiv");
  });

  it("rejects an installed package whose source is not selected", () => {
    expect(() => validateSourceSelection(selection({
      packages: [{
        name: "@oboapp/source-sofia-news",
        version: "0.1.0",
        metadata: { ...metadata, id: "sofia-news" },
      }],
    }))).toThrow("@oboapp/source-sofia-news provides unselected source sofia-news");
  });

  it("allows an explicitly retained unselected integration package", () => {
    expect(() => validateSourceSelection(selection({
      packages: [{
        name: "@oboapp/source-sofia-news",
        version: "0.1.0",
        metadata: { ...metadata, id: "sofia-news" },
      }],
      retainedUnselectedPackages: ["@oboapp/source-sofia-news"],
    }))).not.toThrow();
  });

  it("still requires exact versions for retained packages", () => {
    expect(() => validateSourceSelection(selection({
      packages: [{
        name: "@oboapp/source-sofia-news",
        version: "^0.1.0",
        metadata: { ...metadata, id: "sofia-news" },
      }],
      retainedUnselectedPackages: ["@oboapp/source-sofia-news"],
    }))).toThrow("@oboapp/source-sofia-news must use an exact package version");
  });

  it("rejects a retention entry for a removed package", () => {
    expect(() => validateSourceSelection(selection({
      retainedUnselectedPackages: ["@oboapp/source-removed"],
    }))).toThrow("Retained unselected package @oboapp/source-removed is not installed");
  });

  it("requires removing the retention entry when its source is selected", () => {
    expect(() => validateSourceSelection(selection({
      retainedUnselectedPackages: ["@oboapp/source-district-news"],
    }))).toThrow("Retained unselected package @oboapp/source-district-news is selected");
  });

  it("rejects duplicate retention entries", () => {
    expect(() => validateSourceSelection(selection({
      retainedUnselectedPackages: ["@oboapp/source-removed", "@oboapp/source-removed"],
    }))).toThrow("Retained unselected package @oboapp/source-removed is listed more than once");
  });

  it("still rejects duplicate source identities among retained packages", () => {
    const retainedMetadata = { ...metadata, id: "sofia-news" };
    expect(() => validateSourceSelection(selection({
      packages: [
        { name: "@oboapp/source-sofia-news", version: "0.1.0", metadata: retainedMetadata },
        { name: "@oboapp/source-other-news", version: "0.1.0", metadata: retainedMetadata },
      ],
      retainedUnselectedPackages: ["@oboapp/source-sofia-news", "@oboapp/source-other-news"],
    }))).toThrow("Multiple packages provide source sofia-news");
  });

  it("rejects two installed packages claiming the same source identity", () => {
    expect(() => validateSourceSelection(selection({
      packages: [
        { name: "@oboapp/source-district-news", version: "0.1.0", metadata },
        { name: "@oboapp/source-other-news", version: "0.1.0", metadata },
      ],
    }))).toThrow("Multiple packages provide source district-news");
  });

  it("rejects a selected source without an implementation entrypoint", () => {
    expect(() => validateSourceSelection(selection({ entrypointIds: [] })))
      .toThrow("Catalog source district-news has no crawler entrypoint");
  });

  it("rejects duplicate catalog identities", () => {
    expect(() => validateSourceSelection(selection({ catalog: [metadata, metadata] })))
      .toThrow("Duplicate catalog source district-news");
  });

  it("rejects a selected source with no locality", () => {
    expect(() => validateSourceSelection(selection({
      catalog: [{ ...metadata, localities: [] }],
    }))).toThrow("Catalog source district-news has no localities");
  });

  it("rejects a catalog locality without deployment configuration", () => {
    expect(() => validateSourceSelection(selection({ jobsByLocality: {} })))
      .toThrow("Catalog locality bg.plovdiv has no deployment job configuration");
  });

  it("rejects a selected source missing from its locality's jobs", () => {
    expect(() => validateSourceSelection(selection({
      jobsByLocality: { "bg.plovdiv": {} },
    }))).toThrow("Catalog source district-news has no deployment job in bg.plovdiv");
  });

  it("rejects a deployment job for an unselected source", () => {
    expect(() => validateSourceSelection(selection({
      jobsByLocality: {
        "bg.plovdiv": {
          news: { source: metadata.id },
          stale: { source: "removed-source" },
        },
      },
    }))).toThrow("Deployment job stale selects removed-source outside the bg.plovdiv catalog");
  });

  it("rejects a deployment job in a locality unsupported by its source", () => {
    expect(() => validateSourceSelection(selection({
      jobsByLocality: {
        "bg.plovdiv": { news: { source: metadata.id } },
        "bg.sofia": { misplaced: { source: metadata.id } },
      },
    }))).toThrow("Deployment job misplaced selects district-news outside the bg.sofia catalog");
  });

  it("rejects multiple jobs for one source in the same locality", () => {
    expect(() => validateSourceSelection(selection({
      jobsByLocality: {
        "bg.plovdiv": {
          news: { source: metadata.id },
          duplicate: { source: metadata.id },
        },
      },
    }))).toThrow("Multiple deployment jobs select district-news in bg.plovdiv");
  });

  it("rejects job keys that Terraform would overwrite across localities", () => {
    expect(() => validateSourceSelection(selection({
      catalog: [{ ...metadata, localities: ["bg.plovdiv", "bg.sofia"] }],
      packages: [],
      jobsByLocality: {
        "bg.plovdiv": { news: { source: metadata.id } },
        "bg.sofia": { news: { source: metadata.id } },
      },
    }))).toThrow("Deployment job key news is reused across localities");
  });

  it.each([
    { catalogEmergent: true, jobEmergent: undefined },
    { catalogEmergent: false, jobEmergent: true },
  ])("rejects a changed emergent schedule: $catalogEmergent to $jobEmergent", ({ catalogEmergent, jobEmergent }) => {
    expect(() => validateSourceSelection(selection({
      catalog: [{ ...metadata, emergent: catalogEmergent }],
      packages: [],
      jobsByLocality: {
        "bg.plovdiv": { news: { source: metadata.id, emergent: jobEmergent } },
      },
    }))).toThrow("Deployment job news emergent schedule differs from catalog source district-news");
  });

  it("reports independent selection problems together", () => {
    expect(() => validateSourceSelection(selection({
      entrypointIds: [],
      jobsByLocality: {},
    }))).toThrow(
      "Invalid source selection:\n" +
      "Catalog source district-news has no crawler entrypoint\n" +
      "Catalog locality bg.plovdiv has no deployment job configuration",
    );
  });
});
