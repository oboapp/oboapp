import type { Timespan } from "@/lib/types";

interface TimespanListProps {
  timespans: Timespan[];
  keyPrefix: string;
}

export default function TimespanList({
  timespans,
  keyPrefix,
}: TimespanListProps) {
  if (!timespans || timespans.length === 0) return null;

  return (
    <div className="text-sm text-neutral space-y-1">
      {timespans.map((timespan, index) => (
        <div key={`${keyPrefix}-${timespan.start}-${timespan.end}-${index}`}>
          {timespan.start} - {timespan.end}
        </div>
      ))}
    </div>
  );
}
