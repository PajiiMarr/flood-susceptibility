// FloodMap.jsx
import { useEffect, useState, useRef, useCallback } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// ---------- Safe environment variable access (fixes "process is not defined") ----------
const VITE_STADIA_KEY = import.meta.env.VITE_STADIA_KEY || '';

const WORLD_RING = [
  [-90, -180],
  [90, -180],
  [90, 180],
  [-90, 180],
  [-90, -180],
];

// Demo FSI risk levels
const RISK_LEVELS = {
  "Very High Risk": "#d73027",
  "High Risk": "#fc8d59",
  "Medium Risk": "#fee090",
  "Low Risk": "#91bfdb",
};

function getRandomRiskLevel() {
  const levels = Object.keys(RISK_LEVELS);
  return levels[Math.floor(Math.random() * levels.length)];
}

// --------------------------------------------------------------------------
// Routing / nearest-facility helpers
// --------------------------------------------------------------------------

// Public OSRM demo server — fine for dev/testing, but rate-limited.
// For production, self-host OSRM or use a keyed service (OpenRouteService, Mapbox).
const OSRM_BASE = "https://router.project-osrm.org";

// Great-circle distance in meters. Used only as a cheap pre-filter — it has
// no concept of roads, rivers, or bridges, so it's never the final answer.
function haversineDistance([lat1, lon1], [lat2, lon2]) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Phase 1: cheap straight-line pre-filter, keeps the OSRM request small.
function kNearestByHaversine(origin, facilities, k = 15) {
  return facilities
    .map((f) => ({
      facility: f,
      straightLineMeters: haversineDistance(origin, [f.lat, f.lon]),
    }))
    .sort((a, b) => a.straightLineMeters - b.straightLineMeters)
    .slice(0, k)
    .map((r) => r.facility);
}

// Phase 2: ask OSRM for real road distances/durations from origin to each
// candidate in a single request (one-to-many shortest path on the road graph).
async function fetchRoadDistances(origin, facilities) {
  if (facilities.length === 0) return [];
  const coordsParam = [origin, ...facilities.map((f) => [f.lat, f.lon])]
    .map(([lat, lon]) => `${lon},${lat}`)
    .join(";");
  const url = `${OSRM_BASE}/table/v1/driving/${coordsParam}?sources=0&annotations=distance,duration`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== "Ok") throw new Error(data.message || "Table request failed");
  return facilities.map((f, i) => ({
    facility: f,
    distanceMeters: data.distances[0][i + 1],
    durationSeconds: data.durations[0][i + 1],
  }));
}

// Phase 3: fetch the actual road-following geometry for the winning facility.
async function fetchRoadRoute(origin, dest) {
  const url = `${OSRM_BASE}/route/v1/driving/${origin[1]},${origin[0]};${dest[1]},${dest[0]}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error(data.message || "Route request failed");
  }
  return data.routes[0];
}

// --------------------------------------------------------------------------
// Legend
// --------------------------------------------------------------------------

function LegendControl() {
  const map = useMap();

  useEffect(() => {
    const legend = L.control({ position: "topright" });

    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "info legend");
      div.style.backgroundColor = "rgba(255,255,255,1)";
      div.style.padding = "10px";
      div.style.borderRadius = "5px";
      div.style.boxShadow = "0 1px 5px rgba(0,0,0,0.2)";
      div.style.fontFamily = "Arial, sans-serif";
      div.style.fontSize = "12px";
      div.style.color = "black";
      div.innerHTML = "<strong>Flood Susceptibility Index</strong><br>";

      for (const [level, color] of Object.entries(RISK_LEVELS)) {
        div.innerHTML += `
          <div style="display: flex; align-items: center; margin-top: 4px;">
            <div style="background: ${color}; width: 18px; height: 18px; border-radius: 2px; margin-right: 8px;"></div>
            <span>${level}</span>
          </div>
        `;
      }
      return div;
    };

    legend.addTo(map);
    return () => legend.remove();
  }, [map]);

  return null;
}

// --------------------------------------------------------------------------
// POI layer — fetches health facilities and also reports them up via
// onFacilities so the routing layer can use the same dataset.
// --------------------------------------------------------------------------

function POILayer({ onFacilities }) {
  const map = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [poiCount, setPoiCount] = useState(null);
  const markerLayerRef = useRef(null);
  const onFacilitiesRef = useRef(onFacilities);

  useEffect(() => {
    onFacilitiesRef.current = onFacilities;
  }, [onFacilities]);

  const fetchWithRetry = async (url, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url);
        if (response.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
          continue;
        }
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        if (data.remark && data.remark.includes("runtime error")) {
          throw new Error(`Overpass API error: ${data.remark}`);
        }
        return data;
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  };

  useEffect(() => {
    let isMounted = true;
    let statusControl = null;

    const fetchPois = async () => {
      try {
        setLoading(true);
        setError(null);
        const cacheKey = "poi_zamboanga_health_3617877";
        const cached = sessionStorage.getItem(cacheKey);

        if (cached) {
          const data = JSON.parse(cached);
          if (isMounted) {
            addMarkersToMap(data);
            setLoading(false);
          }
          return;
        }

        const overpassQuery = `
          [out:json][timeout:60];
          ( rel(3617877); );
          map_to_area -> .zamboangaCityArea;
          (
            node["amenity"="pharmacy"](area.zamboangaCityArea);
            node["amenity"="hospital"](area.zamboangaCityArea);
            node["healthcare"="hospital"](area.zamboangaCityArea);
            way["amenity"="pharmacy"](area.zamboangaCityArea);
            way["amenity"="hospital"](area.zamboangaCityArea);
            way["healthcare"="hospital"](area.zamboangaCityArea);
          );
          out body geom;
          >;
          out skel qt;
        `;

        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
        let data = await fetchWithRetry(url, 3, 1000);

        if (!data.elements || data.elements.length === 0) {
          console.log("No pharmacies/hospitals found, searching for clinics and doctors...");
          const fallbackQuery = `
            [out:json][timeout:60];
            ( rel(3617877); );
            map_to_area -> .zamboangaCityArea;
            (
              node["amenity"="clinic"](area.zamboangaCityArea);
              node["amenity"="doctors"](area.zamboangaCityArea);
              node["healthcare"="clinic"](area.zamboangaCityArea);
              node["healthcare"="doctor"](area.zamboangaCityArea);
              way["amenity"="clinic"](area.zamboangaCityArea);
              way["amenity"="doctors"](area.zamboangaCityArea);
              way["healthcare"="clinic"](area.zamboangaCityArea);
              way["healthcare"="doctor"](area.zamboangaCityArea);
            );
            out body geom;
            >;
            out skel qt;
          `;
          const fallbackUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(fallbackQuery)}`;
          data = await fetchWithRetry(fallbackUrl, 3, 1000);
        }

        sessionStorage.setItem(cacheKey, JSON.stringify(data));
        if (isMounted) {
          addMarkersToMap(data);
          setLoading(false);
        }
      } catch (err) {
        console.error("POI fetch error:", err);
        if (isMounted) {
          setError(`Failed to load health facilities: ${err.message}`);
          setLoading(false);
        }
      }
    };

    const addMarkersToMap = (data) => {
      if (!map) return;
      if (markerLayerRef.current) map.removeLayer(markerLayerRef.current);
      const markerGroup = L.layerGroup();
      const elements = data.elements || [];
      let markerCount = 0;
      const facilitiesList = [];

      const defaultIcon = L.divIcon({
        html: `<div style="font-size:24px; text-shadow: 0 0 2px white;">📍</div>`,
        iconSize: [24, 24],
        className: "custom-poi-marker",
      });

      elements.forEach((el) => {
        let lat, lon;
        if (el.type === "node" && el.lat && el.lon) {
          lat = el.lat;
          lon = el.lon;
        } else if (el.geometry && el.geometry[0]) {
          lat = el.geometry[0].lat;
          lon = el.geometry[0].lon;
        } else {
          return;
        }

        const tags = el.tags || {};
        let icon, name, type;

        if (tags.amenity === "pharmacy" || tags.healthcare === "pharmacy") {
          icon = L.divIcon({
            html: `<div style="font-size:24px; text-shadow: 0 0 2px white;">💊</div>`,
            iconSize: [24, 24],
            className: "custom-poi-marker",
          });
          name = tags.name || "Pharmacy";
          type = "Pharmacy";
        } else if (tags.amenity === "hospital" || tags.healthcare === "hospital") {
          icon = L.divIcon({
            html: `<div style="font-size:24px; text-shadow: 0 0 2px white;">🏥</div>`,
            iconSize: [24, 24],
            className: "custom-poi-marker",
          });
          name = tags.name || "Hospital";
          type = "Hospital";
        } else if (tags.amenity === "clinic" || tags.healthcare === "clinic") {
          icon = L.divIcon({
            html: `<div style="font-size:24px; text-shadow: 0 0 2px white;">🏥</div>`,
            iconSize: [24, 24],
            className: "custom-poi-marker",
          });
          name = tags.name || "Clinic";
          type = "Clinic";
        } else if (tags.amenity === "doctors" || tags.healthcare === "doctor") {
          icon = L.divIcon({
            html: `<div style="font-size:24px; text-shadow: 0 0 2px white;">👨‍⚕️</div>`,
            iconSize: [24, 24],
            className: "custom-poi-marker",
          });
          name = tags.name || `Doctor's Office`;
          type = "Medical Office";
        } else {
          icon = defaultIcon;
          name = tags.name || "Health Facility";
          type = tags.amenity || tags.healthcare || "Facility";
        }

        markerCount++;
        facilitiesList.push({ lat, lon, name, type, tags });

        const popupContent = `
          <div style="min-width: 150px;">
            <strong>${name}</strong><br>
            Type: ${type}<br>
            ${tags["addr:street"] ? `Address: ${tags["addr:street"]}<br>` : ""}
            ${tags["addr:city"] ? `City: ${tags["addr:city"]}<br>` : ""}
            ${tags.phone ? `Phone: ${tags.phone}<br>` : ""}
            ${tags.website ? `Website: <a href="${tags.website}" target="_blank">link</a>` : ""}
          </div>
        `;
        L.marker([lat, lon], { icon }).bindPopup(popupContent).addTo(markerGroup);
      });

      console.log(`✅ Added ${markerCount} health facility markers`);
      setPoiCount(markerCount);
      markerGroup.addTo(map);
      markerLayerRef.current = markerGroup;
      onFacilitiesRef.current?.(facilitiesList);
    };

    fetchPois();

    if (map) {
      statusControl = L.control({ position: "bottomleft" });
      statusControl.onAdd = () => {
        const div = L.DomUtil.create("div", "poi-status");
        div.style.cssText =
          "background:rgba(0,0,0,0.7);color:white;padding:5px 10px;border-radius:4px;font-size:12px;z-index:1000";
        if (loading) div.innerText = "⏳ Loading health facilities across Zamboanga City...";
        else if (error) div.innerText = `⚠️ ${error}`;
        else if (poiCount === 0) div.innerText = "⚠️ No health facilities found. Try zooming in or check OSM data.";
        else div.innerText = `✅ ${poiCount} health facilities loaded (Zamboanga City)`;
        return div;
      };
      statusControl.addTo(map);
    }

    return () => {
      isMounted = false;
      if (markerLayerRef.current && map) map.removeLayer(markerLayerRef.current);
      if (statusControl && map) map.removeControl(statusControl);
    };
  }, [map, poiCount]);

  return null;
}

// --------------------------------------------------------------------------
// Routing layer — click the map (or "use my location") to find the nearest
// health facility BY ROAD, and draw the actual road-following route.
// --------------------------------------------------------------------------

function RoutingLayer({ facilities }) {
  const map = useMap();
  const [mode, setMode] = useState("idle"); // idle | loading | done | error
  const [origin, setOrigin] = useState(null);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const layerRef = useRef(null);

  const runSearch = useCallback(
    async (latlng) => {
      setMode("loading");
      setErrorMsg(null);
      try {
        if (!facilities || facilities.length === 0) {
          throw new Error("No health facilities loaded yet");
        }
        const origin = [latlng.lat, latlng.lng];

        // Phase 1: cheap straight-line pre-filter (no network call).
        const candidates = kNearestByHaversine(origin, facilities, 15);

        // Phase 2: real road distances for just those candidates.
        const ranked = await fetchRoadDistances(origin, candidates);
        const valid = ranked.filter((r) => r.distanceMeters != null);
        if (valid.length === 0) throw new Error("No reachable facility found by road");
        valid.sort((a, b) => a.distanceMeters - b.distanceMeters);
        const best = valid[0];

        // Phase 3: actual road geometry for the winner only.
        const route = await fetchRoadRoute(origin, [best.facility.lat, best.facility.lon]);

        setResult({ ...best, routeGeoJSON: route.geometry });
        setMode("done");
      } catch (err) {
        console.error(err);
        setErrorMsg(err.message);
        setMode("error");
      }
    },
    [facilities]
  );

  useMapEvents({
    click(e) {
      if (mode !== "loading") {
        setOrigin(e.latlng);
        runSearch(e.latlng);
      }
    },
  });

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setErrorMsg("Geolocation not supported by this browser");
      setMode("error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setOrigin(latlng);
        runSearch(latlng);
      },
      (err) => {
        setErrorMsg(err.message);
        setMode("error");
      }
    );
  };

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!origin) return;

    const group = L.layerGroup();

    L.marker(origin, {
      icon: L.divIcon({
        html: `<div style="font-size:26px;">📍</div>`,
        iconSize: [26, 26],
        className: "custom-poi-marker",
      }),
    }).addTo(group);

    if (result) {
      L.marker([result.facility.lat, result.facility.lon], {
        icon: L.divIcon({
          html: `<div style="font-size:26px;">🎯</div>`,
          iconSize: [26, 26],
          className: "custom-poi-marker",
        }),
      })
        .bindPopup(`<strong>${result.facility.name}</strong><br>Nearest by road`)
        .addTo(group);

      if (result.routeGeoJSON) {
        L.geoJSON(result.routeGeoJSON, {
          style: { color: "#1a73e8", weight: 4, opacity: 0.85 },
        }).addTo(group);
      }
    }

    group.addTo(map);
    layerRef.current = group;

    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current);
    };
  }, [origin, result, map]);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 10,
        right: 10,
        zIndex: 1000,
        background: "rgba(0,0,0,0.78)",
        color: "white",
        padding: "10px 12px",
        borderRadius: 6,
        fontFamily: "Arial, sans-serif",
        fontSize: 12,
        maxWidth: 250,
        lineHeight: 1.4,
      }}
    >
      {mode === "idle" && <div>🖱️ Click the map to find the nearest health facility by road</div>}
      {mode === "loading" && <div>⏳ Calculating nearest facility by road...</div>}
      {mode === "error" && <div>⚠️ {errorMsg}</div>}
      {mode === "done" && result && (
        <div>
          🏥 <strong>{result.facility.name}</strong> ({result.facility.type})
          <br />
          📏 {(result.distanceMeters / 1000).toFixed(2)} km · ⏱️ {Math.round(result.durationSeconds / 60)} min by road
        </div>
      )}
      {mode !== "loading" && (
        <button
          onClick={handleUseMyLocation}
          style={{
            marginTop: 6,
            cursor: "pointer",
            background: "#1a73e8",
            color: "white",
            border: "none",
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 12,
          }}
        >
          📍 Use my location
        </button>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// City mask + barangay risk layer
// --------------------------------------------------------------------------

function ZamboangaMask() {
  const map = useMap();

  useEffect(() => {
    let maskLayer, borderLayer, barangayLayer;

    Promise.all([
      fetch("/zamboanga_city_boundary.geojson").then((r) => r.json()),
      fetch("/zamboanga_city_barangays.geojson").then((r) => r.json()),
    ]).then(([cityData, barangayData]) => {
      const feature = cityData.features[0];
      const geom = feature.geometry;
      const rings =
        geom.type === "MultiPolygon"
          ? geom.coordinates.map((poly) => poly[0])
          : [geom.coordinates[0]];

      const maskGeoJSON = {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [WORLD_RING.map(([lat, lng]) => [lng, lat]), ...rings],
        },
      };

      maskLayer = L.geoJSON(maskGeoJSON, {
        style: {
          color: "transparent",
          weight: 0,
          fillColor: "#d9d9d9",
          fillOpacity: 0.15,
        },
        interactive: false,
      }).addTo(map);

      borderLayer = L.geoJSON(cityData, {
        style: { color: "#e8401c", weight: 2.5, opacity: 1, fill: false },
        interactive: false,
      }).addTo(map);

      const featuresWithRisk = barangayData.features.map((feature) => ({
        ...feature,
        properties: { ...feature.properties, fsi_risk: getRandomRiskLevel() },
      }));

      const updatedBarangayData = {
        ...barangayData,
        features: featuresWithRisk,
      };

      barangayLayer = L.geoJSON(updatedBarangayData, {
        style: (feature) => {
          const risk = feature?.properties?.fsi_risk || "Low Risk";
          return {
            color: "#ffffff",
            weight: 1,
            opacity: 0.6,
            fillColor: RISK_LEVELS[risk] || RISK_LEVELS["Low Risk"],
            fillOpacity: 0.35,
          };
        },
        interactive: true,
        onEachFeature: (feature, layer) => {
          const name = feature.properties.adm4_name;
          const risk = feature.properties.fsi_risk;
          layer.bindTooltip(`${name}<br><strong>FSI: ${risk}</strong>`, {
            permanent: false,
            direction: "center",
            className: "barangay-label",
          });
          layer.on("mouseover", function () {
            this.setStyle({ fillOpacity: 0.6, weight: 2 });
          });
          layer.on("mouseout", function () {
            this.setStyle({ fillOpacity: 0.35, weight: 1 });
          });
        },
      }).addTo(map);
    });

    return () => {
      if (maskLayer) map.removeLayer(maskLayer);
      if (borderLayer) map.removeLayer(borderLayer);
      if (barangayLayer) map.removeLayer(barangayLayer);
    };
  }, [map]);

  return null;
}

// --------------------------------------------------------------------------
// Main FloodMap component
// --------------------------------------------------------------------------

function FloodMap() {
  const position = [7.0736, 122.01];
  const [facilities, setFacilities] = useState([]);

  // Optional: log the key for debugging (safe)
  useEffect(() => {
    console.log("🔑 Stadia API Key:", VITE_STADIA_KEY || "❌ NOT FOUND – check .env and Vercel variables");
  }, []);

  return (
    <>
      <style>{`
        .barangay-label {
          background: rgba(0,0,0,0.7);
          border: none;
          border-radius: 4px;
          color: #ffffff;
          font-size: 11px;
          font-weight: 500;
          padding: 3px 7px;
          white-space: nowrap;
        }
        .barangay-label::before {
          display: none;
        }
        .custom-poi-icon {
          background: none;
          border: none;
        }
      `}</style>

      <MapContainer
        center={position}
        zoom={10}
        scrollWheelZoom={true}
        style={{ height: "100vh", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={`https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}{r}.png?api_key=${VITE_STADIA_KEY}`}
        />
        <ZamboangaMask />
        <POILayer onFacilities={setFacilities} />
        <RoutingLayer facilities={facilities} />
        <LegendControl />
      </MapContainer>
    </>
  );
}

export default FloodMap;