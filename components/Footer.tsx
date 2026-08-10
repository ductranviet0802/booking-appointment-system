export function Footer() {
  return (
    <footer
      data-testid="footer-root"
      className="mt-20 border-t border-zinc-200/70 bg-white/70 backdrop-blur"
    >
      <div
        data-testid="footer-content"
        className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-zinc-600 md:px-6"
      >
        <p data-testid="footer-title" className="font-semibold text-zinc-700">
          Booking Appointment System
        </p>
        <p data-testid="footer-subtitle">Built with Next.js + PostgreSQL by IVS.HCM</p>
      </div>
    </footer>
  );
}
