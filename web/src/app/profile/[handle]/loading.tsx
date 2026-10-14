import { SkeletonBlock, SkeletonLine, SkeletonStats } from "@/components/Skeleton";

export default function Loading() {
  return (
    <>
      <section className="row" style={{ gap: "0.9rem", alignItems: "center" }}>
        <span className="skeleton" style={{ width: 44, height: 44, borderRadius: "50%" }} />
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <SkeletonLine width="9rem" height="1.3rem" />
          <SkeletonLine width="6rem" height="0.75rem" />
        </div>
      </section>
      <SkeletonStats />
      <SkeletonBlock rows={5} />
      <SkeletonBlock rows={4} />
    </>
  );
}
