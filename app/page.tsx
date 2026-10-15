import Link from "next/link";
import { DoctorCard } from "@/components/DoctorCard";
import { Card } from "@/components/ui/Card";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [specialties, featuredDoctors] = await Promise.all([
    prisma.specialty.findMany({
      select: { id: true, name: true, description: true, icon: true },
      orderBy: { name: "asc" },
      take: 12,
    }),
    prisma.doctor.findMany({
      include: {
        specialty: { select: { name: true } },
        hospital: {
          select: {
            name: true,
            locations: {
              select: { city: true },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ rating: "desc" }, { experience: "desc" }],
      take: 6,
    }),
  ]);

  return (
    <div data-testid="home-page" className="space-y-16">
      <section
        data-testid="home-hero-section"
        className="surface-card-strong animate-fade-up relative overflow-hidden rounded-[2rem] px-6 py-8 md:px-12 md:py-12"
      >
        <div
          data-testid="home-hero-bg-top"
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-sky-200/50 blur-3xl"
        />
        <div
          data-testid="home-hero-bg-bottom"
          aria-hidden
          className="pointer-events-none absolute -bottom-20 left-8 h-44 w-44 rounded-full bg-emerald-200/50 blur-3xl"
        />
        <div className="home-hero-grid relative z-10">
          <div>
            <p
          data-testid="home-hero-badge"
          className="section-kicker inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1"
            >
              Dịch vụ đặt lịch trực tuyến
            </p>
            <h1 data-testid="home-hero-title" className="mt-4 max-w-3xl text-4xl font-black leading-[1.08] text-[#0f1c2e] md:text-6xl">
          Đặt lịch khám nhanh, chọn đúng bác sĩ, theo dõi lịch hẹn dễ dàng.
            </h1>
            <p data-testid="home-hero-description" className="mt-5 max-w-2xl text-base leading-7 text-slate-600 md:text-lg">
          Hệ thống giúp bạn tìm bác sĩ theo chuyên khoa, bệnh viện, khu vực và đặt lịch trực tuyến trong vài bước.
            </p>
            <div data-testid="home-hero-actions" className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/doctors"
            prefetch={false}
            data-testid="home-hero-action-find-doctors"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-r from-sky-500 to-blue-700 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-200 transition duration-200 hover:-translate-y-0.5 hover:brightness-105"
          >
            Tìm bác sĩ ngay
          </Link>
          <Link
            href="/bookings/me"
            prefetch={false}
            data-testid="home-hero-action-my-bookings"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-sky-100 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 transition duration-200 hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-50/50"
          >
            Xem lịch của tôi
          </Link>
            </div>
          </div>
        <div className="hero-illustration" aria-hidden="true">
          <svg viewBox="0 0 420 270" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="78" y="52" width="264" height="170" rx="20" fill="white" stroke="#B8DDF7" strokeWidth="3"/>
            <path d="M78 96H342" stroke="#B8DDF7" strokeWidth="3"/>
            <path d="M116 38V68M304 38V68" stroke="#0094FF" strokeWidth="10" strokeLinecap="round"/>
            <path d="M112 128H165M190 128H243M268 128H308M112 163H150M175 163H228M253 163H308M112 198H154M182 198H236" stroke="#9BCBEA" strokeWidth="10" strokeLinecap="round"/>
            <circle cx="306" cy="192" r="28" fill="#B7F0DC"/>
            <path d="m293 192 9 9 18-19" stroke="#087B5A" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        </div>
      </section>

      <section data-testid="home-specialties-section" className="space-y-4">
        <div data-testid="home-specialties-header" className="flex items-end justify-between">
          <h2 data-testid="home-specialties-title" className="text-2xl font-black text-zinc-900">
            Chuyên khoa nổi bật
          </h2>
          <Link
            data-testid="home-specialties-view-all"
            href="/doctors"
            prefetch={false}
            className="text-sm font-semibold text-sky-700 hover:text-sky-800"
          >
            Xem tất cả
          </Link>
        </div>
        <div data-testid="home-specialties-grid" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {specialties.slice(0, 8).map((specialty, index) => (
            <Link
              key={specialty.id}
              href={`/doctors?specialty_id=${specialty.id}`}
              prefetch={false}
              data-testid={`home-specialty-item-${specialty.id}`}
              className="animate-fade-up"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <Card data-testid={`home-specialty-card-${specialty.id}`} className="h-full space-y-2 hover:-translate-y-0.5 hover:border-sky-300">
                <p data-testid={`home-specialty-name-${specialty.id}`} className="text-lg font-bold text-zinc-900">
                  {specialty.name}
                </p>
                <p data-testid={`home-specialty-description-${specialty.id}`} className="text-sm text-zinc-600">
                  {specialty.description}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section data-testid="home-featured-doctors-section" className="space-y-4">
        <h2 data-testid="home-featured-doctors-title" className="text-2xl font-black text-zinc-900">
          Bác sĩ được đánh giá cao
        </h2>
        <div data-testid="home-featured-doctors-grid" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {featuredDoctors.map((doctor, index) => (
            <div
              key={doctor.id}
              data-testid={`home-featured-doctor-item-${doctor.id}`}
              className="animate-fade-up"
              style={{ animationDelay: `${120 + index * 45}ms` }}
            >
              <DoctorCard
                doctor={{
                  id: doctor.id,
                  name: doctor.name,
                  specialty: { name: doctor.specialty.name },
                  experience: doctor.experience,
                  rating: Number(doctor.rating),
                  fee: doctor.fee,
                  hospital: { name: doctor.hospital.name },
                  location: doctor.hospital.locations[0] ? { city: doctor.hospital.locations[0].city } : null,
                }}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
