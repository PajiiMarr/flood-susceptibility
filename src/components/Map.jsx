import {
  useEffect,
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { supabase } from "../lib/supabaseClient";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import * as XLSX from "xlsx";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import MarkerClusterGroup from "leaflet.markercluster";

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

const OSRM_BASE = "https://router.project-osrm.org";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const DEFAULT_VIEWBOX = "121.85,7.30,122.20,6.85";
const POPULATION_XLSX_URL =
  "https://xflhynxdadwlrloxiogv.supabase.co/storage/v1/object/public/fsi-bucket/SOCIO%20DEMOGRAPHIC%20DATAS/Region-IX_0.xlsx";

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

async function fetchRoadRoute(origin, dest) {
  const url = `${OSRM_BASE}/route/v1/driving/${origin[1]},${origin[0]};${dest[1]},${dest[0]}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error(data.message || "Route request failed");
  }
  return data.routes[0];
}

function getBoundingBox(feature) {
  if (!feature?.geometry?.coordinates) return null;
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  const walk = (coords) => {
    if (typeof coords[0] === "number") {
      const [lon, lat] = coords;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    coords.forEach(walk);
  };
  walk(feature.geometry.coordinates);
  return [minLon, minLat, maxLon, maxLat];
}

const ZAMBOANGA_BOUNDS = [
  [6.85, 121.85], // southwest [lat, lng]
  [7.3, 122.2], // northeast [lat, lng]
];

const ROMAN_TO_ARABIC = { i: "1", ii: "2", iii: "3", iv: "4", v: "5" };

function normalizeBarangayName(raw) {
  let n = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  n = n.toLowerCase();
  n = n.replace(/\bsto\.?\b/g, "santo").replace(/\bsta\.?\b/g, "santa");
  n = n.replace(/\bbrgy\.?\b/g, "").replace(/\bbarangay\b/g, "");
  n = n.replace(/[^a-z0-9\s]/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  n = n.replace(/\b(i|ii|iii|iv|v)\b/g, (m) => ROMAN_TO_ARABIC[m] || m);
  return n;
}

function buildNameKeys(raw) {
  const keys = new Set();
  keys.add(normalizeBarangayName(raw));
  const base = raw.replace(/\(.*?\)/g, "").trim();
  if (base && base !== raw) keys.add(normalizeBarangayName(base));
  return keys;
}

async function fetchBarangayPopulations() {
  try {
    const res = await fetch(POPULATION_XLSX_URL);
    if (!res.ok) throw new Error(`Population fetch failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName =
      workbook.SheetNames.find((n) => /city of zamboanga/i.test(n)) || null;
    if (!sheetName) throw new Error('"City of Zamboanga" sheet not found');
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    const popMap = new Map();
    for (const row of rows) {
      const name = row[1];
      const population = row[3];
      if (typeof name !== "string" || typeof population !== "number") continue;
      if (name.trim().toUpperCase() === "CITY OF ZAMBOANGA") continue;
      for (const key of buildNameKeys(name)) {
        if (!popMap.has(key)) popMap.set(key, population);
      }
    }
    return popMap;
  } catch (err) {
    console.warn("Barangay population load failed:", err.message);
    return new Map();
  }
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

// Google Maps-style Controls
function MapControls({ onLocate, onClear, hasLocation, onCenterLocation }) {
  const map = useMap();

  useEffect(() => {
    // Create the main control container
    const control = L.control({ position: "bottomright" });

    control.onAdd = () => {
      const container = L.DomUtil.create("div", "map-controls");
      container.style.backgroundColor = "white";
      container.style.borderRadius = "8px";
      container.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.overflow = "hidden";
      container.style.width = "40px";

      // Locate button (top)
      const locateBtn = document.createElement("button");
      locateBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" style="pointer-events: none;">
          <path fill="#444" d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
        </svg>
      `;
      locateBtn.style.cssText = `
        background: none;
        border: none;
        cursor: pointer;
        padding: 8px 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
        border-bottom: 1px solid #e0e0e0;
        width: 100%;
        position: relative;
      `;
      locateBtn.title = "Find my location";
      locateBtn.addEventListener("mouseenter", () => {
        locateBtn.style.backgroundColor = "#f0f0f0";
      });
      locateBtn.addEventListener("mouseleave", () => {
        locateBtn.style.backgroundColor = "transparent";
      });
      locateBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        onLocate?.();
      });

      // Center button (middle)
      const centerBtn = document.createElement("button");
      centerBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" style="pointer-events: none;">
          <path fill="#444" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      `;
      centerBtn.style.cssText = `
        background: none;
        border: none;
        cursor: pointer;
        padding: 8px 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
        border-bottom: 1px solid #e0e0e0;
        width: 100%;
        opacity: ${hasLocation ? "1" : "0.4"};
        pointer-events: ${hasLocation ? "auto" : "none"};
      `;
      centerBtn.title = "Center on location";
      centerBtn.addEventListener("mouseenter", () => {
        if (hasLocation) {
          centerBtn.style.backgroundColor = "#f0f0f0";
        }
      });
      centerBtn.addEventListener("mouseleave", () => {
        centerBtn.style.backgroundColor = "transparent";
      });
      centerBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (hasLocation) {
          onCenterLocation?.();
        }
      });

      // Clear button (bottom)
      const clearBtn = document.createElement("button");
      clearBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" style="pointer-events: none;">
          <path fill="#444" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      `;
      clearBtn.style.cssText = `
        background: none;
        border: none;
        cursor: pointer;
        padding: 8px 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
        width: 100%;
        opacity: ${hasLocation ? "1" : "0.4"};
        pointer-events: ${hasLocation ? "auto" : "none"};
      `;
      clearBtn.title = "Clear location";
      clearBtn.addEventListener("mouseenter", () => {
        if (hasLocation) {
          clearBtn.style.backgroundColor = "#f0f0f0";
        }
      });
      clearBtn.addEventListener("mouseleave", () => {
        clearBtn.style.backgroundColor = "transparent";
      });
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (hasLocation) {
          onClear?.();
        }
      });

      container.appendChild(locateBtn);
      container.appendChild(centerBtn);
      container.appendChild(clearBtn);

      return container;
    };

    control.addTo(map);

    // Create separate zoom control
    const zoomControl = L.control({ position: "bottomright" });

    zoomControl.onAdd = () => {
      const zoomContainer = L.DomUtil.create("div", "zoom-controls");
      zoomContainer.style.backgroundColor = "white";
      zoomContainer.style.borderRadius = "8px";
      zoomContainer.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
      zoomContainer.style.overflow = "hidden";
      zoomContainer.style.width = "40px";
      zoomContainer.style.marginRight = "8px";

      const zoomInBtn = document.createElement("button");
      zoomInBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" style="pointer-events: none;">
          <path fill="#444" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
        </svg>
      `;
      zoomInBtn.style.cssText = `
        background: none;
        border: none;
        cursor: pointer;
        padding: 6px 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
        border-bottom: 1px solid #e0e0e0;
        width: 100%;
      `;
      zoomInBtn.title = "Zoom in";
      zoomInBtn.addEventListener("mouseenter", () => {
        zoomInBtn.style.backgroundColor = "#f0f0f0";
      });
      zoomInBtn.addEventListener("mouseleave", () => {
        zoomInBtn.style.backgroundColor = "transparent";
      });
      zoomInBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        map.zoomIn();
      });

      const zoomOutBtn = document.createElement("button");
      zoomOutBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" style="pointer-events: none;">
          <path fill="#444" d="M5 13h14v-2H5v2z"/>
        </svg>
      `;
      zoomOutBtn.style.cssText = `
        background: none;
        border: none;
        cursor: pointer;
        padding: 6px 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
        width: 100%;
      `;
      zoomOutBtn.title = "Zoom out";
      zoomOutBtn.addEventListener("mouseenter", () => {
        zoomOutBtn.style.backgroundColor = "#f0f0f0";
      });
      zoomOutBtn.addEventListener("mouseleave", () => {
        zoomOutBtn.style.backgroundColor = "transparent";
      });
      zoomOutBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        map.zoomOut();
      });

      zoomContainer.appendChild(zoomInBtn);
      zoomContainer.appendChild(zoomOutBtn);

      return zoomContainer;
    };

    zoomControl.addTo(map);

    // Store references for cleanup
    const controls = { control, zoomControl };

    return () => {
      control.remove();
      zoomControl.remove();
    };
  }, [map, onLocate, onClear, hasLocation, onCenterLocation]);

  return null;
}

export function SidebarSearch({ onSelectLocation, cityBoundary }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceTimerRef = useRef(null);
  const containerRef = useRef(null);
  const onSelectRef = useRef(onSelectLocation);
  const boundaryRef = useRef(cityBoundary);

  useEffect(() => {
    onSelectRef.current = onSelectLocation;
  }, [onSelectLocation]);

  useEffect(() => {
    boundaryRef.current = cityBoundary;
  }, [cityBoundary]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowResults(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const doSearch = useCallback(async (searchQuery) => {
    if (!searchQuery || searchQuery.trim().length < 3) {
      setResults([]);
      setShowResults(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setShowResults(true);
    try {
      const bbox = getBoundingBox(boundaryRef.current);
      const viewbox = bbox
        ? `${bbox[0]},${bbox[3]},${bbox[2]},${bbox[1]}`
        : DEFAULT_VIEWBOX;
      const url =
        `${NOMINATIM_BASE}/search?format=json&limit=6&countrycodes=ph` +
        `&viewbox=${viewbox}&bounded=1` +
        `&q=${encodeURIComponent(`${searchQuery}, Zamboanga City, Philippines`)}`;
      const res = await fetch(url, { headers: { "Accept-Language": "en" } });
      const data = await res.json();
      setResults(data || []);
      setShowResults(true);
    } catch (err) {
      setResults([]);
      setShowResults(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => doSearch(value), 400);
  };

  const handleSelect = (item) => {
    setQuery(item.display_name);
    setResults([]);
    setShowResults(false);
    onSelectRef.current?.({
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    });
  };

  return (
    <div
      ref={containerRef}
      className="sidebar-search"
      style={{
        width: "100%",
        background: "white",
        borderRadius: "4px",
        boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
        padding: "8px",
        position: "relative",
        zIndex: 1000,
      }}
    >
      <input
        type="text"
        className="search-input"
        placeholder="Search a place in Zamboanga City..."
        value={query}
        onChange={handleInputChange}
        onFocus={() => {
          if (results.length > 0) setShowResults(true);
        }}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "8px 10px",
          border: "none",
          borderRadius: "4px",
          fontSize: "13px",
          fontFamily: "Arial, sans-serif",
          outline: "none",
          background: "white",
        }}
      />
      {showResults && (
        <div
          className="search-results"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "white",
            borderRadius: "4px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
            maxHeight: "240px",
            overflowY: "auto",
            zIndex: 1001,
          }}
        >
          {loading ? (
            <div
              className="search-status"
              style={{ padding: "8px 10px", color: "#777" }}
            >
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div
              className="search-status"
              style={{ padding: "8px 10px", color: "#777" }}
            >
              No results found
            </div>
          ) : (
            results.map((item, idx) => (
              <div
                key={idx}
                className="search-item"
                onClick={() => handleSelect(item)}
                style={{
                  padding: "8px 10px",
                  fontSize: "12px",
                  fontFamily: "Arial, sans-serif",
                  color: "#222",
                  cursor: "pointer",
                  borderBottom: "1px solid #eee",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#f2f2f2")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "white")
                }
              >
                {item.display_name}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const TYPE_ICONS = {
  Pharmacy: "💊",
  Hospital: "🏥",
  Clinic: "🏥",
  "Medical Office": "👨‍⚕️",
};

const DEFAULT_MARKER_EMOJI = "📍";

function getDominantEmoji(markers) {
  const counts = {};
  for (const marker of markers) {
    const type = marker.options.facilityType;
    const emoji = TYPE_ICONS[type] || DEFAULT_MARKER_EMOJI;
    counts[emoji] = (counts[emoji] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return DEFAULT_MARKER_EMOJI;
  entries.sort((a, b) => b[1] - a[1]);
  const topCount = entries[0][1];
  const topEmojis = entries.filter(([, count]) => count === topCount);
  return topEmojis.length === 1 ? topEmojis[0][0] : DEFAULT_MARKER_EMOJI;
}

function POILayer({ onFacilities, hiddenFacilities = [] }) {
  const map = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const clusterRef = useRef(null);
  const onFacilitiesRef = useRef(onFacilities);
  const allFacilitiesRef = useRef([]);
  const [currentZoom, setCurrentZoom] = useState(map.getZoom());

  useEffect(() => {
    onFacilitiesRef.current = onFacilities;
  }, [onFacilities]);

  // Listen to zoom changes
  useEffect(() => {
    const handleZoomEnd = () => {
      setCurrentZoom(map.getZoom());
    };
    map.on("zoomend", handleZoomEnd);
    return () => {
      map.off("zoomend", handleZoomEnd);
    };
  }, [map]);

  const renderFacilities = useCallback(
    (rows, zoomLevel) => {
      if (!map) return;

      const hiddenIds = new Set(
        hiddenFacilities.map((f) => `${f.lat},${f.lon}`),
      );
      const visibleRows = rows.filter(
        (row) => !hiddenIds.has(`${row.lat},${row.lon}`),
      );

      if (clusterRef.current) {
        map.removeLayer(clusterRef.current);
        clusterRef.current = null;
      }

      if (visibleRows.length === 0) {
        setLoading(false);
        return;
      }

      // Cluster when zoom level is below 13 (zoomed out), don't cluster when zoom level is 13+ (zoomed in)
      const shouldCluster = zoomLevel < 13;

      if (shouldCluster) {
        // Use clustering - simplified icon without background, border, or count
        const clusterGroup = L.markerClusterGroup({
          maxClusterRadius: 40,
          iconCreateFunction: function (cluster) {
            const emoji = getDominantEmoji(cluster.getAllChildMarkers());
            const size = 36;
            const div = document.createElement("div");
            div.style.width = size + "px";
            div.style.height = size + "px";
            div.style.display = "flex";
            div.style.alignItems = "center";
            div.style.justifyContent = "center";
            div.style.fontSize = "24px";
            div.style.textShadow = "0 0 4px rgba(255,255,255,0.8)";
            div.innerHTML = emoji;
            return L.divIcon({
              html: div.outerHTML,
              iconSize: [size, size],
              className: "custom-cluster-icon",
            });
          },
        });

        const facilitiesList = visibleRows.map((row) => {
          const emoji = TYPE_ICONS[row.type] || DEFAULT_MARKER_EMOJI;
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

          return L.marker([row.lat, row.lon], {
            icon,
            facilityType: row.type,
          }).bindPopup(popupContent);
        });

        clusterGroup.addLayers(facilitiesList);
        clusterGroup.addTo(map);
        clusterRef.current = clusterGroup;
      } else {
        // Don't cluster - add markers individually (at zoom level 13+)
        const markerGroup = L.layerGroup();

        visibleRows.forEach((row) => {
          const emoji = TYPE_ICONS[row.type] || DEFAULT_MARKER_EMOJI;
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

          const marker = L.marker([row.lat, row.lon], {
            icon,
            facilityType: row.type,
          }).bindPopup(popupContent);

          markerGroup.addLayer(marker);
        });

        markerGroup.addTo(map);
        clusterRef.current = markerGroup;
      }

      // Send all facilities to parent
      onFacilitiesRef.current?.(
        rows.map((row) => ({
          lat: row.lat,
          lon: row.lon,
          name: row.name,
          type: row.type,
          addr_street: row.addr_street,
          addr_city: row.addr_city,
          phone: row.phone,
          website: row.website,
        })),
      );
      setLoading(false);
    },
    [map, hiddenFacilities],
  );

  useEffect(() => {
    let isMounted = true;

    const fetchPois = async () => {
      try {
        setLoading(true);
        setError(null);
        const { data, error: queryError } = await supabase
          .from("health_facilities")
          .select(
            "name, type, lat, lon, addr_street, addr_city, phone, website",
          );
        if (queryError) throw queryError;
        if (isMounted && data) {
          allFacilitiesRef.current = data;
          renderFacilities(data, currentZoom);
        }
      } catch (err) {
        if (isMounted) {
          setError(`Failed to load health facilities: ${err.message}`);
          setLoading(false);
        }
      }
    };

    fetchPois();

    return () => {
      isMounted = false;
      if (clusterRef.current && map) {
        map.removeLayer(clusterRef.current);
        clusterRef.current = null;
      }
    };
  }, [map, renderFacilities, currentZoom]);

  // Re-render when zoom or hidden facilities change
  useEffect(() => {
    if (allFacilitiesRef.current.length > 0) {
      renderFacilities(allFacilitiesRef.current, currentZoom);
    }
  }, [currentZoom, hiddenFacilities, renderFacilities]);

  return null;
}

const ROUTE_COLORS = ["#1a73e8", "#e68a00", "#c62828"];

function findBarangayForPoint(latlng, barangayData) {
  if (!barangayData) return null;
  const pt = [latlng.lng, latlng.lat];
  const match = barangayData.features.find((feature) =>
    booleanPointInPolygon(pt, feature),
  );
  if (!match) return null;
  return {
    name: match.properties.adm4_name,
    risk: match.properties.fsi_risk,
    population: match.properties.population ?? null,
  };
}

function RoutingLayer({
  facilities,
  onSelectionChange,
  onRequestLocation,
  onRequestReset,
  onRequestSearchSelect,
  filterType,
  cityBoundary,
  barangayData,
  onNearestFacilitiesFound,
  onClearHighlight,
  onLocationChange,
}) {
  const map = useMap();
  const [mode, setMode] = useState("idle");
  const [origin, setOrigin] = useState(null);
  const [results, setResults] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [outsideBoundary, setOutsideBoundary] = useState(false);
  const layerRef = useRef(null);
  const originBarangay = origin
    ? findBarangayForPoint(origin, barangayData)
    : null;

  useEffect(() => {
    onSelectionChange?.({
      mode,
      results,
      errorMsg,
      origin,
      outsideBoundary,
      originBarangay,
    });
  }, [
    mode,
    results,
    errorMsg,
    origin,
    outsideBoundary,
    originBarangay,
    onSelectionChange,
  ]);

  useEffect(() => {
    onLocationChange?.(origin);
  }, [origin, onLocationChange]);

  const isPointInsideBoundary = useCallback(
    (latlng) => {
      if (!cityBoundary) return true;
      const pt = [latlng.lng, latlng.lat];
      return booleanPointInPolygon(pt, cityBoundary);
    },
    [cityBoundary],
  );

  const runSearch = useCallback(
    async (latlng) => {
      setMode("loading");
      setErrorMsg(null);
      setOutsideBoundary(false);
      try {
        const filtered = filterType
          ? facilities.filter((f) => f.type === filterType)
          : facilities;
        if (!filtered || filtered.length === 0) {
          throw new Error(`No facilities found for type "${filterType}"`);
        }
        const originCoords = [latlng.lat, latlng.lng];
        const candidates = kNearestByHaversine(originCoords, filtered, 15);
        const ranked = await fetchRoadDistances(originCoords, candidates);
        const valid = ranked.filter((r) => r.distanceMeters != null);
        if (valid.length === 0)
          throw new Error("No reachable facility found by road");
        valid.sort((a, b) => a.distanceMeters - b.distanceMeters);
        const top = valid.slice(0, 3);
        const routes = await Promise.all(
          top.map(async (item) => {
            const route = await fetchRoadRoute(originCoords, [
              item.facility.lat,
              item.facility.lon,
            ]);
            return { ...item, routeGeoJSON: route.geometry };
          }),
        );
        setResults(routes);
        setMode("done");

        const nearestFacilities = top.map((item) => item.facility);
        onNearestFacilitiesFound?.(nearestFacilities);
      } catch (err) {
        setErrorMsg(err.message);
        setMode("error");
        onClearHighlight?.();
      }
    },
    [facilities, filterType, onNearestFacilitiesFound, onClearHighlight],
  );

  const handleNewOrigin = useCallback(
    (latlng) => {
      if (mode === "loading") return;
      if (!isPointInsideBoundary(latlng)) {
        setOutsideBoundary(true);
        setOrigin(latlng);
        setErrorMsg("Location is outside Zamboanga City boundary.");
        onClearHighlight?.();
        return;
      }
      setOutsideBoundary(false);
      setOrigin(latlng);
      runSearch(latlng);
    },
    [mode, isPointInsideBoundary, runSearch, onClearHighlight],
  );

  const clearLocation = useCallback(() => {
    setOrigin(null);
    setResults([]);
    setMode("idle");
    setErrorMsg(null);
    setOutsideBoundary(false);
    onClearHighlight?.();
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    // Reset map view to default
    map.setView([7.0736, 122.01], 10);
  }, [map, onClearHighlight]);

  const centerLocation = useCallback(() => {
    if (origin) {
      map.setView([origin.lat, origin.lng], 14);
    }
  }, [origin, map]);

  useMapEvents({
    click(e) {
      handleNewOrigin(e.latlng);
    },
  });

  const handleUseMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setErrorMsg("Geolocation not supported by this browser");
      setMode("error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        handleNewOrigin({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        let message = err.message;
        if (err.code === 1) {
          message =
            "Location permission was denied. You can still click the map directly to find the nearest facility.";
        } else if (err.code === 2) {
          message =
            "Your location couldn't be determined. Check that Location Services are enabled for your browser, or click the map directly instead.";
        } else if (err.code === 3) {
          message =
            "Location request timed out. Try again, or click the map directly.";
        }
        setErrorMsg(message);
        setMode("error");
        onClearHighlight?.();
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  }, [handleNewOrigin, onClearHighlight]);

  const resetOutsideBoundary = useCallback(() => {
    setOutsideBoundary(false);
  }, []);

  useEffect(() => {
    onRequestLocation?.(handleUseMyLocation);
  }, [handleUseMyLocation, onRequestLocation]);

  useEffect(() => {
    onRequestReset?.(resetOutsideBoundary);
  }, [resetOutsideBoundary, onRequestReset]);

  useEffect(() => {
    onRequestSearchSelect?.(handleNewOrigin);
  }, [handleNewOrigin, onRequestSearchSelect]);

  useEffect(() => {
    if (origin && mode !== "loading") {
      runSearch(origin);
    }
  }, [filterType]);

  useEffect(() => {
    if (!origin) {
      onClearHighlight?.();
    }
  }, [origin, onClearHighlight]);

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

    const bounds = L.latLngBounds([origin.lat, origin.lng]);

    results.forEach((item, index) => {
      const color = ROUTE_COLORS[index] || "#9e9e9e";
      const facilityLatLng = [item.facility.lat, item.facility.lon];
      bounds.extend(facilityLatLng);

      L.marker(facilityLatLng, {
        icon: L.divIcon({
          html: `<div style="font-size:20px; background:${color}; color:white; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; font-weight:bold; box-shadow: 0 0 4px rgba(0,0,0,0.3);">${index + 1}</div>`,
          iconSize: [24, 24],
          className: "custom-poi-marker",
        }),
      })
        .bindPopup(
          `<strong>#${index + 1} ${item.facility.name}</strong><br>${(item.distanceMeters / 1000).toFixed(2)} km, ${Math.round(item.durationSeconds / 60)} min`,
        )
        .addTo(group);

      if (item.routeGeoJSON) {
        L.geoJSON(item.routeGeoJSON, {
          style: { color, weight: 5, opacity: 0.9 },
        }).addTo(group);
      }
    });

    group.addTo(map);
    layerRef.current = group;

    if (results.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    } else {
      map.setView([origin.lat, origin.lng], 14);
    }

    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current);
    };
  }, [origin, results, map]);

  return null;
}

function ZamboangaMask({ onBoundaryLoaded, onBarangaysLoaded }) {
  const map = useMap();

  useEffect(() => {
    let maskLayer, borderLayer, barangayLayer;

    Promise.all([
      fetch("/zamboanga_city_boundary.geojson").then((r) => r.json()),
      fetch("/zamboanga_city_barangays.geojson").then((r) => r.json()),
      fetchBarangayPopulations(),
    ]).then(([cityData, barangayData, popMap]) => {
      const feature = cityData.features[0];
      onBoundaryLoaded?.(feature);

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

      let unmatchedCount = 0;
      const featuresWithRisk = barangayData.features.map((feature) => {
        const barangayName = feature.properties.adm4_name || "";
        let population = null;
        for (const key of buildNameKeys(barangayName)) {
          if (popMap.has(key)) {
            population = popMap.get(key);
            break;
          }
        }
        if (population == null) unmatchedCount += 1;
        return {
          ...feature,
          properties: {
            ...feature.properties,
            fsi_risk: getRandomRiskLevel(),
            population,
          },
        };
      });

      if (unmatchedCount > 0) {
        console.warn(
          `Population data: ${unmatchedCount} barangay(s) had no match in the PSA spreadsheet — check for name spelling differences.`,
        );
      }

      const updatedBarangayData = {
        ...barangayData,
        features: featuresWithRisk,
      };

      onBarangaysLoaded?.(updatedBarangayData);

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
          const population = feature.properties.population;
          const populationLine =
            population != null
              ? `Population: ${population.toLocaleString()}`
              : "Population: N/A";

          layer.bindTooltip(
            `${name}<br><strong>FSI: ${risk}</strong><br>${populationLine}`,
            {
              permanent: false,
              direction: "center",
              className: "barangay-label",
              sticky: true,
              interactive: true,
            },
          );

          let longPressTimer = null;
          let isLongPress = false;
          let clickOpened = false;

          layer.on("mouseover", function () {
            this.setStyle({ fillOpacity: 0.6, weight: 2 });
            if (!isLongPress && !clickOpened) {
              this.openTooltip();
            }
          });

          layer.on("mouseout", function () {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
            this.setStyle({ fillOpacity: 0.35, weight: 1 });
            if (!clickOpened) {
              this.closeTooltip();
            }
            isLongPress = false;
          });

          layer.on("mousedown", function (e) {
            clickOpened = false;
            isLongPress = false;
            if (e.originalEvent) {
              e.originalEvent.preventDefault();
            }
            longPressTimer = setTimeout(() => {
              isLongPress = true;
              this.closeTooltip();
              clickOpened = false;
            }, 400);
          });

          layer.on("mouseup", function (e) {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
            if (!isLongPress) {
              const tooltip = this.getTooltip();
              if (tooltip) {
                if (tooltip.isOpen()) {
                  this.closeTooltip();
                  clickOpened = false;
                } else {
                  this.openTooltip();
                  clickOpened = true;
                }
              }
            }
            isLongPress = false;
          });

          layer.on("contextmenu", function (e) {
            if (e.originalEvent) {
              e.originalEvent.preventDefault();
            }
            this.closeTooltip();
            clickOpened = false;
            isLongPress = true;
          });

          layer.on("click", function (e) {
            const tooltip = this.getTooltip();
            if (tooltip) {
              if (tooltip.isOpen()) {
                this.closeTooltip();
                clickOpened = false;
              } else {
                this.openTooltip();
                clickOpened = true;
              }
            }
          });
        },
      }).addTo(map);
    });

    return () => {
      if (maskLayer) map.removeLayer(maskLayer);
      if (borderLayer) map.removeLayer(borderLayer);
      if (barangayLayer) map.removeLayer(barangayLayer);
    };
  }, [map, onBoundaryLoaded, onBarangaysLoaded]);

  return null;
}

const FloodMap = forwardRef(function FloodMap(
  {
    onSelectionChange,
    onRequestLocation,
    onRequestReset,
    filterType,
    onCityBoundaryLoaded,
  },
  ref,
) {
  const position = [7.0736, 122.01];
  const [facilities, setFacilities] = useState([]);
  const [cityBoundary, setCityBoundary] = useState(null);
  const [barangayData, setBarangayData] = useState(null);
  const [hiddenFacilities, setHiddenFacilities] = useState([]);
  const [hasLocation, setHasLocation] = useState(false);
  const searchSelectRef = useRef(null);
  const clearLocationRef = useRef(null);
  const centerLocationRef = useRef(null);

  const handleBoundaryLoaded = useCallback(
    (feature) => {
      setCityBoundary(feature);
      onCityBoundaryLoaded?.(feature);
    },
    [onCityBoundaryLoaded],
  );

  const handleBarangaysLoaded = useCallback((data) => {
    setBarangayData(data);
  }, []);

  const handleRequestSearchSelect = useCallback((fn) => {
    searchSelectRef.current = fn;
  }, []);

  const handleNearestFacilitiesFound = useCallback(
    (nearestFacilities) => {
      const allFacilities = facilities;
      const nearestIds = new Set(
        nearestFacilities.map((f) => `${f.lat},${f.lon}`),
      );
      const toHide = allFacilities.filter(
        (f) => !nearestIds.has(`${f.lat},${f.lon}`),
      );
      setHiddenFacilities(toHide);
    },
    [facilities],
  );

  const handleClearHighlight = useCallback(() => {
    setHiddenFacilities([]);
  }, []);

  const handleLocationChange = useCallback((location) => {
    setHasLocation(!!location);
  }, []);

  const handleLocate = useCallback(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          searchSelectRef.current?.({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
        },
        (err) => {
          console.warn("Geolocation error:", err.message);
        },
        { timeout: 10000, maximumAge: 60000 },
      );
    }
  }, []);

  const handleClear = useCallback(() => {
    if (clearLocationRef.current) {
      clearLocationRef.current();
    }
  }, []);

  const handleCenter = useCallback(() => {
    if (centerLocationRef.current) {
      centerLocationRef.current();
    }
  }, []);

  useImperativeHandle(ref, () => ({
    searchLocation: (latlng) => {
      searchSelectRef.current?.(latlng);
    },
    clearHighlight: () => {
      setHiddenFacilities([]);
    },
    clearLocation: () => {
      if (clearLocationRef.current) {
        clearLocationRef.current();
      }
    },
    centerLocation: () => {
      if (centerLocationRef.current) {
        centerLocationRef.current();
      }
    },
  }));

  const handleSelectionChange = useCallback(
    (data) => {
      onSelectionChange?.(data);
    },
    [onSelectionChange],
  );

  // Set up refs for clear and center functions
  const handleRoutingLayerMount = useCallback((clearFn, centerFn) => {
    clearLocationRef.current = clearFn;
    centerLocationRef.current = centerFn;
  }, []);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
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
        .search-item:last-child {
          border-bottom: none;
        }
        .search-item:hover {
          background: #f2f2f2;
        }
        .leaflet-tooltip {
          pointer-events: auto !important;
        }
        .leaflet-control-container .leaflet-bottom .leaflet-right {
          display: flex !important;
          flex-direction: row !important;
          gap: 8px !important;
          margin-bottom: 20px !important;
        }
        .leaflet-control-container .leaflet-bottom .leaflet-right .leaflet-control {
          margin: 0 !important;
        }
        .custom-cluster-icon {
          background: transparent !important;
          border: none !important;
        }
        .custom-cluster-icon div {
          background: transparent !important;
          border: none !important;
        }
        .marker-cluster {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
        }
        .marker-cluster div {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
        }
      `}</style>
      <MapContainer
        center={position}
        zoom={10}
        minZoom={10}
        maxBounds={ZAMBOANGA_BOUNDS}
        maxBoundsViscosity={1.0}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        <ZamboangaMask
          onBoundaryLoaded={handleBoundaryLoaded}
          onBarangaysLoaded={handleBarangaysLoaded}
        />
        <POILayer
          onFacilities={setFacilities}
          hiddenFacilities={hiddenFacilities}
        />
        <RoutingLayer
          facilities={facilities}
          onSelectionChange={handleSelectionChange}
          onRequestLocation={onRequestLocation}
          onRequestReset={onRequestReset}
          onRequestSearchSelect={handleRequestSearchSelect}
          filterType={filterType}
          cityBoundary={cityBoundary}
          barangayData={barangayData}
          onNearestFacilitiesFound={handleNearestFacilitiesFound}
          onClearHighlight={handleClearHighlight}
          onLocationChange={handleLocationChange}
        />
        <MapControls
          onLocate={handleLocate}
          onClear={handleClear}
          onCenterLocation={handleCenter}
          hasLocation={hasLocation}
        />
        <LegendControl />
      </MapContainer>
    </div>
  );
});

export default FloodMap;
