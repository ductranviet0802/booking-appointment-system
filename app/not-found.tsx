import Link from "next/link";

export default function NotFound() {
  return (
    <div
      className="surface-card animate-fade-up mx-auto max-w-xl space-y-4 rounded-3xl border border-zinc-200/80 p-8 text-center"
      data-testid="not-found-page"
    >
      <h1 className="text-3xl font-black text-zinc-900" data-testid="not-found-title">
        404
      </h1>
      <p className="text-zinc-600" data-testid="not-found-message">
        Trang bạn tìm không tồn tại.
      </p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-xl bg-gradient-to-r from-sky-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:brightness-105"
        data-testid="not-found-home-link"
      >
        Về trang chủ
      </Link>
    </div>
  );
}
