import fs from "node:fs/promises";
import path from "node:path";
import { parseOutboundCsv } from "../services/outboundCsv";
import { importOutboundRows } from "../services/outboundRepository";

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const fileArg = args.find((arg) => !arg.startsWith("--"));
  if (!fileArg) {
    throw new Error("Usage: npm run outbound:import -- data/outbound_demo_customers.csv [--commit]");
  }
  const filePath = path.resolve(process.cwd(), fileArg);
  const parsed = parseOutboundCsv(await fs.readFile(filePath, "utf8"));
  if (parsed.errors.length) {
    console.error(JSON.stringify({ valid: false, errors: parsed.errors }, null, 2));
    process.exitCode = 1;
    return;
  }
  const result = await importOutboundRows(parsed.rows, !commit);
  console.log(
    JSON.stringify(
      {
        valid: true,
        mode: commit ? "commit" : "dry_run",
        file: fileArg,
        result,
      },
      null,
      2,
    ),
  );
  if (!commit) console.log("Dry run only. Re-run with --commit after applying the migration and reviewing the rows.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
