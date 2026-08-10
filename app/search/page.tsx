"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiGet } from "@/lib/client-api";
const IS_DEV = process.env.NODE_ENV !== "production";

type SearchResult = {
  id: string;
  name: string;
  specialty: string;
  hospital: string;
  rating: number;
  fee: number;
};

export default function SearchPage() {
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  const onSearch = async () => {
    const trimmedKeyword = keyword.trim();
    setHasSearched(true);
    setLoading(true);

    try {
      if (IS_DEV) {
        console.info("[search] fetch", { keyword: trimmedKeyword });
      }
      const data = await apiGet<{ doctors: SearchResult[] }>(`/api/search?q=${encodeURIComponent(trimmedKeyword)}`);
      setResults(data.doctors);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="search-page" className="space-y-5">
      <h1 data-testid="search-page-title" className="animate-fade-up text-3xl font-black text-zinc-900">
        Tìm kiếm bác sĩ
      </h1>

      <Card data-testid="search-form-card" className="animate-fade-up space-y-3" style={{ animationDelay: "50ms" }}>
        <div data-testid="search-form-row" className="flex flex-col gap-2 sm:flex-row">
          <Input
            data-testid="search-input"
            value={keyword}
            placeholder="Nhập tên bác sĩ, chuyên khoa hoặc bệnh viện"
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void onSearch();
              }
            }}
          />
          <Button data-testid="search-submit-button" loading={loading} onClick={onSearch}>
            Tìm
          </Button>
        </div>
      </Card>

      <div data-testid="search-results" className="space-y-3">
        {loading ? (
          <div data-testid="search-loading" className="grid gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} data-testid={`search-loading-skeleton-${index}`} className="h-24 w-full" />
            ))}
          </div>
        ) : null}

        {!loading &&
          results.map((doctor, index) => (
            <Card
              key={doctor.id}
              data-testid={`search-result-card-${doctor.id}`}
              className="animate-fade-up flex items-center justify-between gap-4"
              style={{ animationDelay: `${index * 35}ms` }}
            >
              <div data-testid={`search-result-info-${doctor.id}`}>
                <h2 data-testid={`search-result-name-${doctor.id}`} className="text-lg font-bold">
                  {doctor.name}
                </h2>
                <p data-testid={`search-result-specialty-${doctor.id}`} className="text-sm text-zinc-600">
                  {doctor.specialty}
                </p>
                <p data-testid={`search-result-hospital-${doctor.id}`} className="text-sm text-zinc-600">
                  {doctor.hospital}
                </p>
              </div>
              <div data-testid={`search-result-meta-${doctor.id}`} className="text-right">
                <p data-testid={`search-result-rating-${doctor.id}`} className="text-sm text-zinc-600">
                  ⭐ {doctor.rating.toFixed(1)}
                </p>
                <p data-testid={`search-result-fee-${doctor.id}`} className="text-sm font-semibold text-zinc-900">
                  {doctor.fee.toLocaleString("vi-VN")}đ
                </p>
                <Link
                  data-testid={`search-result-link-${doctor.id}`}
                  href={`/doctors/${doctor.id}`}
                  prefetch={false}
                  className="text-sm font-semibold text-teal-700"
                >
                  Xem
                </Link>
              </div>
            </Card>
          ))}

        {!loading && results.length === 0 ? (
          <div data-testid="search-empty-state" className="surface-card rounded-3xl border border-zinc-200/80 p-8 text-center text-zinc-600">
            {hasSearched ? "Không có kết quả phù hợp." : "Nhập từ khóa để bắt đầu tìm kiếm."}
          </div>
        ) : null}
      </div>
    </div>
  );
}
