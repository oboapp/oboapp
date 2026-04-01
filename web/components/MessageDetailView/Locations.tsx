import type {
  Pin,
  StreetSection,
  CadastralProperty,
  Address,
} from "@/lib/types";
import DetailItem from "./DetailItem";
import TimespanList from "./TimespanList";

interface LocationsProps {
  pins?: Pin[] | null;
  streets?: StreetSection[] | null;
  busStops?: string[] | null;
  cadastralProperties?: CadastralProperty[] | null;
  addresses?: Address[] | null;
  onLocationClick?: (lat: number, lng: number) => void;
}

// Find matching address for a text by matching against addresses
function findMatchingAddress(
  text: string,
  addresses: Address[] | null | undefined,
): Address | null {
  if (!addresses) return null;
  const normalized = text.toLowerCase().trim();
  return (
    addresses.find(
      (addr) => addr.originalText.toLowerCase().trim() === normalized,
    ) ?? null
  );
}

// Find matching address for a bus stop code/name.
// Bus stops may be stored as raw codes (e.g. "0529") while geocoded
// addresses use "Спирка 0529" as originalText, so we try both forms.
function findBusStopAddress(
  busStop: string,
  addresses: Address[] | null | undefined,
): Address | null {
  return (
    findMatchingAddress(busStop, addresses) ??
    findMatchingAddress(`Спирка ${busStop}`, addresses)
  );
}

// Find coordinates for a text by matching against addresses
function findCoordinates(
  text: string,
  addresses: Address[] | null | undefined,
): { lat: number; lng: number } | null {
  return findMatchingAddress(text, addresses)?.coordinates ?? null;
}

interface ClickableCardProps {
  children: React.ReactNode;
  onClick?: () => void;
}

function ClickableCard({ children, onClick }: ClickableCardProps) {
  const baseClasses =
    "w-full text-left bg-neutral-light rounded-md p-3 border border-neutral-border";
  const interactiveClasses = onClick
    ? "hover:bg-info-light hover:border-info-border transition-colors cursor-pointer"
    : "";

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClasses} ${interactiveClasses}`}
      >
        {children}
      </button>
    );
  }

  return <div className={baseClasses}>{children}</div>;
}

export default function Locations({
  pins,
  streets,
  busStops,
  cadastralProperties,
  addresses,
  onLocationClick,
}: LocationsProps) {
  const handleClick = (text: string) => {
    if (!onLocationClick) return;
    const coords = findCoordinates(text, addresses);
    if (coords) {
      onLocationClick(coords.lat, coords.lng);
      // Scroll to bring the map into view (especially on mobile)
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleClickCoords = (lat: number, lng: number) => {
    if (!onLocationClick) return;
    onLocationClick(lat, lng);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      {pins && pins.length > 0 && (
        <DetailItem title="Локации">
          <div className="space-y-3">
            {pins.map((pin, index) => {
              const coords =
                findCoordinates(pin.address, addresses) ?? pin.coordinates;
              return (
                <ClickableCard
                  key={`pin-${pin.address}-${index}`}
                  onClick={
                    coords && onLocationClick
                      ? () => handleClickCoords(coords.lat, coords.lng)
                      : undefined
                  }
                >
                  <p className="text-sm font-medium text-foreground mb-1">
                    {pin.address}
                  </p>
                  <TimespanList
                    timespans={pin.timespans ?? []}
                    keyPrefix={`pin-${index}`}
                  />
                </ClickableCard>
              );
            })}
          </div>
        </DetailItem>
      )}

      {streets && streets.length > 0 && (
        <DetailItem title="Улични участъци">
          <div className="space-y-3">
            {streets.map((street, index) => {
              const fromCoords = findCoordinates(street.from, addresses);
              const toCoords = findCoordinates(street.to, addresses);
              // Click navigates to "from" endpoint if available
              const clickCoords = fromCoords ?? toCoords;
              return (
                <ClickableCard
                  key={`street-${street.street}-${street.from}-${street.to}-${index}`}
                  onClick={
                    clickCoords && onLocationClick
                      ? () => handleClick(fromCoords ? street.from : street.to)
                      : undefined
                  }
                >
                  <p className="text-sm font-medium text-foreground mb-1">
                    {street.street}
                  </p>
                  <p className="text-xs text-neutral mb-1">
                    От: {street.from} → До: {street.to}
                  </p>
                  <TimespanList
                    timespans={street.timespans ?? []}
                    keyPrefix={`street-${index}`}
                  />
                </ClickableCard>
              );
            })}
          </div>
        </DetailItem>
      )}

      {busStops && busStops.length > 0 && (
        <DetailItem title="Спирки">
          <div className="space-y-2">
            {busStops.map((busStop, index) => {
              const matchedAddress = findBusStopAddress(busStop, addresses);
              const coords = matchedAddress?.coordinates ?? null;
              const displayName = matchedAddress?.formattedAddress ?? busStop;
              return (
                <ClickableCard
                  key={`busstop-${busStop}-${index}`}
                  onClick={
                    coords && onLocationClick
                      ? () => handleClickCoords(coords.lat, coords.lng)
                      : undefined
                  }
                >
                  <p className="text-sm font-medium text-foreground">
                    {displayName}
                  </p>
                </ClickableCard>
              );
            })}
          </div>
        </DetailItem>
      )}

      {cadastralProperties && cadastralProperties.length > 0 && (
        <DetailItem title="Кадастрални имоти">
          <div className="space-y-3">
            {cadastralProperties.map((prop, index) => (
              <ClickableCard key={`cadastral-${prop.identifier}-${index}`}>
                <p className="text-sm font-medium text-foreground mb-1">
                  {prop.identifier}
                </p>
                <TimespanList
                  timespans={prop.timespans ?? []}
                  keyPrefix={`cadastral-${index}`}
                />
              </ClickableCard>
            ))}
          </div>
        </DetailItem>
      )}
    </>
  );
}
