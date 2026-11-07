/* Normalize Dash's build-time mtime cache key to a reproducible content key.
 *
 * webpack-dash-dynamic-import injects 'v0_1_0m<wall clock mtime>' into both
 * the emitted bundle and source map. For identical inputs, that makes each
 * build different. Hash the timestamp-neutral JavaScript itself and use
 * the same deterministic fingerprint for both outputs. Asset URLs still
 * change whenever the compiled JavaScript changes.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("dash_reactgrid");
const files = [
  resolve(root, "dash_reactgrid.min.js"),
  resolve(root, "dash_reactgrid.min.js.map"),
];
const token = /v\d+(?:_\d+)+m\d+/g;
const js = readFileSync(files[0], "utf8");
const stamps = js.match(token);
if (!stamps?.length) {
  throw new Error("Dash mtime cache key not found: inspect webpack output before release");
}
const neutral = js.replace(token, (match) => match.replace(/m\d+$/, "mSTATIC"));
const numericHash = parseInt(createHash("sha256").update(neutral).digest("hex").slice(0, 8), 16);
for (const file of files) {
  const input = readFileSync(file, "utf8");
  const normalized = input.replace(token, (match) =>
    match.replace(/m\d+$/, "m" + numericHash)
  );
  if (normalized === input && file === files[0])
    throw new Error("Dash bundle still contains the timestamp-based cache key");
  writeFileSync(file, normalized, "utf8");
}
console.log("Normalized Dash asset cache key to deterministic build fingerprint", numericHash);
