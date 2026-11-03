/** The shape POST /api/admin/settings returns. */
export type Settings = {
  /** Asia/Taipei calendar date, from the server — the form never trusts the device clock. */
  today: string;
  services: {
    id: string;
    name: string;
    description: string;
    durationMinutes: number;
    priceTwd: number;
    isActive: boolean;
    upcomingCount: number;
  }[];
  staff: {
    id: string;
    name: string;
    title: string;
    isActive: boolean;
    upcomingCount: number;
  }[];
  /** Asia/Taipei wall clock, "HH:mm". */
  hours: { weekday: number; opensAt: string; closesAt: string }[];
  closedDates: string[];
  profile: {
    address: string;
    phone: string;
    mapsUrl: string;
    instagramUrl: string;
    websiteUrl: string;
    cancellationCutoffMinutes: number;
  };
};

export type ApiResult = { ok: boolean; status: number; data: Record<string, unknown> };

export type AdminApi = (path: string, payload: Record<string, unknown>) => Promise<ApiResult>;

export type OnSaved = (data: Record<string, unknown>) => Promise<void>;
