/** List skeleton (_common §3.1 Loading): grey shapes in place of content that is still loading */
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`sk ${className}`.trim()} style={style} aria-hidden="true" />;
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="box" role="status" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} style={{ height: 18, width: i === 0 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}
