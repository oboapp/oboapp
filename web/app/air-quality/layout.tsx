// Leaflet's global CSS must be imported at layout (route-segment) scope in
// Next.js — importing it inside a component file is not supported.
import "leaflet/dist/leaflet.css";

interface Props {
  children: React.ReactNode;
}

export default function AirQualityLayout({ children }: Props) {
  return <>{children}</>;
}
