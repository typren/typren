export type FieldType = "text" | "email" | "textarea" | "select" | "checkbox" | "hidden";

export interface FormField {
  name: string;
  type: FieldType;
  required?: boolean;
  maxLength?: number;
  /** RegExp source the whole value must match. Anchored by validate(); do not include ^ and $. */
  pattern?: string;
  /** Allowed values for "select" fields. Other types ignore it. */
  options?: string[];
}

export interface FormSchema {
  id: string;
  fields: FormField[];
  /**
   * Name of the honeypot field: a field rendered hidden that must arrive
   * empty. It does not have to appear in `fields`; a submission where it
   * carries any value is dropped by the server handler before validation.
   */
  honeypot?: string;
}

/** Codes reported per field by validate(). */
export type ValidationCode = "required" | "invalid_type" | "invalid_email" | "invalid_option" | "too_long" | "pattern";

/**
 * Form-level codes the server handler adds on top of validation: "bad_request"
 * for an unparseable body and "spam" for a failed verifier, both reported with
 * an empty `field`.
 */
export type FormErrorCode = ValidationCode | "bad_request" | "spam";

export interface ValidationError {
  field: string;
  code: FormErrorCode;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

export interface SubmissionMeta {
  /** ISO 8601 timestamp assigned by the server when the submission is built. */
  submittedAt: string;
  page?: string;
  locale?: string;
}

/** The canonical shape every sink receives. */
export interface Submission {
  formId: string;
  fields: Record<string, string | boolean>;
  meta: SubmissionMeta;
}
