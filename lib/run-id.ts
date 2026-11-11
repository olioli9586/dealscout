// Run ids are UUIDs. Checked before an id goes into an agent path (keeps
// "../" out) and when reading the run history the browser keeps.
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRunId(id: string): boolean {
  return RUN_ID.test(id);
}
