import type { ExportApiSourceConfig } from "./export-api";

/** Every `export-api` field a preset can supply. Never `projectId`/`token`: those are always per-project, explicit in the config. */
export type ExportApiPreset = Omit<ExportApiSourceConfig, "type" | "preset" | "projectId" | "token" | "langMap">;

/**
 * Preset registry, as data: each entry is one TMS's known `export-api` shape.
 * A config's own explicit fields still override a preset's per-field (see
 * `resolveConfig` in export-api.ts), so adding a TMS here never requires a
 * provider code change, just a new entry (plus its own contract-suite test).
 */
export const exportApiPresets: Record<string, ExportApiPreset> = {
  lokalise: {
    baseUrl: "https://api.lokalise.com/api2",
    auth: { header: "X-Api-Token" },
    create: {
      method: "POST",
      path: "/projects/{projectId}/files/async-download",
      body: {
        format: "json",
        placeholder_format: "icu",
        original_filenames: false,
        bundle_structure: "%LANG_ISO%.json",
        export_empty_as: "skip",
      },
    },
    // Response shapes differ between the two endpoints (verified against the
    // live API): the CREATE response carries process_id at the TOP level,
    // while the POLL response nests everything under a `process` wrapper.
    poll: {
      idPath: "process_id",
      path: "/processes/{processId}",
      statusPath: "process.status",
      doneValues: ["finished"],
      urlPath: "process.details.download_url",
    },
    bundle: "zip",
  },
  crowdin: {
    baseUrl: "https://api.crowdin.com/api/v2",
    // Auth is the default Authorization: Bearer. The build endpoint has no
    // format selector: the bundle mirrors the project's own source file
    // formats, so a JSON catalog only comes out of a JSON-sourced project.
    create: {
      method: "POST",
      path: "/projects/{projectId}/translations/builds",
      body: {},
    },
    // The download endpoint doubles as the poll endpoint: while building it
    // answers with a status body ("created"/"inProgress"), and on completion
    // it answers with data.url and no status field (the URL-appears completion
    // signal in export-api.ts).
    poll: {
      idPath: "data.id",
      path: "/projects/{projectId}/translations/builds/{buildId}/download",
      statusPath: "data.status",
      doneValues: ["finished"],
      failValues: ["failed", "canceled"],
      urlPath: "data.url",
    },
    bundle: "zip",
    zipLocaleFrom: "dir",
  },
};
