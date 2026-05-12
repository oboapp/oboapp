import Link from "next/link";

interface ReportPageUnavailableProps {
  readonly title: string;
  readonly message: string;
  readonly backHref: string;
  readonly backLabel: string;
}

export default function ReportPageUnavailable({
  title,
  message,
  backHref,
  backLabel,
}: ReportPageUnavailableProps) {
  return (
    <div className="min-h-screen bg-neutral-light">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-6">
          <Link
            href={backHref}
            className="text-primary hover:text-primary-hover inline-flex items-center gap-2"
          >
            <span>←</span>
            <span>{backLabel}</span>
          </Link>
        </div>
        <div className="bg-white rounded-lg shadow-md p-6 border border-neutral-border">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
            {title}
          </h1>
          <p className="text-sm text-neutral">{message}</p>
        </div>
      </div>
    </div>
  );
}
