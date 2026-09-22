// Runtime-agnostic core with zero dependencies: the schema and canonical
// Submission model plus server-authoritative validation. Delivery lives in
// "./sinks", the request handler in "./server", the browser helper in
// "./client"; each is a separate subpath entry so consumers only load what
// their runtime can run.
export type {
  FieldType,
  FormField,
  FormSchema,
  ValidationCode,
  FormErrorCode,
  ValidationError,
  ValidationResult,
  SubmissionMeta,
  Submission,
} from "./types";
export { validate } from "./validate";
export { readFields, honeypotTripped, buildSubmission, META_PAGE_KEY, META_LOCALE_KEY } from "./submission";
