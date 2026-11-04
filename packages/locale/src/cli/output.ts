export const EXIT_OK = 0;
export const EXIT_PROBLEMS = 1;
/** Usage error or the verb could not run. */
export const EXIT_FAILURE = 2;

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** Usage error or failure: human line on stderr; with json also {ok:false,error} on stdout; exitCode 2. */
export function fail(verb: string, message: string, json: boolean): void {
  console.error(`typren-locale ${verb}: ${message}`);
  if (json) printJson({ ok: false, error: message });
  process.exitCode = EXIT_FAILURE;
}
