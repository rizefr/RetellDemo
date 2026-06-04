import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { env } from "../config/env";

async function main() {
  const schemaPath = path.resolve(process.cwd(), "supabase/schema.sql");
  const sql = await fs.readFile(schemaPath, "utf8");

  if (!env.SUPABASE_DB_URL) {
    console.log("SUPABASE_DB_URL is not set.");
    console.log("Apply supabase/schema.sql manually in the Supabase SQL editor, or set SUPABASE_DB_URL and rerun.");
    return;
  }

  const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Supabase schema applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Supabase setup failed", error);
  process.exitCode = 1;
});
