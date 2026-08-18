const AnnouncementTableLoadingShell = ({ loading, children }) => (
  <div className="relative min-h-[200px]">
    {loading ? (
      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/70">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
      </div>
    ) : null}
    {children}
  </div>
);

export default AnnouncementTableLoadingShell;
