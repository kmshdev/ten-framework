import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [image, databaseId, output = ".generated/wrangler.staging.json"] =
  process.argv.slice(2);

if (!image || !databaseId) {
  console.error(
    "usage: node generate-staging-config.mjs <image> <database-id> [output]",
  );
  process.exit(1);
}

const config = {
  $schema: "../node_modules/wrangler/config-schema.json",
  name: "superyou-voice-agent-staging",
  main: "../src/index.ts",
  compatibility_date: "2026-06-01",
  workers_dev: true,
  observability: { enabled: true },
  containers: [
    {
      class_name: "SuperYouAgent",
      image,
      instance_type: "standard-3",
      max_instances: 1,
    },
  ],
  durable_objects: {
    bindings: [{ name: "SUPERYOU_AGENT", class_name: "SuperYouAgent" }],
  },
  migrations: [{ tag: "v1", new_sqlite_classes: ["SuperYouAgent"] }],
  d1_databases: [
    {
      binding: "DB",
      database_name: "superyou-demo-staging",
      database_id: databaseId,
      migrations_dir: "../d1-migrations",
    },
  ],
  vectorize: [{ binding: "KB", index_name: "superyou-kb-staging" }],
  ai: { binding: "AI" },
};

const outputPath = resolve(output);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(outputPath);
