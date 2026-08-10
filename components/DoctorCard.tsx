import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export type DoctorCardData = {
  id: string;
  name: string;
  specialty: { name: string };
  experience: number;
  rating: number;
  fee: number;
  hospital: { name: string };
  location?: { city?: string } | null;
};

export function DoctorCard({ doctor }: { doctor: DoctorCardData }) {
  const cardTestId = `doctor-card-${doctor.id}`;

  return (
    <Card data-testid={cardTestId} className="animate-fade-up flex h-full flex-col justify-between gap-4">
      <div data-testid={`${cardTestId}-content`} className="space-y-2">
        <h3 data-testid={`${cardTestId}-name`} className="text-lg font-bold text-zinc-900">
          {doctor.name}
        </h3>
        <p data-testid={`${cardTestId}-specialty`} className="text-sm text-zinc-600">
          {doctor.specialty.name}
        </p>
        <div data-testid={`${cardTestId}-meta`} className="flex flex-wrap gap-2">
          <Badge data-testid={`${cardTestId}-experience`}>{`${doctor.experience} năm KN`}</Badge>
          <Badge data-testid={`${cardTestId}-rating`} tone="success">{`⭐ ${doctor.rating.toFixed(1)}`}</Badge>
          <Badge data-testid={`${cardTestId}-fee`}>{`${doctor.fee.toLocaleString("vi-VN")}đ`}</Badge>
        </div>
        <p data-testid={`${cardTestId}-hospital`} className="text-sm text-zinc-600">
          {doctor.hospital.name}
        </p>
        {doctor.location?.city ? (
          <p data-testid={`${cardTestId}-city`} className="text-sm text-zinc-500">
            {doctor.location.city}
          </p>
        ) : null}
      </div>

      <Link
        href={`/doctors/${doctor.id}`}
        prefetch={false}
        data-testid={`${cardTestId}-detail-link`}
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:brightness-105"
      >
        Xem chi tiết
      </Link>
    </Card>
  );
}
