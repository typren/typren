// ponytail: one fixed day-month-year style ("27 Oct 2026") for every date the
// studio shows. Cloud accounts get a display preference later; take a
// formatter from the host then.
const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/** An ISO timestamp as "27 Oct 2026", or a dash when it does not parse. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : DATE.format(d);
}
