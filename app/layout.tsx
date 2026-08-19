import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "dstat — Edge traffic cockpit",
  description: "Self-hosted L4/L7 traffic testing and real-time edge telemetry.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
