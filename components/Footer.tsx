export function Footer() {
  return (
    <footer
      data-testid="footer-root"
      className="mt-20 border-t border-sky-100/80 bg-[#0f1c2e] text-white"
    >
      <div
        data-testid="footer-content"
        className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-8 text-sm text-sky-100 md:px-6"
      >
        <p data-testid="footer-title" className="font-semibold text-white">
          Booking Appointment System
        </p>
        <p data-testid="footer-subtitle">Built with Next.js + PostgreSQL by IVS.HCM</p>
      </div>
    </footer>
  );
}
