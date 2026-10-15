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
    <Card data-testid={cardTestId} className="animate-fade-up flex h-full flex-col justify-between gap-5 border-sky-100 bg-white/95">
      <div className="flex items-start gap-3">
        <div aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-lg font-bold text-sky-700">
          {doctor.name.replace(/^\S+\s*/, "").charAt(0) || doctor.name.charAt(0)}
        </div>
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
      </div>

      <Link
        href={`/doctors/${doctor.id}`}
        prefetch={false}
        data-testid={`${cardTestId}-detail-link`}
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-r from-sky-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:brightness-105"
      >
        Xem chi tiết
      </Link>
    </Card>
  );
}
