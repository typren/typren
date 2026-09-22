import type { FormSchema, Submission } from "../types";
import type { EnvRecord } from "./env";

export interface SinkResult {
  ok: boolean;
  detail?: string;
}

/**
 * The delivery port. Every storage/delivery vendor is a sink behind this one
 * interface; the server handler fans a Submission out to all of them and
 * never knows a vendor by name. Implementations report failure through
 * `ok: false` or by throwing; the handler isolates either per sink.
 */
export interface FormSink {
  type: string;
  deliver(submission: Submission, schema: FormSchema): Promise<SinkResult>;
}

interface SinkConfigBase {
  /**
   * When true, the handler's overall response fails if this sink fails.
   * Default false: every sink is optional but its outcome is still reported.
   */
  required?: boolean;
}

/** POST the Submission as JSON to any URL: the universal escape hatch. */
export interface WebhookSinkConfig extends SinkConfigBase {
  type: "webhook";
  url: string;
  /** Header values may be "${VAR}" environment references (e.g. an Authorization secret). */
  headers?: Record<string, string>;
}

export interface HubspotSinkConfig extends SinkConfigBase {
  type: "hubspot";
  portalId: string;
  formGuid: string;
  /**
   * Name of the schema field that carries the visitor's hubspotutk cookie
   * (typically a hidden field the page fills). Sent as context.hutk and
   * excluded from the mapped fields.
   */
  hutkField?: string;
  /** "${VAR}" reference to a private-app token; switches to the authenticated submit endpoint. */
  accessToken?: string;
}

export interface GoogleSheetsSinkConfig extends SinkConfigBase {
  type: "google-sheets";
  spreadsheetId: string;
  /** A1-notation range to append after, e.g. "Sheet1!A1". Defaults to "A1". */
  range?: string;
  /** "${VAR}" reference to an OAuth or service-account bearer token. */
  token: string;
}

/** JSONL append to a local path: the reference/dev sink that proves the port. */
export interface FileSinkConfig extends SinkConfigBase {
  type: "file";
  path: string;
}

export type SinkConfig = WebhookSinkConfig | HubspotSinkConfig | GoogleSheetsSinkConfig | FileSinkConfig;

/** Injection seam shared by all fetch-backed sinks; tests pass a fake fetchImpl and env. */
export interface SinkRuntime {
  fetchImpl?: typeof fetch;
  env?: EnvRecord;
}
