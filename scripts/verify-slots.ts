import { demoTenant } from "@config/tenants/demo";
import { ANY_STAFF, buildDateOptions, generateSlots } from "@/lib/booking/slots";
import { weekdayOf } from "@/lib/time/taipei";

const NOW = new Date("2026-08-28T12:00:00+08:00");
const show = (s: { start: string; isAvailable: boolean; reason?: string }[]) =>
  s.map((x) => (x.isAvailable ? x.start : `[${x.start}:${x.reason}]`)).join(" ");

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
}

const days = buildDateOptions(demoTenant, NOW);
console.log("=== date window ===");
console.log(days.map((d) => `${d.date}(w${weekdayOf(d.date)})${d.isOpen ? "" : "-CLOSED"}`).join(" "));
check("window length is 14", days.length, 14);
check("starts today", days[0].date, "2026-08-28");
check("today flagged", days[0].isToday, true);

const monday = days.find((d) => weekdayOf(d.date) === 1)!;
check("Monday is closed (weekly day off)", monday.isOpen, false);
const holiday = days.find((d) => d.date === "2026-09-03")!;
check("2026-09-03 closed (one-off closedDates)", holiday.isOpen, false);

console.log("\n=== today, 60min cut, any staff (now=12:00, lead=60m) ===");
const today = generateSlots({ tenant: demoTenant, date: "2026-08-28", serviceId: "cut", staffId: ANY_STAFF, now: NOW });
console.log(show(today));
check("10:00 today is past", today.find((s) => s.start === "10:00")?.reason, "past");
check("12:30 blocked by lead time", today.find((s) => s.start === "12:30")?.reason, "past");
check("13:00 all three staff booked", today.find((s) => s.start === "13:00")?.reason, "booked");
// 13:30-14:30 still collides with all three (yuki runs to 15:30, lin/chen to 14:00).
check("13:30 still fully booked", today.find((s) => s.start === "13:30")?.reason, "booked");
// 14:00-15:00 is free for lin and chen even though yuki is busy -> "any" succeeds.
check("14:00 free once lin/chen finish", today.find((s) => s.start === "14:00")?.isAvailable, true);

console.log("\n=== today, 60min cut, staff=yuki only ===");
const yuki = generateSlots({ tenant: demoTenant, date: "2026-08-28", serviceId: "cut", staffId: "yuki", now: NOW });
console.log(show(yuki));
check("yuki booked 16:00", yuki.find((s) => s.start === "16:00")?.reason, "booked");
// yuki's 13:00 booking runs to 15:30, and a second starts at 16:00.
check("yuki busy 15:00 (inside 150min booking)", yuki.find((s) => s.start === "15:00")?.reason, "booked");
check("yuki free 17:00", yuki.find((s) => s.start === "17:00")?.isAvailable, true);

console.log("\n=== Thursday 2026-09-03 is closed; use next Thursday for the break test ===");
const thursday = days.find((d) => weekdayOf(d.date) === 4 && d.isOpen)!;
const thu = generateSlots({ tenant: demoTenant, date: thursday.date, serviceId: "cut", staffId: ANY_STAFF, now: NOW });
console.log(`${thursday.date}: ${show(thu)}`);
check("no 14:00 start (lunch break)", thu.some((s) => s.start === "14:00"), false);
check("13:00 exists (ends exactly at 14:00)", thu.some((s) => s.start === "13:00"), true);
check("15:00 resumes after break", thu.some((s) => s.start === "15:00"), true);

console.log("\n=== 180min perm on a Sunday (10:00-18:00) ===");
const sunday = days.find((d) => weekdayOf(d.date) === 0 && d.isOpen)!;
const perm = generateSlots({ tenant: demoTenant, date: sunday.date, serviceId: "perm", staffId: ANY_STAFF, now: NOW });
console.log(`${sunday.date}: ${show(perm)}`);
check("last perm slot is 15:00 (ends 18:00)", perm.at(-1)?.start, "15:00");
check("perm grid still steps by 30min", perm.slice(0, 3).map((s) => s.start), ["10:00", "10:30", "11:00"]);

console.log("\n=== closed day yields no slots ===");
check("Monday returns []", generateSlots({ tenant: demoTenant, date: monday.date, serviceId: "cut", staffId: ANY_STAFF, now: NOW }).length, 0);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
