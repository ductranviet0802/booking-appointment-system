import { Skeleton } from "@/components/ui/Skeleton";

export default function GlobalLoading() {
  return (
    <div className="space-y-4" data-testid="global-loading-page">
      <Skeleton className="h-11 w-56" data-testid="global-loading-header-skeleton" />
      <div className="grid gap-4 md:grid-cols-3" data-testid="global-loading-grid">
        <Skeleton className="h-48 w-full" data-testid="global-loading-card-skeleton-1" />
        <Skeleton className="h-48 w-full" data-testid="global-loading-card-skeleton-2" />
        <Skeleton className="h-48 w-full" data-testid="global-loading-card-skeleton-3" />
      </div>
      <Skeleton className="h-52 w-full" data-testid="global-loading-footer-skeleton" />
    </div>
  );
}
