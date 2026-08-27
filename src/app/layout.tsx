import type { Metadata, Viewport } from "next";
import "./globals.css";

// TODO(CLAUDE.md §5, §7): title/description are placeholders. Real values are
// tenant data resolved from config/database and localised via i18n keys —
// they must not stay hardcoded here.
export const metadata: Metadata = {
  title: "Booking",
  description: "LINE LIFF booking",
};

// viewportFit: "cover" so iOS safe-area insets are available inside the
// LINE in-app browser (CLAUDE.md §6). No maximumScale — pinch zoom stays on.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-TW">
      <body className="antialiased">{children}</body>
    </html>
  );
}
