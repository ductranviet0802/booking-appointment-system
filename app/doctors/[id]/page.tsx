import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DoctorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const doctor = await prisma.doctor.findUnique({
    where: { id },
    include: {
      specialty: true,
      hospital: {
        include: {
          locations: true,
        },
      },
    },
  });

  if (!doctor) {
    notFound();
  }

  return (
    <div data-testid="doctor-detail-page" className="space-y-6">
      <Card data-testid={`doctor-detail-card-${doctor.id}`} className="animate-fade-up space-y-4">
        <div data-testid="doctor-detail-header" className="flex flex-wrap items-start justify-between gap-4">
          <div data-testid="doctor-detail-info">
            <h1 data-testid="doctor-detail-name" className="text-3xl font-black text-zinc-900">
              {doctor.name}
            </h1>
            <p data-testid="doctor-detail-specialty" className="mt-1 text-zinc-600">
              {doctor.specialty.name}
            </p>
            <div data-testid="doctor-detail-badges" className="mt-3 flex flex-wrap gap-2">
              <Badge data-testid="doctor-detail-experience">{`${doctor.experience} năm kinh nghiệm`}</Badge>
              <Badge data-testid="doctor-detail-rating" tone="success">{`⭐ ${Number(doctor.rating).toFixed(1)}`}</Badge>
              <Badge data-testid="doctor-detail-fee">{`${doctor.fee.toLocaleString("vi-VN")}đ/lượt`}</Badge>
            </div>
          </div>

          <Link
            href={`/bookings/new?doctor_id=${doctor.id}`}
            prefetch={false}
            data-testid="doctor-detail-book-now-link"
            className="inline-flex min-h-11 items-center rounded-xl bg-gradient-to-r from-sky-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:brightness-105"
          >
            Đặt lịch ngay
          </Link>
        </div>

        <p data-testid="doctor-detail-description" className="text-zinc-700">
          {doctor.description}
        </p>
      </Card>

      <Card data-testid="doctor-detail-hospital-card" className="animate-fade-up space-y-3" style={{ animationDelay: "80ms" }}>
        <h2 data-testid="doctor-detail-hospital-title" className="text-xl font-bold">
          Bệnh viện công tác
        </h2>
        <p data-testid="doctor-detail-hospital-name" className="text-zinc-700">
          {doctor.hospital.name}
        </p>
        <p data-testid="doctor-detail-hospital-address" className="text-zinc-600">
          {doctor.hospital.address}
        </p>
        <p data-testid="doctor-detail-hospital-phone" className="text-zinc-600">
          {doctor.hospital.phone}
        </p>
        <div data-testid="doctor-detail-hospital-locations" className="space-y-1 text-sm text-zinc-600">
          {doctor.hospital.locations.map((location) => (
            <p key={location.id} data-testid={`doctor-detail-hospital-location-${location.id}`}>
              {`${location.address}, ${location.city}`}
            </p>
          ))}
        </div>
      </Card>
    </div>
  );
}
