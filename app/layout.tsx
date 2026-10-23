import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { MaintenanceScreen } from "@/components/frame/Maintenance";
import { getMaintenanceEnd, getViewer } from "@/lib/frame/data";

export const metadata: Metadata = {
  title: "Web予約",
};

// Language (F13-01) and ER-04: while the maintenance period is on, the page is replaced by the maintenance screen.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { lang } = await getViewer();
  const maintenanceEnd = await getMaintenanceEnd();
  return (
    <html lang={lang} className="h-full antialiased">
      <body suppressHydrationWarning>
        <ToastProvider lang={lang}>
          {maintenanceEnd ? <MaintenanceScreen end={maintenanceEnd} lang={lang} /> : children}
        </ToastProvider>
      </body>
    </html>
  );
}
