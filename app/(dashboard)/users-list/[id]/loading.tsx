export default function UserDetailLoading() {
  return (
    <div className="animate-in fade-in duration-200">
      {/* Back button skeleton */}
      <div className="mb-4">
        <div className="h-8 w-20 bg-accent/50 rounded-lg animate-pulse" />
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-6">
        {/* Left sidebar skeleton */}
        <div className="space-y-4">
          {/* User info card */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <div className="h-5 w-32 bg-accent/50 rounded animate-pulse" />
            <div className="space-y-2">
              <div className="h-4 w-full bg-accent/30 rounded animate-pulse" />
              <div className="h-4 w-48 bg-accent/30 rounded animate-pulse" />
              <div className="h-4 w-40 bg-accent/30 rounded animate-pulse" />
              <div className="h-4 w-36 bg-accent/30 rounded animate-pulse" />
            </div>
          </div>

          {/* Membership card */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <div className="h-5 w-28 bg-accent/50 rounded animate-pulse" />
            <div className="space-y-2">
              <div className="h-4 w-full bg-accent/30 rounded animate-pulse" />
              <div className="h-4 w-44 bg-accent/30 rounded animate-pulse" />
            </div>
          </div>

          {/* Intercom card */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <div className="h-5 w-24 bg-accent/50 rounded animate-pulse" />
            <div className="h-4 w-40 bg-accent/30 rounded animate-pulse" />
          </div>
        </div>

        {/* Right content skeleton */}
        <div className="space-y-4">
          {/* Tabs */}
          <div className="flex gap-2">
            {[80, 100, 70, 90, 60].map((w, i) => (
              <div key={i} style={{ width: w }} className="h-9 bg-accent/40 rounded-lg animate-pulse" />
            ))}
          </div>

          {/* Content area */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3 border-b border-border last:border-0">
                <div className="h-4 w-32 bg-accent/30 rounded animate-pulse" />
                <div className="h-4 flex-1 bg-accent/20 rounded animate-pulse" />
                <div className="h-4 w-20 bg-accent/30 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
