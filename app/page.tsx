import Link from "next/link";
import { DoctorCard } from "@/components/DoctorCard";
import { Card } from "@/components/ui/Card";
import { prisma } from "@/lib/prisma";

export const revalidate = 3600;

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
    <div data-testid="home-page" className="space-y-12">
      <section
        data-testid="home-hero-section"
        className="surface-card-strong animate-fade-up relative overflow-hidden rounded-[2rem] px-6 py-12 md:px-12"
      >
        <div
          data-testid="home-hero-bg-top"
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan-200/50 blur-3xl"
        />
        <div
          data-testid="home-hero-bg-bottom"
          aria-hidden
          className="pointer-events-none absolute -bottom-20 left-8 h-44 w-44 rounded-full bg-teal-200/50 blur-3xl"
        />
        <p
          data-testid="home-hero-badge"
          className="inline-flex rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-teal-700"
        >
          Dịch vụ đặt lịch trực tuyến
        </p>
        <h1 data-testid="home-hero-title" className="mt-4 max-w-3xl text-3xl font-black leading-tight text-zinc-900 md:text-5xl">
          Đặt lịch khám nhanh, chọn đúng bác sĩ, theo dõi lịch hẹn dễ dàng.
        </h1>
        <p data-testid="home-hero-description" className="mt-4 max-w-2xl text-base text-zinc-700 md:text-lg">
          Hệ thống giúp bạn tìm bác sĩ theo chuyên khoa, bệnh viện, khu vực và đặt lịch trực tuyến trong vài bước.
        </p>
        <div data-testid="home-hero-actions" className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/doctors"
            prefetch={false}
            data-testid="home-hero-action-find-doctors"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:brightness-105"
          >
            Tìm bác sĩ ngay
          </Link>
          <Link
            href="/bookings/me"
            prefetch={false}
            data-testid="home-hero-action-my-bookings"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 transition duration-200 hover:-translate-y-0.5 hover:border-teal-300 hover:bg-teal-50/50"
          >
            Xem lịch của tôi
          </Link>
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
            className="text-sm font-semibold text-teal-700 hover:text-teal-800"
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
              <Card data-testid={`home-specialty-card-${specialty.id}`} className="h-full space-y-2 hover:-translate-y-0.5 hover:border-teal-300">
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
