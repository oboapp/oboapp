"use client";

import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import { GoogleMap, Circle } from "@react-google-maps/api";
import { Message, Interest } from "@/lib/types";
import { getLocalityBounds, getLocalityCenter } from "@/lib/bounds-utils";
import { roundCoordinate } from "@oboapp/shared";
import GeoJSONLayer from "./GeoJSONLayer";
import InterestCircles from "./InterestCircles";
import InterestTargetMode from "./InterestTargetMode";

interface MapComponentProps {
  readonly messages: Message[];
  readonly onFeatureClick?: (messageId: string) => void;
  readonly onMapReady?: (
    centerMap: (
      lat: number,
      lng: number,
      zoom?: number,
      options?: { animate?: boolean },
    ) => void,
    mapInstance: google.maps.Map | null,
  ) => void;
  readonly onBoundsChanged?: (bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
    zoom: number;
  }) => void;
  readonly interests?: Interest[];
  readonly onInterestClick?: (interest: Interest) => void;
  readonly interestsInteractive?: boolean;
  readonly targetMode?: {
    active: boolean;
    initialRadius?: number;
    editingInterestId?: string | null;
    pendingColor?: string;
    onSave: (coordinates: { lat: number; lng: number }, radius: number) => void;
    onCancel: () => void;
  };
  readonly initialCenter?: { lat: number; lng: number };
  readonly shouldTrackLocation?: boolean;
  readonly hoveredMessageId?: string | null;
  readonly selectedMessageId?: string | null;
}

// Oborishte District center coordinates
// const OBORISHTE_CENTER = {
//   lat: 42.6977,
//   lng: 23.3341,
// };

// Bounds to restrict map panning (imported from @/lib/bounds-utils)

const mapContainerStyle = {
  width: "100%",
  height: "100%",
};

// Desaturated map style
const mapStyles = [
  {
    elementType: "geometry",
    stylers: [{ saturation: -60 }],
  },
  {
    elementType: "labels.text.fill",
    stylers: [{ saturation: -40 }, { lightness: 10 }],
  },
  {
    elementType: "labels.text.stroke",
    stylers: [{ visibility: "on" }, { saturation: -100 }, { lightness: 60 }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ saturation: -100 }, { lightness: 40 }],
  },
  {
    featureType: "poi",
    elementType: "labels.icon",
    stylers: [{ saturation: -100 }, { lightness: 20 }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ saturation: -100 }, { lightness: 20 }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ saturation: -60 }, { lightness: 20 }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ saturation: -40 }, { lightness: 30 }],
  },
];

export default function MapComponent({
  messages,
  onFeatureClick,
  onMapReady,
  onBoundsChanged,
  interests = [],
  onInterestClick,
  interestsInteractive = true,
  targetMode,
  initialCenter,
  shouldTrackLocation = false,
  hoveredMessageId,
  selectedMessageId,
}: MapComponentProps) {
  // Get locality bounds and center
  const localityBounds = getLocalityBounds();
  const localityCenter = getLocalityCenter();

  const mapRef = useRef<google.maps.Map | null>(null);
  const latestCenterRef = useRef(localityCenter);
  const [currentZoom, setCurrentZoom] = useState<number>(14);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  const mapOptions: google.maps.MapOptions = useMemo(
    () => ({
      zoom: 14,
      center: initialCenter || localityCenter,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      styles: mapStyles,
      clickableIcons: false, // Disable clicking on POIs (shops, hospitals, etc.)
      restriction: {
        latLngBounds: localityBounds,
        strictBounds: true,
      },
      minZoom: 12,
      maxZoom: 18,
    }),
    [initialCenter, localityBounds, localityCenter],
  );

  const centerMap = useCallback(
    (
      lat: number,
      lng: number,
      zoom: number = 17,
      options?: { animate?: boolean },
    ) => {
      if (!mapRef.current) {
        return;
      }

      const nextCenter = { lat, lng };
      latestCenterRef.current = nextCenter;
      const gmapsCenter = new google.maps.LatLng(lat, lng);

      if (options?.animate === false) {
        mapRef.current.setCenter(gmapsCenter);
      } else {
        mapRef.current.panTo(gmapsCenter);
      }

      mapRef.current.setZoom(zoom);
    },
    [],
  );

  const onMapLoad = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;
      setMapInstance(map);
      // Notify parent that map is ready and pass the centerMap function and map instance
      if (onMapReady) {
        onMapReady(centerMap, map);
      }
    },
    [onMapReady, centerMap],
  );

  // Get dynamic map options based on target mode
  const dynamicMapOptions = useMemo(() => {
    const baseOptions = {
      ...mapOptions,
      disableDefaultUI: true,
      gestureHandling: "greedy" satisfies google.maps.MapOptions["gestureHandling"],
    } as const;

    // Only include center if map hasn't loaded yet (mapInstance is null)
    // This prevents re-centering when target mode changes
    const { center, ...optionsWithoutCenter } = baseOptions;
    const optionsWithConditionalCenter = mapInstance
      ? optionsWithoutCenter
      : baseOptions;

    if (targetMode?.active) {
      return {
        ...optionsWithConditionalCenter,
        scrollwheel: true,
        disableDoubleClickZoom: false,
      };
    }

    return optionsWithConditionalCenter;
  }, [targetMode?.active, mapOptions, mapInstance]);

  const handleCenterChanged = useCallback(() => {
    if (!mapRef.current) return;
    const center = mapRef.current.getCenter();
    if (!center) return;
    latestCenterRef.current = {
      lat: roundCoordinate(center.lat()),
      lng: roundCoordinate(center.lng()),
    };
  }, []);

  const handleBoundsChangedInternal = useCallback(() => {
    if (!mapRef.current || !onBoundsChanged) return;

    const bounds = mapRef.current.getBounds();
    const zoom = mapRef.current.getZoom();
    if (!bounds || zoom === undefined) return;

    setCurrentZoom(zoom);

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();

    onBoundsChanged({
      north: roundCoordinate(ne.lat()),
      south: roundCoordinate(sw.lat()),
      east: roundCoordinate(ne.lng()),
      west: roundCoordinate(sw.lng()),
      zoom,
    });
  }, [onBoundsChanged]);

  // Track user location - only when explicitly enabled (after user clicks locate button)
  useEffect(() => {
    if (!shouldTrackLocation || !navigator.geolocation) {
      return;
    }

    // Use watchPosition for battery-efficient location tracking
    // It only updates when position actually changes
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        console.error("Error watching location:", error);
      },
      {
        enableHighAccuracy: false, // Accept coarse location to save battery
        timeout: 10000,
        maximumAge: 60000, // Cache for 1 minute
      },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      // Clear user location when tracking stops
      setUserLocation(null);
    };
  }, [shouldTrackLocation]);

  return (
    <div className="absolute inset-0">
      {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? (
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          options={dynamicMapOptions}
          onLoad={onMapLoad}
          onCenterChanged={handleCenterChanged}
          onBoundsChanged={handleBoundsChangedInternal}
        >
          {!targetMode?.active && (
            <GeoJSONLayer
              messages={messages}
              onFeatureClick={onFeatureClick}
              map={mapInstance}
              currentZoom={currentZoom}
              hoveredMessageId={hoveredMessageId}
              selectedMessageId={selectedMessageId}
            />
          )}

          {/* Render interest circles */}
          {interests && interests.length > 0 && (
            <InterestCircles
              map={mapInstance}
              interests={interests}
              onInterestClick={onInterestClick}
              interactive={interestsInteractive}
              editingInterestId={targetMode?.editingInterestId}
              hideAll={targetMode?.active ?? false}
            />
          )}

          {/* Render target mode overlay when active */}
          {targetMode?.active && (
            <InterestTargetMode
              map={mapInstance}
              initialRadius={targetMode.initialRadius}
              pendingColor={targetMode.pendingColor}
              isEditing={!!targetMode.editingInterestId}
              onSave={targetMode.onSave}
              onCancel={targetMode.onCancel}
            />
          )}

          {/* User location blue dot */}
          {userLocation &&
            !targetMode?.active &&
            (() => {
              // Scale radius based on zoom level to remain visible at all zooms
              // At zoom 18 (max): 8m, at zoom 12 (min): 50m - linear scale
              const minZoom = 12;
              const maxZoom = 18;
              const minRadius = 50;
              const maxRadius = 8;
              const zoomRange = maxZoom - minZoom;
              const radiusRange = minRadius - maxRadius;
              // Clamp currentZoom to minZoom-maxZoom range to ensure radius stays within bounds
              const clampedZoom = Math.max(
                minZoom,
                Math.min(maxZoom, currentZoom),
              );
              const baseRadius =
                minRadius - ((clampedZoom - minZoom) / zoomRange) * radiusRange;
              const outerRadius = baseRadius * 2;
              const innerRadius = baseRadius * 0.4;

              return (
                <>
                  {/* Outer pulse circle */}
                  <Circle
                    center={userLocation}
                    radius={outerRadius}
                    options={{
                      fillColor: "#4285F4",
                      fillOpacity: 0.2,
                      strokeColor: "#4285F4",
                      strokeOpacity: 0.4,
                      strokeWeight: 1,
                      clickable: false,
                      zIndex: 1000,
                    }}
                  />
                  {/* Inner solid circle */}
                  <Circle
                    center={userLocation}
                    radius={innerRadius}
                    options={{
                      fillColor: "#4285F4",
                      fillOpacity: 1,
                      strokeColor: "#FFFFFF",
                      strokeOpacity: 1,
                      strokeWeight: 2,
                      clickable: false,
                      zIndex: 1001,
                    }}
                  />
                </>
              );
            })()}
        </GoogleMap>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-100">
          <p className="text-red-600">Няма настроен ключ за Google Maps API</p>
        </div>
      )}
    </div>
  );
}
