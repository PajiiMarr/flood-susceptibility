import { useState, useEffect, useCallback, useRef } from "react";
import FloodMap from "./components/Map";
import "./App.css";

// Reverse-geocode lat/lng to a human-readable place name via Nominatim (OSM).
// No API key needed. Nominatim's usage policy asks for max ~1 req/sec and an
// identifying header — fine for low-traffic/demo use; for production traffic,
// route this through your own server-side proxy instead.
async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
  const res = await fetch(url, {
    headers: { "Accept-Language": "en" },
  });
  if (!res.ok) throw new Error(`Reverse geocoding failed: ${res.status}`);
  const data = await res.json();

  const addr = data.address || {};
  const specific =
    addr.neighbourhood ||
    addr.suburb ||
    addr.village ||
    addr.town ||
    addr.city_district ||
    addr.city;
  const city = addr.city || addr.town || addr.municipality;

  if (specific && city && specific !== city) {
    return `${specific}, ${city}`;
  }
  return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function App() {
  const [selection, setSelection] = useState({
    mode: "idle",
    result: null,
    errorMsg: null,
    origin: null,
  });
  const locationHandlerRef = useRef(null);

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
        />
      </div>
      <div className="w-1/4 h-full bg-white p-6 overflow-y-auto">
        <FacilityDetailsPanel
          selection={selection}
          onUseMyLocation={handleUseMyLocationClick}
        />
      </div>
    </div>
  );
}

function FacilityDetailsPanel({ selection, onUseMyLocation }) {
  const { mode, result, errorMsg, origin } = selection;

  return (
    <div>
      <button
        onClick={onUseMyLocation}
        disabled={mode === "loading"}
        className="mb-4 px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
      >
        📍 Use my location
      </button>

      {mode === "idle" && (
        <div>
          Click the map or use your location to find the nearest health
          facility.
        </div>
      )}

      {mode === "loading" && <div>Calculating nearest facility…</div>}

      {mode === "error" && <div>{errorMsg}</div>}

      {mode === "done" && result && (
        <FacilityDetails result={result} origin={origin} />
      )}
    </div>
  );
}

function FacilityDetails({ result, origin }) {
  const { facility, distanceMeters, durationSeconds } = result;

  return (
    <div>
      <RouteSummary origin={origin} facility={facility} />

      <h2 className="text-xl font-semibold mb-1">{facility.name}</h2>
      <p className="text-sm mb-4">{facility.type}</p>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between border-b pb-2">
          <span>Distance</span>
          <span className="font-medium">
            {(distanceMeters / 1000).toFixed(2)} km
          </span>
        </div>
        <div className="flex justify-between border-b pb-2">
          <span>Travel time</span>
          <span className="font-medium">
            {Math.round(durationSeconds / 60)} min by road
          </span>
        </div>
        {facility.addr_street && (
          <div className="flex justify-between border-b pb-2">
            <span>Address</span>
            <span className="font-medium text-right">
              {facility.addr_street}
            </span>
          </div>
        )}
        {facility.phone && (
          <div className="flex justify-between border-b pb-2">
            <span>Phone</span>
            <span className="font-medium">{facility.phone}</span>
          </div>
        )}
        {facility.website && (
          <div className="flex justify-between border-b pb-2">
            <span>Website</span>
            <a
              href={facility.website}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline"
            >
              Visit
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// Two-stop visual: origin pin on top, connecting line, facility pin below.
function RouteSummary({ origin, facility }) {
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
      .then((name) => {
        if (!cancelled) setPlaceName(name);
      })
      .catch(() => {
        if (!cancelled) {
          setPlaceName(`${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingName(false);
      });

    return () => {
      cancelled = true;
    };
  }, [origin]);

  return (
    <div className="mb-5 border rounded-lg p-4">
      <div className="flex gap-3">
        <div className="flex flex-col items-center pt-1">
          <span className="text-lg leading-none">📍</span>
          <span className="w-px flex-1 border-l border-dashed border-gray-400 my-1" />
          <span className="text-lg leading-none">🎯</span>
        </div>
        <div className="flex flex-col justify-between flex-1">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Your location
            </div>
            <div className="text-sm font-medium">
              {loadingName ? "Locating…" : placeName || "—"}
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Nearest facility
            </div>
            <div className="text-sm font-medium">{facility.name}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;