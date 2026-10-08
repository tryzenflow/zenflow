// After `changeset version`: copy the (fixed-group) version onto the root
// package.json and the compose default image tags so nothing keeps a stale one.
import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("backend/package.json", "utf8")).version;

const root = JSON.parse(readFileSync("package.json", "utf8"));
root.version = version;
writeFileSync("package.json", `${JSON.stringify(root, null, 2)}\n`);

for (const file of ["backend/compose.prod.yml", "backend/compose.staging.yml"]) {
  const text = readFileSync(file, "utf8");
  writeFileSync(file, text.replace(/(zenflow-api:)[^}\s]+/g, `$1${version}`));
}
console.log(`synced version ${version}`);
