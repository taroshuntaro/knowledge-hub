export function Avatar({ name, src, className = '' }: { name: string; src?: string | null; className?: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`aspect-square shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      className={`flex aspect-square shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ${className}`}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </span>
  );
}
