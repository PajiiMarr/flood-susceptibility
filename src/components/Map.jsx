import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import * as XLSX from "xlsx";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import MarkerClusterGroup from "leaflet.markercluster";
import * as geotiff from "geotiff";
import proj4 from "proj4";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MapPin, MapPinOff, Users, Waves, Search } from "lucide-react";

export const EVACUATION_CENTER_TYPE = "Evacuation Center";

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

// Fill opacities tuned so risk colors are clearly distinguishable
const FSI_OPACITY = {
  normal: 0.6,
  hover: 0.78,
  selected: 0.88,
  borderOpacity: 0.85,
};

const ROUTE_COLORS = ["#1a73e8", "#e68a00", "#c62828"];

const FSI_MESSAGES = {
  "Very High Risk":
    "This area has a very high flood susceptibility. Expect severe and frequent flooding risk — prepare an evacuation plan and avoid low-lying routes during heavy rain.",
  "High Risk":
    "This area has a high flood susceptibility. Flooding is likely during heavy or prolonged rainfall — stay alert to local advisories.",
  "Medium Risk":
    "This area has a moderate flood susceptibility. Flooding is possible under sustained heavy rainfall, but less frequent than higher-risk zones.",
  "Low Risk":
    "This area has a low flood susceptibility. Flooding is unlikely under typical conditions, though extreme weather can still pose some risk.",
};

const FSI_COLORS = {
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
const OVERPASS_BASE = "https://overpass-api.de/api/interpreter";
const DEFAULT_VIEWBOX = "121.85,7.30,122.20,6.85";
const MARITIME_BOUNDARY_CACHE_KEY = "zc_maritime_boundary_v1";
const MARITIME_BOUNDARY_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const POPULATION_XLSX_URL =
  "https://xflhynxdadwlrloxiogv.supabase.co/storage/v1/object/public/fsi-bucket/SOCIO%20DEMOGRAPHIC%20DATAS/Region-IX_0.xlsx";

const TILE_SERVER_BASE =
  import.meta.env.VITE_TILE_SERVER_URL || "http://localhost:4001";

function buildTilePath(relativePath) {
  const encoded = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${TILE_SERVER_BASE}/${encoded}`;
}

proj4.defs("EPSG:32651", "+proj=utm +zone=51 +datum=WGS84 +units=m +no_defs");

function utmToLatLng(easting, northing) {
  const [lng, lat] = proj4("EPSG:32651", "EPSG:4326", [easting, northing]);
  return { lat, lng };
}

function projectRingToPixels(ring, bbox, width, height) {
  const [west, south, east, north] = bbox;
  return ring.map(([lng, lat]) => {
    const [x, y] = proj4("EPSG:4326", "EPSG:32651", [lng, lat]);
    const col = ((x - west) / (east - west)) * width;
    const row = ((north - y) / (north - south)) * height;
    return [col, row];
  });
}

function getClipRingsFromBoundary(boundaryFeature, bbox, width, height) {
  if (!boundaryFeature?.geometry) return [];
  const geom = boundaryFeature.geometry;
  const polygons =
    geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
  const rings = [];
  polygons.forEach((polygon) => {
    polygon.forEach((ring) => {
      rings.push(projectRingToPixels(ring, bbox, width, height));
    });
  });
  return rings;
}

function getRasterValueAtLatLng(latlng, info) {
  const { values, width, height, bbox, noDataValue } = info;
  const [west, south, east, north] = bbox;
  const [x, y] = proj4("EPSG:4326", "EPSG:32651", [latlng.lng, latlng.lat]);
  if (x < west || x > east || y < south || y > north) return null;
  const col = Math.floor(((x - west) / (east - west)) * width);
  const row = Math.floor(((north - y) / (north - south)) * height);
  if (col < 0 || col >= width || row < 0 || row >= height) return null;
  const idx = row * width + col;
  const value = values[idx];
  if (value == null || Number.isNaN(value)) return null;
  if (noDataValue != null && value === noDataValue) return null;
  return value;
}

const QGIS_LAYER_CONFIGS = {
  dem: {
    name: "Digital Elevation Model",
    path: buildTilePath(
      "FOR TRAINING/TOPOGRAPHIC DATAS/qgis/Zamboanga_DEM.tif",
    ),
    colorScale: "terrain",
    opacity: 0.8,
    previewColor: "#4CAF50",
    description: "Terrain elevation data",
    unit: " m",
  },
  dem_filled: {
    name: "Filled DEM",
    path: buildTilePath(
      "FOR TRAINING/TOPOGRAPHIC DATAS/qgis/Zamboanga_DEM_Filled.tiff",
    ),
    colorScale: "terrain",
    opacity: 0.8,
    previewColor: "#8BC34A",
    description: "Sink-filled elevation model",
    unit: " m",
  },
  slope: {
    name: "Slope",
    path: buildTilePath(
      "FOR TRAINING/TOPOGRAPHIC DATAS/qgis/Zamboanga_Slope.tiff",
    ),
    colorScale: "slope",
    opacity: 0.8,
    previewColor: "#FF9800",
    description: "Terrain steepness",
    unit: "°",
  },
  aspect: {
    name: "Aspect",
    path: buildTilePath(
      "FOR TRAINING/TOPOGRAPHIC DATAS/qgis/Zamboanga_Aspect.tiff",
    ),
    colorScale: "hsv",
    opacity: 0.8,
    previewColor: "#9C27B0",
    description: "Slope direction",
    unit: "°",
  },
  twi: {
    name: "Topographic Wetness Index",
    path: buildTilePath(
      "FOR TRAINING/TOPOGRAPHIC DATAS/qgis/Zamboanga_TWI.tif",
    ),
    colorScale: "blues",
    opacity: 0.8,
    previewColor: "#2196F3",
    description: "Soil moisture potential",
    unit: "",
  },
  hand: {
    name: "Height Above Nearest Drainage",
    path: buildTilePath(
      "FOR TRAINING/TOPOGRAPHIC DATAS/qgis/Zamboanga_HAND.tif",
    ),
    colorScale: "reds",
    opacity: 0.8,
    previewColor: "#F44336",
    description: "Flood depth proxy",
    unit: " m",
  },
  flow_accumulation: {
    name: "Flow Accumulation",
    path: buildTilePath(
      "FOR TRAINING/TOPOGRAPHIC DATAS/qgis/Zamboanga_Flow_Accumulation.tif",
    ),
    colorScale: "blues",
    opacity: 0.8,
    previewColor: "#00BCD4",
    description: "Water concentration areas",
    unit: " cells",
  },
  flow_accumulation_log: {
    name: "Flow Accumulation (Log)",
    path: buildTilePath(
      "FOR TRAINING/TOPOGRAPHIC DATAS/qgis/Zamboanga_Flow_Accumulation_Log.tif",
    ),
    colorScale: "blues",
    opacity: 0.8,
    previewColor: "#26C6DA",
    description: "Log-transformed flow",
    unit: "",
  },
  chirps: {
    name: "CHIRPS Rainfall",
    path: buildTilePath(
      "FOR TRAINING/CLIMATIC DATAS/qgis/Zamboanga_CHIRPS_Resampled.tiff",
    ),
    colorScale: "rainbow",
    opacity: 0.8,
    previewColor: "#E91E63",
    description: "Rainfall data",
    unit: " mm",
  },
  river_network: {
    name: "River Network",
    path: buildTilePath(
      "FOR TRAINING/HYDROLOGICAL DATAS/qgis/Zamboanga_River_Network.tiff",
    ),
    colorScale: "blues",
    opacity: 0.8,
    previewColor: "#1565C0",
    description: "River/stream network",
    unit: "",
  },
  drainage_density: {
    name: "Drainage Density",
    path: buildTilePath(
      "FOR TRAINING/HYDROLOGICAL DATAS/qgis/Zamboanga_Drainage_Density.tiff",
    ),
    colorScale: "greens",
    opacity: 0.8,
    previewColor: "#2E7D32",
    description: "Stream frequency",
    unit: " km/km²",
  },
  distance_to_river: {
    name: "Distance to River",
    path: buildTilePath(
      "FOR TRAINING/HYDROLOGICAL DATAS/qgis/Zamboanga_Distance_to_river.tiff",
    ),
    colorScale: "purples",
    opacity: 0.8,
    previewColor: "#6A1B9A",
    description: "Proximity to water bodies",
    unit: " m",
  },
  rivers_raster: {
    name: "Rivers Raster",
    path: buildTilePath(
      "FOR TRAINING/HYDROLOGICAL DATAS/qgis/Zamboanga_Rivers_Rasters.tif",
    ),
    colorScale: "blues",
    opacity: 0.8,
    previewColor: "#0D47A1",
    description: "Rasterized rivers",
    unit: "",
  },
};

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

async function fetchZamboangaMaritimeBoundary() {
  try {
    const cached = localStorage.getItem(MARITIME_BOUNDARY_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (
        parsed?.fetchedAt &&
        Date.now() - parsed.fetchedAt < MARITIME_BOUNDARY_CACHE_MS &&
        parsed.geojson
      ) {
        return parsed.geojson;
      }
    }
  } catch {}

  try {
    const query = `
      [out:json][timeout:60];
      relation["type"="boundary"]["boundary"="administrative"]["admin_level"="6"]["name"="Zamboanga City"]->.city;
      way(r.city);
      out tags geom;
    `;
    const res = await fetch(OVERPASS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`Overpass request failed: ${res.status}`);
    const data = await res.json();
    const ways = data.elements || [];

    const seaWays = ways.filter(
      (w) =>
        w.type === "way" &&
        Array.isArray(w.geometry) &&
        w.geometry.length > 1 &&
        w.tags?.natural !== "coastline",
    );

    const geojson = {
      type: "FeatureCollection",
      features: seaWays.map((w) => ({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: w.geometry.map((pt) => [pt.lon, pt.lat]),
        },
      })),
    };

    try {
      localStorage.setItem(
        MARITIME_BOUNDARY_CACHE_KEY,
        JSON.stringify({ fetchedAt: Date.now(), geojson }),
      );
    } catch {}

    return geojson;
  } catch (err) {
    console.warn("Maritime boundary load failed:", err.message);
    return { type: "FeatureCollection", features: [] };
  }
}

async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
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
  if (specific && city && specific !== city) return `${specific}, ${city}`;
  return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function LegendControl() {
  const map = useMap();
  useEffect(() => {
    const legend = L.control({ position: "topright" });
    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "info legend");
      div.style.backgroundColor = "rgba(255,255,255,0.9)";
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

function MapControls({ onLocate, onClear, hasLocation, onCenterLocation }) {
  const map = useMap();

  useEffect(() => {
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

      const locateBtn = document.createElement("button");
      locateBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" style="pointer-events: none;">
          <path fill="#444" d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
        </svg>
      `;
      locateBtn.style.cssText = `
        background: none; border: none; padding: 8px 10px;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s; border-bottom: 1px solid #e0e0e0;
        width: 100%; position: relative; cursor: pointer;
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

      const centerBtn = document.createElement("button");
      centerBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" style="pointer-events: none;">
          <path fill="#444" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      `;
      centerBtn.style.cssText = `
        background: none; border: none; padding: 8px 10px;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s; border-bottom: 1px solid #e0e0e0;
        width: 100%; cursor: pointer;
        opacity: ${hasLocation ? "1" : "0.4"};
        pointer-events: ${hasLocation ? "auto" : "none"};
      `;
      centerBtn.title = "Center on location";
      centerBtn.addEventListener("mouseenter", () => {
        if (hasLocation) centerBtn.style.backgroundColor = "#f0f0f0";
      });
      centerBtn.addEventListener("mouseleave", () => {
        centerBtn.style.backgroundColor = "transparent";
      });
      centerBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (hasLocation) onCenterLocation?.();
      });

      const clearBtn = document.createElement("button");
      clearBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" style="pointer-events: none;">
          <path fill="#444" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      `;
      clearBtn.style.cssText = `
        background: none; border: none; padding: 8px 10px;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s; width: 100%; cursor: pointer;
        opacity: ${hasLocation ? "1" : "0.4"};
        pointer-events: ${hasLocation ? "auto" : "none"};
      `;
      clearBtn.title = "Clear location";
      clearBtn.addEventListener("mouseenter", () => {
        if (hasLocation) clearBtn.style.backgroundColor = "#f0f0f0";
      });
      clearBtn.addEventListener("mouseleave", () => {
        clearBtn.style.backgroundColor = "transparent";
      });
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (hasLocation) onClear?.();
      });

      container.appendChild(locateBtn);
      container.appendChild(centerBtn);
      container.appendChild(clearBtn);
      return container;
    };

    control.addTo(map);

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
        background: none; border: none; padding: 6px 10px;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s; border-bottom: 1px solid #e0e0e0;
        width: 100%; cursor: pointer;
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
        background: none; border: none; padding: 6px 10px;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s; width: 100%; cursor: pointer;
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

    return () => {
      control.remove();
      zoomControl.remove();
    };
  }, [map, onLocate, onClear, hasLocation, onCenterLocation]);

  return null;
}

function MapModeControl({ mode, onModeChange }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    L.DomEvent.disableClickPropagation(containerRef.current);
    L.DomEvent.disableScrollPropagation(containerRef.current);
  }, []);

  const baseBtnStyle = {
    padding: "7px 14px",
    fontSize: "12px",
    fontFamily: "Arial, sans-serif",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    transition: "all 0.15s ease",
    whiteSpace: "nowrap",
  };

  const activeStyle = {
    ...baseBtnStyle,
    backgroundColor: "#1a73e8",
    color: "#ffffff",
    fontWeight: "600",
    boxShadow: "0 1px 4px rgba(26,115,232,0.4)",
  };

  const inactiveStyle = {
    ...baseBtnStyle,
    backgroundColor: "transparent",
    color: "#444",
    fontWeight: "500",
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2000,
        backgroundColor: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderRadius: "8px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        padding: "4px",
        display: "flex",
        gap: "4px",
        border: "1px solid rgba(255,255,255,0.4)",
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={() => onModeChange("marker")}
        style={mode === "marker" ? activeStyle : inactiveStyle}
        title="Click the map to find nearest facilities"
      >
        Marker Mode
      </button>
      <button
        type="button"
        onClick={() => onModeChange("barangay")}
        style={mode === "barangay" ? activeStyle : inactiveStyle}
        title="Click a barangay to view its details"
      >
        Barangay Mode
      </button>
    </div>
  );
}

function MapSearchControl({ cityBoundary, onSelectLocation }) {
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
    if (!containerRef.current) return;
    L.DomEvent.disableClickPropagation(containerRef.current);
    L.DomEvent.disableScrollPropagation(containerRef.current);
  }, []);

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
    } catch {
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
      style={{
        position: "absolute",
        top: "16px",
        left: "16px",
        zIndex: 2000,
        width: "320px",
        maxWidth: "calc(100% - 32px)",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          position: "relative",
          background: "rgba(255, 255, 255, 0.75)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: "10px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
          border: "1px solid rgba(255,255,255,0.5)",
          padding: "6px",
        }}
      >
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Search a place in Zamboanga City…"
            value={query}
            onChange={handleInputChange}
            onFocus={() => {
              if (results.length > 0) setShowResults(true);
            }}
            className="pl-8 h-9 text-sm bg-white/70 border-white/60 focus-visible:bg-white/95 focus-visible:ring-1 focus-visible:ring-primary/40 placeholder:text-muted-foreground/70"
          />
        </div>

        {showResults && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              background: "rgba(255, 255, 255, 0.95)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              borderRadius: "10px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
              border: "1px solid rgba(255,255,255,0.5)",
              maxHeight: "260px",
              overflowY: "auto",
            }}
          >
            {loading ? (
              <div className="px-3 py-2.5 text-xs text-muted-foreground">
                Searching…
              </div>
            ) : results.length === 0 ? (
              <div className="px-3 py-2.5 text-xs text-muted-foreground">
                No results found
              </div>
            ) : (
              results.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelect(item)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-primary/5 active:bg-primary/10 transition-colors border-b border-black/5 last:border-b-0"
                >
                  {item.display_name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
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

  useEffect(() => {
    const handleZoomEnd = () => setCurrentZoom(map.getZoom());
    map.on("zoomend", handleZoomEnd);
    return () => map.off("zoomend", handleZoomEnd);
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

      const shouldCluster = zoomLevel < 13;

      if (shouldCluster) {
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

      setLoading(false);
    },
    [map, hiddenFacilities],
  );

  const renderFacilitiesRef = useRef(renderFacilities);
  useEffect(() => {
    renderFacilitiesRef.current = renderFacilities;
  }, [renderFacilities]);

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
          onFacilitiesRef.current?.(
            data.map((row) => ({
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
          renderFacilitiesRef.current?.(data, map.getZoom());
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
  }, [map]);

  useEffect(() => {
    if (allFacilitiesRef.current.length > 0) {
      renderFacilities(allFacilitiesRef.current, currentZoom);
    }
  }, [currentZoom, hiddenFacilities, renderFacilities]);

  return null;
}

function EvacuationCentersLayer({ onCentersLoaded, visible = true }) {
  const map = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentZoom, setCurrentZoom] = useState(map.getZoom());
  const clusterRef = useRef(null);
  const allCentersRef = useRef([]);
  const onCentersLoadedRef = useRef(onCentersLoaded);
  const visibleRef = useRef(visible);
  const [renderTick, setRenderTick] = useState(0);

  useEffect(() => {
    visibleRef.current = visible;
    setRenderTick((t) => t + 1);
  }, [visible]);

  useEffect(() => {
    onCentersLoadedRef.current = onCentersLoaded;
  }, [onCentersLoaded]);

  useEffect(() => {
    const handleZoomEnd = () => setCurrentZoom(map.getZoom());
    map.on("zoomend", handleZoomEnd);
    return () => map.off("zoomend", handleZoomEnd);
  }, [map]);

  const makePopupHtml = (row) => `
    <div style="min-width: 210px; font-family: Arial, sans-serif; font-size: 12px; line-height: 1.5;">
      <strong style="font-size: 13px;">${row.name}</strong><br>
      <span style="color:#555;">District: ${row.district || "N/A"}</span><br>
      ${row.location ? `Location: ${row.location}<br>` : ""}
      ${row.proximity ? `Proximity: ${row.proximity}<br>` : ""}
      ${row.floor_area_sqm != null ? `Floor area: ${row.floor_area_sqm} sqm<br>` : ""}
      ${row.remarks ? `<em style="color:#b00020;">${row.remarks}</em><br>` : ""}
      <span style="font-size:10px; color:#999;">Center No. ${row.center_no}</span>
    </div>
  `;

  const makeMarkerIcon = () =>
    L.divIcon({
      html: `<div style="font-size:22px; line-height:22px; text-shadow:0 0 3px #fff, 0 0 2px #fff;">⛺</div>`,
      iconSize: [24, 24],
      className: "custom-evac-marker",
    });

  const renderCenters = useCallback(
    (rows, zoomLevel) => {
      if (!map) return;

      if (clusterRef.current) {
        map.removeLayer(clusterRef.current);
        clusterRef.current = null;
      }

      if (!visibleRef.current) {
        setLoading(false);
        return;
      }

      const valid = rows
        .map((r) => ({
          ...r,
          latitude: r.latitude == null ? null : Number(r.latitude),
          longitude: r.longitude == null ? null : Number(r.longitude),
        }))
        .filter(
          (r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude),
        );

      const skipped = rows.length - valid.length;
      if (skipped > 0) {
        console.warn(
          `Evacuation centers: ${skipped} row(s) skipped — missing lat/lng (likely marked "To be updated").`,
        );
      }

      if (valid.length === 0) {
        setLoading(false);
        return;
      }

      const shouldCluster = zoomLevel < 13;

      if (shouldCluster) {
        const clusterGroup = L.markerClusterGroup({
          maxClusterRadius: 45,
          iconCreateFunction: function (cluster) {
            const count = cluster.getChildCount();
            const size = 34 + Math.min(20, count);
            const div = document.createElement("div");
            div.style.cssText = `
              width:${size}px; height:${size}px;
              display:flex; align-items:center; justify-content:center;
              background:#d32f2f; color:#fff; font-weight:bold;
              font-family: Arial, sans-serif; font-size:13px;
              border-radius:50%; border:2px solid #fff;
              box-shadow:0 1px 4px rgba(0,0,0,0.4);
            `;
            div.innerHTML = `⛺<span style="font-size:11px; margin-left:2px;">${count}</span>`;
            return L.divIcon({
              html: div.outerHTML,
              iconSize: [size, size],
              className: "custom-cluster-icon",
            });
          },
        });

        valid.forEach((row) => {
          L.marker([row.latitude, row.longitude], { icon: makeMarkerIcon() })
            .bindPopup(makePopupHtml(row))
            .addTo(clusterGroup);
        });

        clusterGroup.addTo(map);
        clusterRef.current = clusterGroup;
      } else {
        const group = L.layerGroup();
        valid.forEach((row) => {
          L.marker([row.latitude, row.longitude], { icon: makeMarkerIcon() })
            .bindPopup(makePopupHtml(row))
            .addTo(group);
        });
        group.addTo(map);
        clusterRef.current = group;
      }

      setLoading(false);
    },
    [map],
  );

  const renderCentersRef = useRef(renderCenters);
  useEffect(() => {
    renderCentersRef.current = renderCenters;
  }, [renderCenters]);

  useEffect(() => {
    let isMounted = true;

    const fetchCenters = async () => {
      try {
        setLoading(true);
        setError(null);
        const { data, error: queryError } = await supabase
          .from("evacuation_centers")
          .select(
            "id, center_no, district, name, location, proximity, floor_area_sqm, remarks, latitude, longitude",
          );
        if (queryError) throw queryError;
        if (isMounted && data) {
          allCentersRef.current = data;
          onCentersLoadedRef.current?.(data);
          renderCentersRef.current?.(data, map.getZoom());
        }
      } catch (err) {
        if (isMounted) {
          setError(`Failed to load evacuation centers: ${err.message}`);
          setLoading(false);
        }
      }
    };

    fetchCenters();

    return () => {
      isMounted = false;
      if (clusterRef.current && map) {
        map.removeLayer(clusterRef.current);
        clusterRef.current = null;
      }
    };
  }, [map]);

  useEffect(() => {
    if (allCentersRef.current.length > 0) {
      renderCenters(allCentersRef.current, currentZoom);
    }
  }, [currentZoom, renderCenters, renderTick]);

  return null;
}

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

function evacCenterToFacility(c) {
  const lat = c.latitude == null ? NaN : Number(c.latitude);
  const lon = c.longitude == null ? NaN : Number(c.longitude);
  return {
    lat,
    lon,
    name: c.name,
    type: EVACUATION_CENTER_TYPE,
    addr_street: c.location || null,
    addr_city: c.district || null,
    phone: null,
    website: null,
    _evac: c,
  };
}

function RoutingLayer({
  facilities,
  evacuationCenters,
  onSelectionChange,
  onRequestLocation,
  onRequestReset,
  onRequestSearchSelect,
  onRequestClear,
  onRequestCenter,
  selectedTypes,
  cityBoundary,
  barangayData,
  onNearestFacilitiesFound,
  onClearHighlight,
  onLocationChange,
  mapMode,
  onBarangaySelect,
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

  const mapModeRef = useRef(mapMode);
  useEffect(() => {
    mapModeRef.current = mapMode;
  }, [mapMode]);

  const barangayDataRef = useRef(barangayData);
  useEffect(() => {
    barangayDataRef.current = barangayData;
  }, [barangayData]);

  const onBarangaySelectRef = useRef(onBarangaySelect);
  useEffect(() => {
    onBarangaySelectRef.current = onBarangaySelect;
  }, [onBarangaySelect]);

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
        const evacAsFacility = (evacuationCenters || [])
          .map(evacCenterToFacility)
          .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon));

        const activeTypes = selectedTypes || [];
        const healthTypes = activeTypes.filter(
          (t) => t !== EVACUATION_CENTER_TYPE,
        );
        const evacSelected = activeTypes.includes(EVACUATION_CENTER_TYPE);

        let filtered;

        if (activeTypes.length === 0) {
          filtered = [...(facilities || []), ...evacAsFacility];
        } else {
          const parts = [];
          if (healthTypes.length > 0) {
            parts.push(
              ...(facilities || []).filter((f) => healthTypes.includes(f.type)),
            );
          }
          if (evacSelected) {
            parts.push(...evacAsFacility);
          }
          filtered = parts;
        }

        if (filtered.length === 0) {
          const names =
            activeTypes.length === 0 ? "facilities" : activeTypes.join(", ");
          throw new Error(`No matching ${names} available`);
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
    [
      facilities,
      evacuationCenters,
      selectedTypes,
      onNearestFacilitiesFound,
      onClearHighlight,
    ],
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
    map.setView([7.0736, 122.01], 10);
  }, [map, onClearHighlight]);

  const centerLocation = useCallback(() => {
    if (origin) {
      map.setView([origin.lat, origin.lng], 14);
    }
  }, [origin, map]);

  useMapEvents({
    click(e) {
      if (mapModeRef.current === "barangay") {
        const b = findBarangayForPoint(e.latlng, barangayDataRef.current);
        if (b) {
          onBarangaySelectRef.current?.(b);
        }
        return;
      }
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
    onRequestClear?.(clearLocation);
  }, [clearLocation, onRequestClear]);

  useEffect(() => {
    onRequestCenter?.(centerLocation);
  }, [centerLocation, onRequestCenter]);

  const includesEvac =
    selectedTypes.length === 0 ||
    selectedTypes.includes(EVACUATION_CENTER_TYPE);

  useEffect(() => {
    if (!origin) return;
    if (includesEvac && evacuationCenters.length === 0) return;
    runSearch(origin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTypes, evacuationCenters]);

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

    const bounds = L.latLngBounds(
      [origin.lat, origin.lng],
      [origin.lat, origin.lng],
    );

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
      map.fitBounds(bounds, {
        padding: [50, 50],
        maxZoom: 15,
        animate: true,
        duration: 0.5,
      });
    } else {
      map.setView([origin.lat, origin.lng], 14);
    }

    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current);
    };
  }, [origin, results, map]);

  return null;
}

function ZamboangaMask({
  onBoundaryLoaded,
  onBarangaysLoaded,
  hideFSI,
  mapMode,
  selectedBarangayName,
}) {
  const map = useMap();
  const barangayLayerRef = useRef(null);
  const maskLayerRef = useRef(null);
  const borderLayerRef = useRef(null);
  const maritimeLayerRef = useRef(null);
  const barangayLayersByNameRef = useRef({});
  const prevSelectedLayerRef = useRef(null);

  const hideFSIRef = useRef(hideFSI);
  useEffect(() => {
    hideFSIRef.current = hideFSI;
  }, [hideFSI]);

  const mapModeRef = useRef(mapMode);
  useEffect(() => {
    mapModeRef.current = mapMode;
  }, [mapMode]);

  useEffect(() => {
    let maskLayer, borderLayer, barangayLayer, maritimeLayer;

    Promise.all([
      fetch("/zamboanga_city_boundary.geojson").then((r) => r.json()),
      fetch("/zamboanga_city_barangays.geojson").then((r) => r.json()),
      fetchBarangayPopulations(),
      fetchZamboangaMaritimeBoundary(),
    ]).then(([cityData, barangayData, popMap, maritimeGeoJSON]) => {
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

      // Outer mask (gray outside the city) — keep light so it doesn't
      // overpower the FSI fill.
      maskLayer = L.geoJSON(maskGeoJSON, {
        style: {
          color: "transparent",
          weight: 0,
          fillColor: "#d9d9d9",
          fillOpacity: 0.12,
        },
        interactive: false,
      }).addTo(map);
      maskLayerRef.current = maskLayer;

      borderLayer = L.geoJSON(cityData, {
        style: { color: "#e8401c", weight: 2.5, opacity: 1, fill: false },
        interactive: false,
      }).addTo(map);
      borderLayerRef.current = borderLayer;

      if (maritimeGeoJSON?.features?.length) {
        maritimeLayer = L.geoJSON(maritimeGeoJSON, {
          style: {
            color: "#3388ff",
            weight: 1.5,
            opacity: 0.85,
            dashArray: "6, 6",
          },
          interactive: false,
        }).addTo(map);
        maritimeLayerRef.current = maritimeLayer;
      }

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
            opacity: FSI_OPACITY.borderOpacity,
            fillColor: RISK_LEVELS[risk] || RISK_LEVELS["Low Risk"],
            fillOpacity: FSI_OPACITY.normal,
          };
        },
        interactive: true,
        onEachFeature: (feature, layer) => {
          const name = feature.properties.adm4_name;
          const risk = feature.properties.fsi_risk;
          const population = feature.properties.population;
          barangayLayersByNameRef.current[name] = layer;

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
              interactive: false,
            },
          );

          let clickOpened = false;

          layer.on("mouseover", function () {
            if (mapModeRef.current === "barangay") {
              if (prevSelectedLayerRef.current !== this) {
                this.setStyle({
                  fillOpacity: FSI_OPACITY.hover,
                  weight: 2,
                });
              }
              return;
            }
            this.setStyle({ fillOpacity: FSI_OPACITY.hover, weight: 2 });
            if (!clickOpened) this.openTooltip();
          });

          layer.on("mouseout", function () {
            if (prevSelectedLayerRef.current === this) return;
            this.setStyle({
              fillOpacity: FSI_OPACITY.normal,
              weight: 1,
            });
            if (!clickOpened) this.closeTooltip();
          });

          layer.on("click", function () {
            if (mapModeRef.current === "barangay") return;
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
      barangayLayerRef.current = barangayLayer;
    });

    return () => {
      if (maskLayerRef.current) map.removeLayer(maskLayerRef.current);
      if (borderLayerRef.current) map.removeLayer(borderLayerRef.current);
      if (barangayLayerRef.current) map.removeLayer(barangayLayerRef.current);
      if (maritimeLayerRef.current) map.removeLayer(maritimeLayerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, onBoundaryLoaded, onBarangaysLoaded]);

  useEffect(() => {
    if (barangayLayerRef.current) {
      if (hideFSI) {
        map.removeLayer(barangayLayerRef.current);
      } else {
        map.addLayer(barangayLayerRef.current);
      }
    }
  }, [map, hideFSI]);

  useEffect(() => {
    if (prevSelectedLayerRef.current) {
      prevSelectedLayerRef.current.setStyle({
        color: "#ffffff",
        weight: 1,
        opacity: FSI_OPACITY.borderOpacity,
        fillOpacity: FSI_OPACITY.normal,
      });
      prevSelectedLayerRef.current = null;
    }

    if (!selectedBarangayName) return;
    const layer = barangayLayersByNameRef.current[selectedBarangayName];
    if (!layer) return;

    layer.setStyle({
      color: "#1a73e8",
      weight: 3,
      opacity: 1,
      fillOpacity: FSI_OPACITY.selected,
    });
    if (layer.bringToFront) layer.bringToFront();
    prevSelectedLayerRef.current = layer;

    if (layer.getBounds) {
      map.fitBounds(layer.getBounds(), {
        padding: [40, 40],
        maxZoom: 14,
        animate: true,
        duration: 0.5,
      });
    }
  }, [selectedBarangayName, map]);

  return null;
}

function QGISLayerControl({
  onLayerToggle,
  activeLayers,
  layerErrors,
  layerLoading,
}) {
  const [isOpen, setIsOpen] = useState(true);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    L.DomEvent.disableClickPropagation(containerRef.current);
    L.DomEvent.disableScrollPropagation(containerRef.current);
  }, []);

  const handleToggleLayer = (key) => {
    onLayerToggle(key);
  };

  return (
    <div
      ref={containerRef}
      className="absolute top-4 left-4 z-[1000] min-w-[160px] max-w-[220px]"
      style={{
        backgroundColor: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(6px)",
        borderRadius: "8px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        padding: "6px 0",
        border: "1px solid rgba(0,0,0,0.05)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5 cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
          <span>🗺️</span>
          Layers
          {activeLayers.length > 0 && (
            <span className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5 ml-0.5">
              {activeLayers.length}
            </span>
          )}
        </span>
        <span className="text-gray-400 text-xs">{isOpen ? "▾" : "▸"}</span>
      </div>
      {isOpen && (
        <div className="px-1.5 py-1 space-y-0.5 max-h-[320px] overflow-y-auto">
          {Object.entries(QGIS_LAYER_CONFIGS).map(([key, config]) => {
            const isActive = activeLayers.includes(key);
            const isLoading = !!layerLoading?.[key];
            const errorMsg = layerErrors?.[key];
            return (
              <div key={key}>
                <div
                  className={`
                    flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-all
                    hover:bg-gray-50
                    ${isActive ? "bg-gray-50/80" : ""}
                  `}
                  onClick={() => handleToggleLayer(key)}
                  title={errorMsg || config.description}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0 transition-all"
                    style={{
                      backgroundColor: errorMsg
                        ? "#e53935"
                        : isActive
                          ? config.previewColor
                          : "#e0e0e0",
                      boxShadow: isActive
                        ? `0 0 0 2px ${config.previewColor}33`
                        : "none",
                    }}
                  />
                  <span className="text-[11px] text-gray-700 flex-1 truncate">
                    {config.name}
                  </span>
                  <span className="text-[9px] text-gray-400">
                    {isLoading ? "⏳" : errorMsg ? "⚠️" : isActive ? "●" : "○"}
                  </span>
                </div>
                {errorMsg && (
                  <div className="px-2 pb-1 text-[9px] text-red-500 leading-tight">
                    {errorMsg}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QGISRasterLayer({
  layerKey,
  isActive,
  cityBoundary,
  onLoadingChange,
  onLoadError,
  onRasterLoaded,
}) {
  const map = useMap();
  const layerRef = useRef(null);
  const loadAttemptedRef = useRef(false);
  const isMountedRef = useRef(true);
  const cityBoundaryRef = useRef(cityBoundary);

  useEffect(() => {
    cityBoundaryRef.current = cityBoundary;
  }, [cityBoundary]);

  useEffect(() => {
    if (!map.getPane("qgis-pane")) {
      const pane = map.createPane("qgis-pane");
      pane.style.zIndex = 600;
      pane.style.pointerEvents = "none";
    }
  }, [map]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadRasterLayer = async () => {
      if (!isActive || !isMountedRef.current) {
        if (layerRef.current) {
          map.removeLayer(layerRef.current);
          layerRef.current = null;
        }
        onLoadError?.(layerKey, null);
        onRasterLoaded?.(layerKey, null);
        loadAttemptedRef.current = false;
        onLoadingChange?.(layerKey, false);
        return;
      }

      if (loadAttemptedRef.current && layerRef.current) {
        return;
      }

      const config = QGIS_LAYER_CONFIGS[layerKey];
      try {
        onLoadingChange?.(layerKey, true);
        onLoadError?.(layerKey, null);
        loadAttemptedRef.current = true;

        const response = await fetch(config.path);
        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}: ${response.statusText}. Make sure the static-data server is running at ${TILE_SERVER_BASE}`,
          );
        }

        const arrayBuffer = await response.arrayBuffer();
        const tiff = await geotiff.fromArrayBuffer(arrayBuffer);
        const image = await tiff.getImage();
        const bbox = image.getBoundingBox();
        const width = image.getWidth();
        const height = image.getHeight();
        const data = await image.readRasters();

        let noDataValue = null;
        try {
          const nd = image.getGDALNoData ? image.getGDALNoData() : null;
          if (nd !== null && nd !== undefined && !Number.isNaN(Number(nd))) {
            noDataValue = Number(nd);
          }
        } catch {
          noDataValue = null;
        }

        if (cancelled || !isMountedRef.current) return;

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const imageData = ctx.createImageData(width, height);

        const values = data[0];
        let minVal = Infinity;
        let maxVal = -Infinity;
        for (let i = 0; i < values.length; i++) {
          if (noDataValue != null && values[i] === noDataValue) continue;
          if (values[i] < minVal) minVal = values[i];
          if (values[i] > maxVal) maxVal = values[i];
        }
        const range = maxVal - minVal;

        for (let i = 0; i < values.length; i++) {
          const idx = i * 4;
          if (noDataValue != null && values[i] === noDataValue) {
            imageData.data[idx] = 0;
            imageData.data[idx + 1] = 0;
            imageData.data[idx + 2] = 0;
            imageData.data[idx + 3] = 0;
            continue;
          }
          const normalized = range > 0 ? (values[i] - minVal) / range : 0;
          const [r, g, b] = getColorRamp(normalized, config.colorScale);
          imageData.data[idx] = r;
          imageData.data[idx + 1] = g;
          imageData.data[idx + 2] = b;
          imageData.data[idx + 3] = 255;
        }

        ctx.putImageData(imageData, 0, 0);

        let outputCanvas = canvas;
        const clipRings = getClipRingsFromBoundary(
          cityBoundaryRef.current,
          bbox,
          width,
          height,
        );
        if (clipRings.length > 0) {
          const clippedCanvas = document.createElement("canvas");
          clippedCanvas.width = width;
          clippedCanvas.height = height;
          const clipCtx = clippedCanvas.getContext("2d");
          clipCtx.save();
          clipCtx.beginPath();
          clipRings.forEach((ring) => {
            ring.forEach(([x, y], i) => {
              if (i === 0) clipCtx.moveTo(x, y);
              else clipCtx.lineTo(x, y);
            });
            clipCtx.closePath();
          });
          clipCtx.clip("evenodd");
          clipCtx.drawImage(canvas, 0, 0);
          clipCtx.restore();
          outputCanvas = clippedCanvas;
        }

        const dataUrl = outputCanvas.toDataURL("image/png");

        const west = bbox[0];
        const south = bbox[1];
        const east = bbox[2];
        const north = bbox[3];

        const bottomLeft = utmToLatLng(west, south);
        const topRight = utmToLatLng(east, north);

        if (cancelled || !isMountedRef.current) return;

        if (layerRef.current) {
          map.removeLayer(layerRef.current);
          layerRef.current = null;
        }

        const overlay = L.imageOverlay(
          dataUrl,
          [
            [bottomLeft.lat, bottomLeft.lng],
            [topRight.lat, topRight.lng],
          ],
          {
            opacity: config.opacity || 0.8,
            interactive: false,
            pane: "qgis-pane",
          },
        );

        overlay.addTo(map);
        layerRef.current = overlay;

        onRasterLoaded?.(layerKey, {
          values,
          width,
          height,
          bbox,
          noDataValue,
        });

        map.fitBounds(
          [
            [bottomLeft.lat, bottomLeft.lng],
            [topRight.lat, topRight.lng],
          ],
          { padding: [50, 50] },
        );
      } catch (error) {
        console.error(`Failed to load ${layerKey} (${config.path}):`, error);
        if (!cancelled && isMountedRef.current) {
          onLoadError?.(layerKey, error.message || "Failed to load layer");
          onRasterLoaded?.(layerKey, null);
          loadAttemptedRef.current = false;
        }
      } finally {
        if (isMountedRef.current && !cancelled) {
          onLoadingChange?.(layerKey, false);
        }
      }
    };

    loadRasterLayer();

    return () => {
      cancelled = true;
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      onRasterLoaded?.(layerKey, null);
      loadAttemptedRef.current = false;
    };
  }, [map, layerKey, isActive, onLoadingChange, onLoadError, onRasterLoaded]);

  return null;
}

function QGISHoverTooltip({ rasterDataRef }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    const tooltipEl = document.createElement("div");
    tooltipEl.className = "qgis-hover-tooltip";
    tooltipEl.style.cssText = `
      position: absolute;
      z-index: 1000;
      pointer-events: none;
      background: rgba(0,0,0,0.78);
      color: #fff;
      font-size: 11px;
      font-family: Arial, sans-serif;
      padding: 6px 9px;
      border-radius: 4px;
      line-height: 1.5;
      display: none;
      white-space: nowrap;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    `;
    container.appendChild(tooltipEl);

    const formatValue = (value) => {
      const abs = Math.abs(value);
      if (abs >= 1000) return value.toFixed(0);
      if (abs >= 10) return value.toFixed(1);
      return value.toFixed(2);
    };

    const handleMouseMove = (e) => {
      const activeKeys = Object.keys(rasterDataRef.current || {});
      if (activeKeys.length === 0) {
        tooltipEl.style.display = "none";
        return;
      }

      const lines = [];
      for (const key of activeKeys) {
        const info = rasterDataRef.current[key];
        if (!info) continue;
        const value = getRasterValueAtLatLng(e.latlng, info);
        if (value == null) continue;
        const config = QGIS_LAYER_CONFIGS[key];
        const label = config?.name || key;
        const unit = config?.unit || "";
        lines.push(`<strong>${label}:</strong> ${formatValue(value)}${unit}`);
      }

      if (lines.length === 0) {
        tooltipEl.style.display = "none";
        return;
      }

      tooltipEl.innerHTML = lines.join("<br>");
      tooltipEl.style.display = "block";

      const point = map.latLngToContainerPoint(e.latlng);
      const containerWidth = container.clientWidth;
      const tooltipWidth = tooltipEl.offsetWidth;
      const left =
        point.x + 16 + tooltipWidth > containerWidth
          ? point.x - tooltipWidth - 16
          : point.x + 16;
      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top = `${point.y + 16}px`;
    };

    const handleMouseLeave = () => {
      tooltipEl.style.display = "none";
    };

    map.on("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      map.off("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);
      if (tooltipEl.parentNode) tooltipEl.parentNode.removeChild(tooltipEl);
    };
  }, [map, rasterDataRef]);

  return null;
}

function getColorRamp(value, scale) {
  switch (scale) {
    case "terrain":
      if (value < 0.2) return [34, 139, 34];
      if (value < 0.4) return [107, 142, 35];
      if (value < 0.6) return [139, 119, 101];
      if (value < 0.8) return [160, 140, 120];
      return [120, 100, 80];
    case "slope":
      if (value < 0.2) return [200, 220, 100];
      if (value < 0.4) return [255, 200, 50];
      if (value < 0.6) return [255, 150, 50];
      if (value < 0.8) return [200, 80, 50];
      return [150, 30, 30];
    case "blues":
      if (value < 0.2) return [240, 248, 255];
      if (value < 0.4) return [150, 200, 240];
      if (value < 0.6) return [70, 150, 220];
      if (value < 0.8) return [30, 100, 180];
      return [10, 50, 140];
    case "reds":
      if (value < 0.2) return [255, 240, 240];
      if (value < 0.4) return [255, 200, 200];
      if (value < 0.6) return [255, 150, 150];
      if (value < 0.8) return [220, 80, 80];
      return [180, 30, 30];
    case "greens":
      if (value < 0.2) return [240, 255, 240];
      if (value < 0.4) return [180, 220, 180];
      if (value < 0.6) return [100, 180, 100];
      if (value < 0.8) return [50, 140, 50];
      return [20, 100, 20];
    case "purples":
      if (value < 0.2) return [245, 240, 255];
      if (value < 0.4) return [200, 180, 240];
      if (value < 0.6) return [150, 120, 220];
      if (value < 0.8) return [100, 60, 180];
      return [60, 20, 140];
    case "hsv":
      return hsvToRgb(value * 0.8, 1, 1);
    case "rainbow":
      return hsvToRgb(value, 1, 1);
    default:
      const gray = Math.round(value * 255);
      return [gray, gray, gray];
  }
}

function hsvToRgb(h, s, v) {
  let r, g, b;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function QGISLayers({
  activeLayers,
  cityBoundary,
  onLoadingChange,
  onLoadError,
  onRasterLoaded,
}) {
  return (
    <>
      {activeLayers.map((key) => (
        <QGISRasterLayer
          key={key}
          layerKey={key}
          isActive={true}
          cityBoundary={cityBoundary}
          onLoadingChange={onLoadingChange}
          onLoadError={onLoadError}
          onRasterLoaded={onRasterLoaded}
        />
      ))}
    </>
  );
}

function BarangayCard({ barangay, onClear }) {
  if (!barangay) return null;
  const { name, risk, population } = barangay;
  const color = FSI_COLORS[risk] || "#9e9e9e";
  const message =
    FSI_MESSAGES[risk] ||
    "Flood susceptibility data unavailable for this area.";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Selected Barangay
            </div>
            <CardTitle className="text-base leading-tight">{name}</CardTitle>
          </div>
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex justify-between items-center border-b pb-2">
          <span className="text-muted-foreground">Flood Susceptibility</span>
          <span
            className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
            style={{ backgroundColor: color }}
          >
            {risk}
          </span>
        </div>
        <div className="flex justify-between border-b pb-2">
          <span className="text-muted-foreground">Population</span>
          <span className="font-medium">
            {population != null ? population.toLocaleString() : "N/A"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {message}
        </p>
      </CardContent>
    </Card>
  );
}

function FacilityDetailsPanel({
  selection,
  onUseMyLocation,
  facilityTypes,
  selectedTypes,
  onSelectAllTypes,
  onToggleType,
  mapMode,
  selectedBarangay,
  onClearBarangay,
}) {
  const { mode, results, errorMsg, origin, originBarangay } = selection;

  return (
    <div className="space-y-4">
      {mapMode === "barangay" ? (
        <>
          {selectedBarangay ? (
            <BarangayCard
              barangay={selectedBarangay}
              onClear={onClearBarangay}
            />
          ) : (
            <Card className="border-dashed bg-muted/50">
              <CardContent className="p-4 text-center text-sm text-muted-foreground">
                Click on a barangay on the map to view its flood susceptibility
                and population details.
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <>
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

          {facilityTypes.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Facility Type{" "}
                  {selectedTypes.length > 0 && (
                    <span className="text-[10px] normal-case tracking-normal text-primary">
                      ({selectedTypes.length} selected)
                    </span>
                  )}
                </h4>
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant={selectedTypes.length === 0 ? "default" : "outline"}
                    size="sm"
                    onClick={onSelectAllTypes}
                    title="Show all health facilities and evacuation centers"
                  >
                    All
                  </Button>
                  {facilityTypes.map((type) => {
                    const isActive = selectedTypes.includes(type);
                    return (
                      <Button
                        key={type}
                        variant={isActive ? "default" : "outline"}
                        size="sm"
                        onClick={() => onToggleType(type)}
                        title={
                          isActive
                            ? `Remove ${type} from filter`
                            : `Add ${type} to filter`
                        }
                      >
                        {type}
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {mode === "idle" && (
            <Card className="border-dashed bg-muted/50">
              <CardContent className="p-4 text-center text-sm text-muted-foreground">
                {selectedTypes.length > 0
                  ? "Map filtered. Click the map or use your location to find the nearest matching facilities."
                  : "Click the map or use your location to find the nearest health facilities or evacuation centers."}
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
              <FsiNotice originBarangay={originBarangay} />
              <OriginCard origin={origin} />
              {results.map((item, index) => (
                <FacilityCard
                  key={
                    (item.facility._evac?.id ?? item.facility.name) +
                    item.facility.lat
                  }
                  item={item}
                  rank={index + 1}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

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
      .then((name) => {
        if (!cancelled) setPlaceName(name);
      })
      .catch(() => {
        if (!cancelled)
          setPlaceName(`${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingName(false);
      });
    return () => {
      cancelled = true;
    };
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

function FsiNotice({ originBarangay }) {
  if (!originBarangay) return null;
  const { name, risk, population } = originBarangay;
  const color = FSI_COLORS[risk] || "#9e9e9e";
  const message =
    FSI_MESSAGES[risk] ||
    "Flood susceptibility data unavailable for this area.";
  return (
    <Alert style={{ borderColor: color }} className="border-l-4">
      <AlertTitle className="flex items-center justify-between">
        <span>Flood Susceptibility — Barangay {name}</span>
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full text-white text-center"
          style={{ backgroundColor: color }}
        >
          {risk}
        </span>
      </AlertTitle>
      <AlertDescription>
        {message}
        <div className="mt-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Users className="h-3.5 w-3.5" />
          Population: {population != null ? population.toLocaleString() : "N/A"}
        </div>
      </AlertDescription>
    </Alert>
  );
}

function FacilityCard({ item, rank }) {
  const { facility, distanceMeters, durationSeconds } = item;
  const color = ROUTE_COLORS[rank - 1] || "#9e9e9e";

  const evac = facility._evac;
  const isEvac = Boolean(evac) || facility.type === EVACUATION_CENTER_TYPE;

  return (
    <Card className="relative">
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
        <p className="text-sm text-muted-foreground">
          {isEvac ? "⛺ Evacuation Center" : facility.type}
        </p>
      </CardHeader>
      <CardContent className="space-y-2 text-sm pl-5">
        <div className="flex justify-between border-b pb-2">
          <span className="text-muted-foreground">Distance</span>
          <span className="font-medium">
            {(distanceMeters / 1000).toFixed(2)} km
          </span>
        </div>
        <div className="flex justify-between border-b pb-2">
          <span className="text-muted-foreground">Travel time</span>
          <span className="font-medium">
            {Math.round(durationSeconds / 60)} min
          </span>
        </div>

        {isEvac ? (
          <>
            {evac?.location && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Location</span>
                <span className="font-medium text-right">{evac.location}</span>
              </div>
            )}
            {evac?.district && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">District</span>
                <span className="font-medium text-right">{evac.district}</span>
              </div>
            )}
            {evac?.floor_area_sqm != null && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Floor area</span>
                <span className="font-medium text-right">
                  {evac.floor_area_sqm} sqm
                </span>
              </div>
            )}
            {evac?.proximity && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Proximity</span>
                <span className="font-medium text-right">{evac.proximity}</span>
              </div>
            )}
            {evac?.remarks && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Remarks</span>
                <span className="font-medium text-right text-amber-600">
                  {evac.remarks}
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            {facility.addr_street && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Address</span>
                <span className="font-medium text-right">
                  {facility.addr_street}
                </span>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FloodMap() {
  const position = [7.0736, 122.01];
  const [facilities, setFacilities] = useState([]);
  const [evacuationCenters, setEvacuationCenters] = useState([]);
  const [cityBoundary, setCityBoundary] = useState(null);
  const [barangayData, setBarangayData] = useState(null);
  const [hiddenFacilities, setHiddenFacilities] = useState([]);
  const [hasLocation, setHasLocation] = useState(false);
  const [activeQGISLayers, setActiveQGISLayers] = useState([]);
  const [qgisLayerErrors, setQgisLayerErrors] = useState({});
  const [qgisLayerLoading, setQgisLayerLoading] = useState({});
  const [selection, setSelection] = useState({
    mode: "idle",
    results: [],
    errorMsg: null,
    origin: null,
    outsideBoundary: false,
    originBarangay: null,
    errorType: null,
  });
  const [facilityTypes, setFacilityTypes] = useState([]);

  const [selectedTypes, setSelectedTypes] = useState([]);

  const [mapMode, setMapMode] = useState("marker");
  const [selectedBarangay, setSelectedBarangay] = useState(null);

  const searchSelectRef = useRef(null);
  const clearLocationRef = useRef(null);
  const centerLocationRef = useRef(null);
  const locationHandlerRef = useRef(null);
  const resetHandlerRef = useRef(null);
  const qgisRasterDataRef = useRef({});

  const hasQGISLayersActive = activeQGISLayers.length > 0;

  useEffect(() => {
    supabase
      .from("health_facilities")
      .select("type")
      .then(({ data, error }) => {
        const healthTypes =
          !error && data ? data.map((item) => item.type).filter(Boolean) : [];
        const sortedHealth = [...new Set(healthTypes)].filter(Boolean).sort();
        setFacilityTypes([...sortedHealth, EVACUATION_CENTER_TYPE]);
      });
  }, []);

  const handleBoundaryLoaded = useCallback((feature) => {
    setCityBoundary(feature);
  }, []);

  const handleBarangaysLoaded = useCallback((data) => {
    setBarangayData(data);
  }, []);

  const handleSelectionChange = useCallback((data) => {
    setSelection(data);
  }, []);

  const handleRequestSearchSelect = useCallback((fn) => {
    searchSelectRef.current = fn;
  }, []);

  const handleRequestLocation = useCallback((fn) => {
    locationHandlerRef.current = fn;
  }, []);

  const handleRequestReset = useCallback((fn) => {
    resetHandlerRef.current = fn;
  }, []);

  const handleNearestFacilitiesFound = useCallback(
    (nearestFacilities) => {
      const nearestIds = new Set(
        nearestFacilities.map((f) => `${f.lat},${f.lon}`),
      );
      const toHide = facilities.filter(
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
    clearLocationRef.current?.();
  }, []);

  const handleCenter = useCallback(() => {
    centerLocationRef.current?.();
  }, []);

  const handleLayerToggle = useCallback((layerKey) => {
    setActiveQGISLayers((prev) =>
      prev.includes(layerKey)
        ? prev.filter((key) => key !== layerKey)
        : [...prev, layerKey],
    );
  }, []);

  const handleQGISLoadingChange = useCallback((layerKey, isLoading) => {
    setQgisLayerLoading((prev) => ({ ...prev, [layerKey]: isLoading }));
  }, []);

  const handleQGISLoadError = useCallback((layerKey, message) => {
    setQgisLayerErrors((prev) => {
      const next = { ...prev };
      if (message) next[layerKey] = message;
      else delete next[layerKey];
      return next;
    });
  }, []);

  const handleRasterLoaded = useCallback((layerKey, data) => {
    if (data) qgisRasterDataRef.current[layerKey] = data;
    else delete qgisRasterDataRef.current[layerKey];
  }, []);

  const handleRequestClear = useCallback((fn) => {
    clearLocationRef.current = fn;
  }, []);

  const handleRequestCenter = useCallback((fn) => {
    centerLocationRef.current = fn;
  }, []);

  const handleSearchSelect = useCallback((latlng) => {
    searchSelectRef.current?.(latlng);
  }, []);

  const handleUseMyLocationClick = () => {
    locationHandlerRef.current?.();
  };

  const handleAlertClose = () => {
    resetHandlerRef.current?.();
    setSelection((prev) => ({
      ...prev,
      outsideBoundary: false,
      mode: "idle",
      errorType: null,
    }));
  };

  const handleModeChange = useCallback((newMode) => {
    setMapMode(newMode);
    if (newMode === "marker") {
      setSelectedBarangay(null);
    }
  }, []);

  const handleBarangaySelect = useCallback((barangay) => {
    setSelectedBarangay(barangay);
  }, []);

  const handleClearBarangay = useCallback(() => {
    setSelectedBarangay(null);
  }, []);

  const handleSelectAllTypes = useCallback(() => {
    setSelectedTypes([]);
  }, []);

  const handleToggleType = useCallback((type) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  const effectiveHiddenFacilities = useMemo(() => {
    const hiddenIds = new Set();

    if (selectedTypes.length > 0) {
      const healthTypes = selectedTypes.filter(
        (t) => t !== EVACUATION_CENTER_TYPE,
      );
      facilities.forEach((f) => {
        if (healthTypes.length === 0 || !healthTypes.includes(f.type)) {
          hiddenIds.add(`${f.lat},${f.lon}`);
        }
      });
    }

    hiddenFacilities.forEach((f) => hiddenIds.add(`${f.lat},${f.lon}`));

    return facilities.filter((f) => hiddenIds.has(`${f.lat},${f.lon}`));
  }, [facilities, selectedTypes, hiddenFacilities]);

  const showEvacCenters =
    selectedTypes.length === 0 ||
    selectedTypes.includes(EVACUATION_CENTER_TYPE);

  return (
    <div className="flex w-full h-screen">
      <div className="w-3/4 h-full">
        <div style={{ position: "relative", height: "100%", width: "100%" }}>
          <style>{`
            .barangay-label {
              background: rgba(0,0,0,0.75);
              border: none;
              border-radius: 4px;
              color: #ffffff;
              font-size: 11px;
              font-weight: 500;
              padding: 3px 7px;
              white-space: nowrap;
            }
            .barangay-label::before { display: none; }
            .custom-poi-icon { background: none; border: none; }
            .search-item:last-child { border-bottom: none; }
            .search-item:hover { background: #f2f2f2; }
            .leaflet-tooltip { pointer-events: none !important; }
            .leaflet-control-container .leaflet-bottom .leaflet-right {
              display: flex !important;
              flex-direction: row !important;
              gap: 8px !important;
              margin-bottom: 20px !important;
            }
            .leaflet-control-container .leaflet-bottom .leaflet-right .leaflet-control {
              margin: 0 !important;
            }
            .custom-cluster-icon { background: transparent !important; border: none !important; }
            .custom-cluster-icon div { background: transparent !important; border: none !important; }
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
            minZoom={3}
            scrollWheelZoom={true}
            zoomControl={false}
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution="Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
            <ZamboangaMask
              onBoundaryLoaded={handleBoundaryLoaded}
              onBarangaysLoaded={handleBarangaysLoaded}
              hideFSI={hasQGISLayersActive}
              mapMode={mapMode}
              selectedBarangayName={selectedBarangay?.name || null}
            />
            <POILayer
              onFacilities={setFacilities}
              hiddenFacilities={effectiveHiddenFacilities}
            />
            <EvacuationCentersLayer
              onCentersLoaded={setEvacuationCenters}
              visible={showEvacCenters}
            />
            <RoutingLayer
              facilities={facilities}
              evacuationCenters={evacuationCenters}
              onSelectionChange={handleSelectionChange}
              onRequestLocation={handleRequestLocation}
              onRequestReset={handleRequestReset}
              onRequestSearchSelect={handleRequestSearchSelect}
              onRequestClear={handleRequestClear}
              onRequestCenter={handleRequestCenter}
              selectedTypes={selectedTypes}
              cityBoundary={cityBoundary}
              barangayData={barangayData}
              onNearestFacilitiesFound={handleNearestFacilitiesFound}
              onClearHighlight={handleClearHighlight}
              onLocationChange={handleLocationChange}
              mapMode={mapMode}
              onBarangaySelect={handleBarangaySelect}
            />
            <MapControls
              onLocate={handleLocate}
              onClear={handleClear}
              onCenterLocation={handleCenter}
              hasLocation={hasLocation}
            />
            <LegendControl />
          </MapContainer>

          <MapModeControl mode={mapMode} onModeChange={handleModeChange} />

          <MapSearchControl
            cityBoundary={cityBoundary}
            onSelectLocation={handleSearchSelect}
          />
        </div>
      </div>

      <div className="w-1/4 h-full bg-background p-6 overflow-y-auto border-l">
        <FacilityDetailsPanel
          selection={selection}
          onUseMyLocation={handleUseMyLocationClick}
          facilityTypes={facilityTypes}
          selectedTypes={selectedTypes}
          onSelectAllTypes={handleSelectAllTypes}
          onToggleType={handleToggleType}
          mapMode={mapMode}
          selectedBarangay={selectedBarangay}
          onClearBarangay={handleClearBarangay}
        />
      </div>

      <AlertDialog
        open={selection.outsideBoundary}
        onOpenChange={(open) => {
          if (!open) handleAlertClose();
        }}
      >
        <AlertDialogContent className="z-[9999]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selection.errorType === "seawater"
                ? "Seawater Location"
                : "Outside Zamboanga City"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selection.errorType === "seawater" ? (
                <div className="flex items-center gap-2">
                  <Waves className="h-5 w-5 text-blue-500" />
                  <span>
                    This location appears to be in the seawater. Please select a
                    location on land within Zamboanga City to find nearby
                    facilities.
                  </span>
                </div>
              ) : (
                selection.errorMsg ||
                "Please select a location within the city boundary."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleAlertClose}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default FloodMap;
