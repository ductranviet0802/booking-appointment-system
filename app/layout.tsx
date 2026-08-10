import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "@/components/AppProviders";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Booking Appointment System",
  description: "Ứng dụng đặt lịch khám bệnh trực tuyến",
  openGraph: {
    title: "Booking Appointment System",
    description: "Đặt lịch khám nhanh chóng với bác sĩ phù hợp.",
    type: "website",
    locale: "vi_VN",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html data-testid="app-html" lang="vi" className="h-full antialiased">
      <body data-testid="app-body" suppressHydrationWarning className="min-h-full text-zinc-900">
        <AppProviders>
          <div data-testid="app-shell" className="flex min-h-screen flex-col">
            <Navbar />
            <main data-testid="app-main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-6">
              {children}
            </main>
            <Footer />
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
