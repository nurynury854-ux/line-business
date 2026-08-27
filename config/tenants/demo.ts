import type { TenantConfig } from "./types";

/**
 * Demo salon. A second salon is a sibling file with the same shape — nothing in
 * src/ should need editing to support it.
 */
export const demoTenant: TenantConfig = {
  id: "demo",
  name: "沐光髮藝",
  logoUrl: "/tenants/demo/logo.svg",

  brand: {
    primary: "#1f5f4e",
    onPrimary: "#ffffff",
    accent: "#c9a227",
  },

  services: [
    {
      id: "cut",
      name: "洗剪吹",
      description: "洗髮、剪髮與吹整造型",
      durationMinutes: 60,
      priceTwd: 800,
    },
    {
      id: "scalp",
      name: "頭皮養護",
      description: "深層清潔與頭皮按摩",
      durationMinutes: 45,
      priceTwd: 1200,
    },
    {
      id: "treatment",
      name: "護髮療程",
      description: "結構式深層護髮",
      durationMinutes: 60,
      priceTwd: 1500,
    },
    {
      id: "color",
      name: "染髮",
      description: "全頭染色，含護色護髮",
      durationMinutes: 150,
      priceTwd: 3200,
    },
    {
      id: "perm",
      name: "燙髮",
      description: "溫塑燙或冷燙，含造型",
      durationMinutes: 180,
      priceTwd: 4500,
    },
  ],

  staff: [
    { id: "yuki", name: "小雨", title: "總監" },
    { id: "lin", name: "林設計師", title: "資深設計師" },
    { id: "chen", name: "陳設計師", title: "設計師" },
  ],

  // Monday is the weekly day off. Thursday closes for lunch, which is why a day
  // is a list of spans rather than a single open/close pair.
  businessHours: {
    0: [{ start: "10:00", end: "18:00" }],
    1: [],
    2: [{ start: "10:00", end: "20:00" }],
    3: [{ start: "10:00", end: "20:00" }],
    4: [
      { start: "10:00", end: "14:00" },
      { start: "15:00", end: "20:00" },
    ],
    5: [{ start: "10:00", end: "20:00" }],
    6: [{ start: "10:00", end: "18:00" }],
  },

  closedDates: ["2026-09-03"],

  booking: {
    slotIntervalMinutes: 30,
    minimumLeadTimeMinutes: 60,
    windowDays: 14,
  },

  // MOCK DATA — stands in for rows Supabase will own, so the disabled slot
  // state is visible before there is a backend. These are fixed dates and will
  // go stale; refresh them while developing, and delete the whole field once
  // bookings are read from the database.
  bookedSlots: [
    { date: "2026-08-28", start: "13:00", durationMinutes: 150, staffId: "yuki" },
    { date: "2026-08-28", start: "13:00", durationMinutes: 60, staffId: "lin" },
    { date: "2026-08-28", start: "13:00", durationMinutes: 60, staffId: "chen" },
    { date: "2026-08-28", start: "16:00", durationMinutes: 60, staffId: "yuki" },
    { date: "2026-08-29", start: "10:00", durationMinutes: 180, staffId: "yuki" },
    { date: "2026-08-29", start: "11:00", durationMinutes: 60, staffId: "lin" },
    { date: "2026-08-30", start: "14:00", durationMinutes: 150, staffId: "chen" },
    { date: "2026-08-30", start: "14:30", durationMinutes: 60, staffId: "lin" },
  ],
};
