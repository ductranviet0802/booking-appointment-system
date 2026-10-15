"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DoctorCard, type DoctorCardData } from "@/components/DoctorCard";
import { FilterSidebar } from "@/components/FilterSidebar";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiGet } from "@/lib/client-api";
const IS_DEV = process.env.NODE_ENV !== "production";

type DoctorsResponse = {
  doctors: DoctorCardData[];
  total: number;
  page: number;
  totalPages: number;
};

type SpecialtiesResponse = {
  specialties: Array<{ id: string; name: string }>;
};

export default function DoctorsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [specialties, setSpecialties] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<DoctorsResponse>({ doctors: [], total: 0, page: 1, totalPages: 1 });
  const replaceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filters = useMemo(
    () => ({
      specialty_id: searchParams.get("specialty_id") ?? undefined,
      city: searchParams.get("city") ?? undefined,
      min_fee: searchParams.get("min_fee") ?? undefined,
      max_fee: searchParams.get("max_fee") ?? undefined,
      sort: searchParams.get("sort") ?? undefined,
    }),
    [searchParams],
  );

  useEffect(() => {
    apiGet<SpecialtiesResponse>("/api/specialties")
      .then((data) => setSpecialties(data.specialties))
      .catch(() => setSpecialties([]));
  }, []);

  useEffect(() => {
    const queryString = searchParams.toString();
    if (IS_DEV) {
      console.info("[doctors] fetch", { queryString });
    }
    setLoading(true);
    apiGet<DoctorsResponse>(`/api/doctors?${queryString}`)
      .then((data) => setResult(data))
      .catch(() => setResult({ doctors: [], total: 0, page: 1, totalPages: 1 }))
      .finally(() => setLoading(false));
  }, [searchParams]);

  const updateFilters = (next: {
    specialty_id?: string;
    city?: string;
    min_fee?: string;
    max_fee?: string;
    sort?: string;
  }) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(next).forEach(([key, value]) => {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });

    params.set("page", "1");
    const nextPath = `/doctors?${params.toString()}`;
    const currentPath = `/doctors?${searchParams.toString()}`;

    if (nextPath === currentPath) {
      return;
    }

    setLoading(true);
    if (replaceTimeoutRef.current) {
      clearTimeout(replaceTimeoutRef.current);
    }

    replaceTimeoutRef.current = setTimeout(() => {
      router.replace(nextPath);
      replaceTimeoutRef.current = null;
    }, 250);
  };

  useEffect(() => {
    return () => {
      if (replaceTimeoutRef.current) {
        clearTimeout(replaceTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div data-testid="doctors-page" className="space-y-5">
      <div data-testid="doctors-page-header" className="animate-fade-up">
        <h1 data-testid="doctors-page-title" className="text-3xl font-black text-zinc-900">
          Danh sách bác sĩ
        </h1>
        <p data-testid="doctors-page-description" className="text-zinc-600">
          Lọc theo chuyên khoa, thành phố và mức phí phù hợp.
        </p>
      </div>

      <div data-testid="doctors-page-content" className="grid gap-6 lg:grid-cols-[270px_1fr]">
        <div data-testid="doctors-page-sidebar" className="animate-fade-up" style={{ animationDelay: "50ms" }}>
          <FilterSidebar specialties={specialties} value={filters} onChange={updateFilters} />
        </div>

        <div data-testid="doctors-page-results" className="space-y-3">
          {loading ? (
            <div data-testid="doctors-page-loading" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} data-testid={`doctors-page-loading-skeleton-${index}`} className="h-56" />
              ))}
            </div>
          ) : result.doctors.length === 0 ? (
            <div
              data-testid="doctors-page-empty-state"
              className="surface-card animate-fade-up rounded-3xl border border-zinc-200/80 p-8 text-center text-zinc-600"
            >
              Không tìm thấy bác sĩ
            </div>
          ) : (
            <>
              <p data-testid="doctors-page-summary" className="text-sm text-zinc-500">
                Tìm thấy {result.total} bác sĩ - trang {result.page}/{result.totalPages}
              </p>
              <div data-testid="doctors-page-grid" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {result.doctors.map((doctor, index) => (
                  <div
                    key={doctor.id}
                    data-testid={`doctors-page-item-${doctor.id}`}
                    className="animate-fade-up"
                    style={{ animationDelay: `${index * 35}ms` }}
                  >
                    <DoctorCard doctor={doctor} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
