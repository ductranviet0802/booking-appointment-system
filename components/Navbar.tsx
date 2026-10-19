"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";

const links = [
  { href: "/", label: "Trang chủ" },
  { href: "/doctors", label: "Bác sĩ" },
  { href: "/search", label: "Tìm kiếm" },
];

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, bookingCount, logout } = useAuth();
  const { pushToast } = useToast();

  const onLogout = async () => {
    await logout();
    pushToast("Đăng xuất thành công");
    router.push("/");
  };

  return (
    <header
      data-testid="navbar-root"
      className="sticky top-0 z-40 border-b border-sky-100/80 bg-white/90 backdrop-blur-xl"
    >
      <div
        data-testid="navbar-content"
        className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center justify-between gap-y-2 px-4 py-2 md:px-6"
      >
        <div data-testid="navbar-left" className="flex min-w-0 items-center gap-4 sm:gap-8">
          <Link
            href="/"
            prefetch={false}
            data-testid="navbar-brand"
            className="bg-gradient-to-r from-sky-500 to-blue-700 bg-clip-text text-lg font-black tracking-tight text-transparent"
          >
            BookingCare
          </Link>

          <nav data-testid="navbar-nav" className="flex flex-wrap items-center gap-1 sm:gap-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                prefetch={false}
                data-testid={`navbar-link-${link.href === "/" ? "home" : link.href.replace("/", "")}`}
                className={cn(
                  "rounded-full px-2.5 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-sky-50 hover:text-slate-900 sm:px-3 sm:text-sm",
                  pathname === link.href && "bg-sky-50 text-sky-700",
                )}
              >
                {link.label}
              </Link>
            ))}

            {user ? (
              <Link
                href="/bookings/me"
                prefetch={false}
                data-testid="navbar-link-my-bookings"
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900",
                  pathname.startsWith("/bookings") && "bg-sky-50 text-sky-700",
                )}
              >
                Lịch của tôi
              </Link>
            ) : null}
          </nav>
        </div>

        <div data-testid="navbar-right" className="flex flex-wrap items-center justify-end gap-2">
          {user ? (
            <>
              <Badge data-testid="navbar-user-name" tone="success">
                {user.name}
              </Badge>
              <Badge data-testid="navbar-upcoming-count">{`Sắp tới: ${bookingCount}`}</Badge>
              <Button data-testid="navbar-logout-button" variant="ghost" onClick={onLogout}>
                Đăng xuất
              </Button>
            </>
          ) : (
            <>
              <Link data-testid="navbar-login-link" href="/auth/login" prefetch={false}>
                <Button data-testid="navbar-login-button" variant="ghost" disabled={loading}>
                  Đăng nhập
                </Button>
              </Link>
              <Link data-testid="navbar-register-link" href="/auth/register" prefetch={false}>
                <Button data-testid="navbar-register-button" disabled={loading}>
                  Đăng ký
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
