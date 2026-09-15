/**
 * Builds the booking-confirmation Flex Message with sample data and, if
 * configured, pushes it to one LINE user.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/send-test-push.ts
 *
 * Without a token it prints the Flex JSON, which can be pasted into LINE's Flex
 * Message Simulator (developers.line.biz/flex-simulator) to check the layout.
 * With LINE_MESSAGING_CHANNEL_ACCESS_TOKEN and LINE_TEST_USER_ID in .env.local,
 * it actually sends.
 *
 * LINE_TEST_USER_ID must be a `sub` from THIS salon's Login channel — the value
 * shown as "token sub" on /liff/booking/diagnostics. Provider-scoped, so a userId from
 * anywhere else identifies nobody here.
 */
import fs from "node:fs";
import path from "node:path";

for (const raw of fs.existsSync(path.join(process.cwd(), ".env.local"))
  ? fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")
  : []) {
  const line = raw.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const at = line.indexOf("=");
  const key = line.slice(0, at).trim();
  if (!(key in process.env)) {
    process.env[key] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
  }
}

import { buildBookingConfirmationMessage } from "@/lib/line/booking-confirmation";
import { pushToLineUser } from "@/lib/line/push";

async function main() {
  const message = buildBookingConfirmationMessage({
    tenantName: "沐光髮藝",
    brandPrimary: "#1f5f4e",
    serviceName: "洗剪吹",
    staffName: "小雨",
    date: "2026-09-20",
    time: "14:00",
    durationMinutes: 60,
    priceTwd: 800,
    bookingId: "3f9a1c2e-7b4d-4e8a-9c1f-2d5e6f7a8b9c",
    wasReassigned: true,
  });

  // Structural sanity against LINE's documented limits.
  const json = JSON.stringify(message);
  const problems: string[] = [];
  if (message.altText.length > 400) problems.push(`altText ${message.altText.length} chars (max 400)`);
  if (json.length > 50_000) problems.push(`payload ${json.length} bytes (max 50KB)`);
  const colours = [...json.matchAll(/"(?:color|backgroundColor)":"([^"]+)"/g)].map((m) => m[1]);
  for (const c of colours) {
    if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(c)) problems.push(`bad colour ${c}`);
  }
  console.log(`altText: ${message.altText}`);
  console.log(`payload: ${json.length} bytes, ${colours.length} colours checked`);
  console.log(problems.length ? `PROBLEMS: ${problems.join("; ")}` : "structure: OK");

  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_TEST_USER_ID;

  if (!token || !to) {
    console.log(
      `\nNot sending: ${!token ? "LINE_MESSAGING_CHANNEL_ACCESS_TOKEN" : ""}${!token && !to ? " and " : ""}${!to ? "LINE_TEST_USER_ID" : ""} not set.\n` +
        "Flex JSON for the simulator follows.\n",
    );
    console.log(JSON.stringify(message.contents, null, 2));
    return;
  }

  const outcome = await pushToLineUser({ channelAccessToken: token, to, messages: [message] });
  console.log("\npush:", JSON.stringify(outcome, null, 2));
  if (outcome.status === "failed") {
    console.log(
      "\nIf httpStatus is 400 with 'Failed to send messages', the user has not " +
        "added this salon's official account as a friend. If 401, the token is " +
        "wrong or from a different channel.",
    );
    process.exit(1);
  }
}

main();
