/**
 * Checks that no server-only secret can reach the browser.
 *
 *   node scripts/check-env-safety.mjs
 *
 * Plain node — no tsx, no condition flags. Run it after filling in .env.local,
 * and after any change to which variables the app reads.
 *
 * Three checks, weakest to strongest:
 *   1. no NEXT_PUBLIC_ variable is NAMED like a secret
 *   2. no NEXT_PUBLIC_ variable holds the same VALUE as a server-only one
 *      (the case a name check misses entirely: a correct name, wrong value)
 *   3. no server-only value appears in the built client bundle under
 *      .next/static — the only check that tests what actually ships
 *
 * Secrets are never printed, only matched.
 */
import fs from "node:fs";
import path from "node:path";

const SERVER_ONLY = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_JWT_SECRET",
  "LINE_LOGIN_CHANNEL_SECRET",
  "LINE_MESSAGING_CHANNEL_SECRET",
  "LINE_MESSAGING_CHANNEL_ACCESS_TOKEN",
];

const envPath = path.join(process.cwd(), ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("No .env.local found. Run from the project root.");
  process.exit(2);
}

const env = {};
for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const at = line.indexOf("=");
  env[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
}

const publicVars = Object.entries(env).filter(([key]) => key.startsWith("NEXT_PUBLIC_"));
let failures = 0;
const report = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
};

// 1. naming
const badlyNamed = publicVars
  .map(([key]) => key)
  .filter((key) => /SERVICE|ROLE|SECRET|PRIVATE/i.test(key));
report(badlyNamed.length === 0, "no NEXT_PUBLIC_ variable is named like a secret",
  badlyNamed.length ? `offending: ${badlyNamed.join(", ")}` : `checked ${publicVars.length} public vars`);

// 2. values
const untested = [];
for (const name of SERVER_ONLY) {
  const secret = env[name];
  if (!secret) {
    untested.push(name);
    continue;
  }
  const leaked = publicVars.filter(([, value]) => value && value === secret).map(([key]) => key);
  report(leaked.length === 0, `${name} is not duplicated into a NEXT_PUBLIC_ variable`,
    leaked.length ? `LEAKED VIA: ${leaked.join(", ")}` : "");
}
if (untested.length > 0) {
  console.log(`SKIP  blank, so not value-checked: ${untested.join(", ")}`);
}

// 3. what actually ships
const staticDir = path.join(process.cwd(), ".next", "static");
if (!fs.existsSync(staticDir)) {
  console.log("SKIP  no .next/static — run `npm run build` first for the bundle check");
} else {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|css|map)$/.test(entry.name)) files.push(full);
    }
  };
  walk(staticDir);

  const secrets = SERVER_ONLY.map((name) => [name, env[name]]).filter(([, v]) => v && v.length >= 12);
  const found = [];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    for (const [name, secret] of secrets) {
      if (content.includes(secret)) found.push(`${name} in ${path.relative(process.cwd(), file)}`);
    }
  }
  report(found.length === 0,
    `no server-only secret appears in the client bundle (${files.length} files scanned)`,
    found.length ? found.join("\n        ") : secrets.length ? `checked ${secrets.length} secret(s)` : "no non-blank secrets to check");
}

console.log(failures === 0 ? "\nNO LEAKS DETECTED" : `\n${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
