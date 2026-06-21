import { useState, useCallback, useRef } from "react";
import FloodMap from "./components/Map";
import "./App.css";

function App() {
  const [selection, setSelection] = useState({
    mode: "idle",
    result: null,
    errorMsg: null,
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
  const { mode, result, errorMsg } = selection;

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
        <FacilityDetails result={result} />
      )}
    </div>
  );
}

function FacilityDetails({ result }) {
  const { facility, distanceMeters, durationSeconds } = result;
  return (
    <div>
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

export default App;