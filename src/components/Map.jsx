// FloodMap.jsx
import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const VITE_STADIA_KEY = import.meta.env.VITE_STADIA_KEY || "";

const WORLD_RING = [
  [-90, -180],
  [90, -180],
  [90, 180],
  [-90, 180],
  [-90, -180],
];

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

// Public OSRM demo server — rate-limited; self-host or use a keyed service for production.
const OSRM_BASE = "https://router.project-osrm.org";

// Straight-line distance, used only as a cheap pre-filter before the road-based OSRM call.
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

// One-to-many road distances/durations from origin to each candidate.
async function fetchRoadDistances(origin, facilities) {
  if (facilities.length === 0) return [];
  const coordsParam = [origin, ...facilities.map((f) => [f.lat, f.lon])]
    .map(([lat, lon]) => `${lon},${lat}`)
    .join(";");
  const url = `${OSRM_BASE}/table/v1/driving/${coordsParam}?sources=0&annotations=distance,duration`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== "Ok")
    throw new Error(data.message || "Table request failed");
  return facilities.map((f, i) => ({
    facility: f,
    distanceMeters: data.distances[0][i + 1],
    durationSeconds: data.durations[0][i + 1],
  }));
}

// Road-following geometry for the winning facility only.
async function fetchRoadRoute(origin, dest) {
  const url = `${OSRM_BASE}/route/v1/driving/${origin[1]},${origin[0]};${dest[1]},${dest[0]}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error(data.message || "Route request failed");
  }
  return data.routes[0];
}

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

// Loads health facilities from Supabase and reports them up via onFacilities
// so RoutingLayer can use the same dataset.
const TYPE_ICONS = {
  Pharmacy: "💊",
  Hospital: "🏥",
  Clinic: "🏥",
  "Medical Office": "👨‍⚕️",
};

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

  useEffect(() => {
    let isMounted = true;
    let statusControl = null;

    const addMarkersToMap = (rows) => {
      if (!map) return;
      if (markerLayerRef.current) map.removeLayer(markerLayerRef.current);
      const markerGroup = L.layerGroup();

      const facilitiesList = rows.map((row) => {
        const emoji = TYPE_ICONS[row.type] || "📍";
        const icon = L.divIcon({
          html: `<div style="font-size:24px; text-shadow: 0 0 2px white;">${emoji}</div>`,
          iconSize: [24, 24],
          className: "custom-poi-marker",
        });

        const popupContent = `
          <div style="min-width: 150px;">
            <strong>${row.name}</strong><br>
            Type: ${row.type}<br>
            ${row.addr_street ? `Address: ${row.addr_street}<br>` : ""}
            ${row.addr_city ? `City: ${row.addr_city}<br>` : ""}
            ${row.phone ? `Phone: ${row.phone}<br>` : ""}
            ${row.website ? `Website: <a href="${row.website}" target="_blank">link</a>` : ""}
          </div>
        `;
        L.marker([row.lat, row.lon], { icon })
          .bindPopup(popupContent)
          .addTo(markerGroup);

        return { lat: row.lat, lon: row.lon, name: row.name, type: row.type };
      });

      setPoiCount(facilitiesList.length);
      markerGroup.addTo(map);
      markerLayerRef.current = markerGroup;
      onFacilitiesRef.current?.(facilitiesList);
    };

    const fetchPois = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data, error: queryError } = await supabase
          .from("health_facilities")
          .select("name, type, lat, lon, addr_street, addr_city, phone, website");

        if (queryError) throw queryError;

        if (isMounted) {
          addMarkersToMap(data || []);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(`Failed to load health facilities: ${err.message}`);
          setLoading(false);
        }
      }
    };

    fetchPois();

    // if (map) {
    //   statusControl = L.control({ position: "bottomleft" });
    //   statusControl.onAdd = () => {
    //     const div = L.DomUtil.create("div", "poi-status");
    //     div.style.cssText =
    //       "background:rgba(0,0,0,0.7);color:white;padding:5px 10px;border-radius:4px;font-size:12px;z-index:1000";
    //     if (loading) div.innerText = "⏳ Loading health facilities...";
    //     else if (error) div.innerText = `⚠️ ${error}`;
    //     else if (poiCount === 0)
    //       div.innerText = "⚠️ No health facilities found in database.";
    //     else div.innerText = `✅ ${poiCount} health facilities loaded (Zamboanga City)`;
    //     return div;
    //   };
    //   statusControl.addTo(map);
    // }

    return () => {
      isMounted = false;
      if (markerLayerRef.current && map) map.removeLayer(markerLayerRef.current);
      if (statusControl && map) map.removeControl(statusControl);
    };
  }, [map, poiCount]);

  return null;
}

// Click the map (or "use my location") to find the nearest health facility
// by road and draw the road-following route.
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

        const candidates = kNearestByHaversine(origin, facilities, 15);
        const ranked = await fetchRoadDistances(origin, candidates);
        const valid = ranked.filter((r) => r.distanceMeters != null);
        if (valid.length === 0)
          throw new Error("No reachable facility found by road");
        valid.sort((a, b) => a.distanceMeters - b.distanceMeters);
        const best = valid[0];

        const route = await fetchRoadRoute(origin, [
          best.facility.lat,
          best.facility.lon,
        ]);

        setResult({ ...best, routeGeoJSON: route.geometry });
        setMode("done");
      } catch (err) {
        setErrorMsg(err.message);
        setMode("error");
      }
    },
    [facilities],
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
      },
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
        .bindPopup(
          `<strong>${result.facility.name}</strong><br>Nearest by road`,
        )
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
      {mode === "idle" && (
        <div>🖱️ Click the map to find the nearest health facility by road</div>
      )}
      {mode === "loading" && (
        <div>⏳ Calculating nearest facility by road...</div>
      )}
      {mode === "error" && <div>⚠️ {errorMsg}</div>}
      {mode === "done" && result && (
        <div>
          🏥 <strong>{result.facility.name}</strong> ({result.facility.type})
          <br />
          📏 {(result.distanceMeters / 1000).toFixed(2)} km · ⏱️{" "}
          {Math.round(result.durationSeconds / 60)} min by road
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

function FloodMap() {
  const position = [7.0736, 122.01];
  const [facilities, setFacilities] = useState([]);

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