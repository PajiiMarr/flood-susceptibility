import { useState, useEffect, useCallback, useRef } from "react";
import FloodMap from "./components/Map";
import "./App.css";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, MapPinOff } from "lucide-react";
import { supabase } from "./lib/supabaseClient";

// ---------- Reverse geocoding ----------
async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`Reverse geocoding failed: ${res.status}`);
  const data = await res.json();
  const addr = data.address || {};
  const specific =
    addr.neighbourhood || addr.suburb || addr.village || addr.town || addr.city_district || addr.city;
  const city = addr.city || addr.town || addr.municipality;
  if (specific && city && specific !== city) return `${specific}, ${city}`;
  return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// Route colors corresponding to the map
const ROUTE_COLORS = ["#1a73e8", "#e68a00", "#c62828"];

// ---------- Main App ----------
function App() {
  const [selection, setSelection] = useState({
    mode: "idle",
    results: [],          // array of { facility, distanceMeters, durationSeconds, routeGeoJSON }
    errorMsg: null,
    origin: null,
  });
  const locationHandlerRef = useRef(null);

  const [facilityTypes, setFacilityTypes] = useState([]);
  const [selectedType, setSelectedType] = useState(null);

  useEffect(() => {
    supabase
      .from("health_facilities")
      .select("type")
      .then(({ data, error }) => {
        if (!error && data) {
          const types = [...new Set(data.map((item) => item.type))]
            .filter(Boolean)
            .sort();
          setFacilityTypes(types);
        }
      });
  }, []);

  const handleRequestLocation = useCallback((fn) => {
    locationHandlerRef.current = fn;
  }, []);

  const handleUseMyLocationClick = () => {
    locationHandlerRef.current?.();
  };

  return (
    <div className="flex w-full h-screen">
      <div className="w-3/4 h-full">
        <FloodMap
          onSelectionChange={setSelection}
          onRequestLocation={handleRequestLocation}
          filterType={selectedType}
        />
      </div>
      <div className="w-1/4 h-full bg-background p-6 overflow-y-auto border-l">
        <FacilityDetailsPanel
          selection={selection}
          onUseMyLocation={handleUseMyLocationClick}
          facilityTypes={facilityTypes}
          selectedType={selectedType}
          onTypeChange={setSelectedType}
        />
      </div>
    </div>
  );
}

// ---------- Right Panel ----------
function FacilityDetailsPanel({
  selection,
  onUseMyLocation,
  facilityTypes,
  selectedType,
  onTypeChange,
}) {
  const { mode, results, errorMsg, origin } = selection;

  return (
    <div className="space-y-4">
      {/* Type filter */}
      {facilityTypes.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Facility Type
            </h4>
            <div className="flex flex-wrap gap-1">
              <Button
                variant={selectedType === null ? "default" : "outline"}
                size="sm"
                onClick={() => onTypeChange(null)}
              >
                All
              </Button>
              {facilityTypes.map((type) => (
                <Button
                  key={type}
                  variant={selectedType === type ? "default" : "outline"}
                  size="sm"
                  onClick={() => onTypeChange(type)}
                >
                  {type}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Button
        onClick={onUseMyLocation}
        disabled={mode === "loading"}
        className="w-full"
        size="sm"
      >
        {mode === "loading" ? (
          <>
            <MapPinOff className="mr-2 h-4 w-4 animate-pulse" />
            Searching…
          </>
        ) : (
          <>
            <MapPin className="mr-2 h-4 w-4" />
            Use my location
          </>
        )}
      </Button>

      {mode === "idle" && (
        <Card className="border-dashed bg-muted/50">
          <CardContent className="p-4 text-center text-sm text-muted-foreground">
            Click the map or use your location to find the nearest health facilities.
          </CardContent>
        </Card>
      )}

      {mode === "loading" && <SkeletonFacilityDetails />}

      {mode === "error" && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            {errorMsg}
          </CardContent>
        </Card>
      )}

      {mode === "done" && results.length > 0 && (
        <div className="space-y-4">
          <OriginCard origin={origin} />
          {results.map((item, index) => (
            <FacilityCard
              key={item.facility.name + item.facility.lat}
              item={item}
              rank={index + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Skeleton for top 3 facilities ----------
function SkeletonFacilityDetails() {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        </CardContent>
      </Card>
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-3 w-1/3" />
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between border-b pb-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex justify-between border-b pb-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------- Origin location card ----------
function OriginCard({ origin }) {
  const [placeName, setPlaceName] = useState(null);
  const [loadingName, setLoadingName] = useState(false);

  useEffect(() => {
    if (!origin) {
      setPlaceName(null);
      return;
    }
    let cancelled = false;
    setLoadingName(true);
    setPlaceName(null);

    reverseGeocode(origin.lat, origin.lng)
      .then((name) => { if (!cancelled) setPlaceName(name); })
      .catch(() => { if (!cancelled) setPlaceName(`${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`); })
      .finally(() => { if (!cancelled) setLoadingName(false); });

    return () => { cancelled = true; };
  }, [origin]);

  return (
    <Card>
      <CardContent className="p-4 flex gap-3 items-center">
        <span className="text-2xl">📍</span>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Your location
          </div>
          <div className="text-sm font-medium">
            {loadingName ? "Locating…" : placeName || "—"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Single facility card ----------
function FacilityCard({ item, rank }) {
  const { facility, distanceMeters, durationSeconds } = item;
  const color = ROUTE_COLORS[rank - 1] || "#9e9e9e";

  return (
    <Card className="relative">
      {/* Colored rank indicator */}
      <div
        className="absolute top-0 left-0 w-1 h-full rounded-l-lg"
        style={{ backgroundColor: color }}
      />
      <CardHeader className="pb-2 pl-5">
        <div className="flex justify-between items-start">
          <CardTitle className="text-base">{facility.name}</CardTitle>
          <span
            className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
            style={{ backgroundColor: color }}
          >
            #{rank}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{facility.type}</p>
      </CardHeader>
      <CardContent className="space-y-2 text-sm pl-5">
        <div className="flex justify-between border-b pb-2">
          <span className="text-muted-foreground">Distance</span>
          <span className="font-medium">{(distanceMeters / 1000).toFixed(2)} km</span>
        </div>
        <div className="flex justify-between border-b pb-2">
          <span className="text-muted-foreground">Travel time</span>
          <span className="font-medium">{Math.round(durationSeconds / 60)} min</span>
        </div>
        {facility.addr_street && (
          <div className="flex justify-between border-b pb-2">
            <span className="text-muted-foreground">Address</span>
            <span className="font-medium text-right">{facility.addr_street}</span>
          </div>
        )}
        {facility.phone && (
          <div className="flex justify-between border-b pb-2">
            <span className="text-muted-foreground">Phone</span>
            <span className="font-medium">{facility.phone}</span>
          </div>
        )}
        {facility.website && (
          <div className="flex justify-between border-b pb-2">
            <span className="text-muted-foreground">Website</span>
            <a
              href={facility.website}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline text-primary"
            >
              Visit
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default App;