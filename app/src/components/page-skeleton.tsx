/**
 * The shape of a page while its data is in flight.
 *
 * Every page here is `force-dynamic` and reads D1 across the network, so a navigation costs
 * roughly a second no matter how lean the query is. Without a Suspense boundary the browser
 * shows the *old* page for that whole second and then swaps — which reads as "changing tabs is
 * slow" even when the work is unavoidable. Rendering the frame immediately makes the navigation
 * feel like it happened, because it did: only the rows are still coming.
 *
 * Deliberately a grey approximation of the real layout rather than a spinner, so nothing jumps
 * when the content lands.
 */
export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-6">
        <div className="h-6 w-40 rounded bg-surface-2" />
        <div className="mt-2 h-3 w-64 rounded bg-surface-2/70" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="rounded-card border border-line bg-surface/60 px-4 py-3.5"
          >
            <div className="h-3.5 w-1/3 rounded bg-surface-2" />
            <div className="mt-2 h-3 w-1/4 rounded bg-surface-2/70" />
          </div>
        ))}
      </div>
    </div>
  );
}
