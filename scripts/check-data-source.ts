// One-off Phase 1 check: demo data / DB data / DatabaseUnavailableError, depending on DATABASE_URL.
import { DatabaseUnavailableError, getDashboard } from "../src/lib/data-source";

(async () => {
  try {
    const d = await getDashboard();
    console.log(d.source, d.workstreams.length, "workstreams,", d.workstreams.flatMap((w) => w.tasks).length, "tasks");
  } catch (e) {
    console.log(e instanceof DatabaseUnavailableError ? "DatabaseUnavailableError" : e);
  }
  process.exit(0);
})();
