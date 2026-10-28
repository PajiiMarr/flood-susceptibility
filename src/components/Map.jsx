import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { Switch } from "@/components/ui/switch";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import BaseLayerSwitcher, { BASE_LAYERS } from "./BaseLayerSwitcher";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  MapPin,
  MapPinOff,
  Users,
  Waves,
  Search,
  Eye,
  EyeOff,
  ChevronUp,
  PanelRightClose,
  PanelRightOpen,
  Loader2,
  Hexagon,
  SlidersHorizontal,
  Home,
} from "lucide-react";

export const EVACUATION_CENTER_TYPE = "Evacuation Center";

// ==========================================
// GLOBAL CACHE (Prevents redundant fetches)
// ==========================================
const APP_CACHE = {
  qgis: {},
  facilities: null,
  evacCenters: null,
  cityBoundary: null,
  barangays: null,
  populations: null,
  fsi: {},
};

// ==========================================
// FSI SERVER CONFIGURATION
// ==========================================
const USE_SERVER =
  String(import.meta.env.VITE_USE_SERVER || "").toLowerCase() === "true";
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const STACKING_MODEL = import.meta.env.VITE_STACKING_MODEL || "stacking";
const DEFAULT_FSI_MODEL = STACKING_MODEL;

console.log(
  `[FSI] server=${USE_SERVER ? "ON" : "OFF"} base=${API_BASE_URL} ` +
    `model=${DEFAULT_FSI_MODEL}`,
);

// ==========================================
// LEGEND THEME (single source of truth for ALL legend cards)
// ==========================================
const LEGEND_THEME = {
  desktop: {
    width: 232,
    pad: 12,
    borderRadius: 8,
    titleSize: "12px",
    labelSize: "11.5px",
    swatchSize: 16,
    swatchGap: 8,
    rowGap: 6,
    headerHeight: 30,
    headerPad: 8,
    headerGap: 8,
    marginTop: 56,
    marginRight: 16,
    stackGap: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
  },
  mobile: {
    width: 176,
    pad: 10,
    borderRadius: 8,
    titleSize: "11px",
    labelSize: "10.5px",
    swatchSize: 14,
    swatchGap: 8,
    rowGap: 5,
    headerHeight: 28,
    headerPad: 7,
    headerGap: 7,
    marginTop: 70,
    marginRight: 12,
    stackGap: 10,
    boxShadow: "0 2px 6px rgba(0,0,0,0.16)",
  },
};

const px = (n) => `${n}px`;
const PEEK_HEIGHT = 52;
const getLegendTheme = (compact) =>
  LEGEND_THEME[compact ? "mobile" : "desktop"];

const legendBaseStyle = (t) => ({
  boxSizing: "border-box",
  width: px(t.width),
  maxWidth: "calc(100vw - 24px)",
  backgroundColor: "rgba(255,255,255,0.94)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  padding: px(t.pad),
  borderRadius: px(t.borderRadius),
  border: "1px solid rgba(0,0,0,0.06)",
  boxShadow: t.boxShadow,
  fontFamily: "Arial, sans-serif",
  fontSize: t.labelSize,
  color: "#1a1a1a",
  lineHeight: "1.35",
  userSelect: "none",
});

const legendHeaderStyle = (t) => ({
  boxSizing: "border-box",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "8px",
  minHeight: px(t.headerHeight),
  paddingBottom: px(t.headerPad),
  marginBottom: px(t.headerGap),
  borderBottom: "1px solid rgba(0,0,0,0.08)",
});

const legendTitleStyle = (t) => ({
  margin: 0,
  fontSize: t.titleSize,
  fontWeight: "700",
  color: "#111",
  lineHeight: "1.25",
});

const legendBodyStyle = (t) => ({
  display: "flex",
  flexDirection: "column",
  gap: px(t.rowGap),
});

const legendRowStyle = (t) => ({
  display: "flex",
  alignItems: "center",
  gap: px(t.swatchGap),
  minHeight: px(t.swatchSize),
});

const legendSwatchStyle = (t, color) => ({
  boxSizing: "border-box",
  width: px(t.swatchSize),
  height: px(t.swatchSize),
  borderRadius: "3px",
  backgroundColor: color,
  border: "1px solid rgba(0,0,0,0.12)",
  flexShrink: 0,
});

const legendLabelStyle = (t) => ({
  fontSize: t.labelSize,
  color: "#222",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
});

const estimateLegendHeight = (t, rows) =>
  2 * t.pad +
  2 +
  t.headerHeight +
  t.headerGap +
  rows * t.swatchSize +
  Math.max(0, rows - 1) * t.rowGap;

// ==========================================
// FACTOR INFO MAP (Human-readable names)
// ==========================================
const FACTOR_INFO = {
  dem: { label: "Surface Elevation", desc: "Ground height above sea level" },
  slope: { label: "Terrain Slope", desc: "Steepness of the terrain" },
  aspect: { label: "Slope Direction", desc: "Direction the slope faces" },
  twi: {
    label: "Topographic Wetness",
    desc: "Tendency of terrain to accumulate water",
  },
  hand: {
    label: "Height Above Drainage",
    desc: "Elevation above the nearest stream",
  },
  flow_accumulation: {
    label: "Flow Accumulation",
    desc: "Volume of water flowing through the area",
  },
  distance_to_river: {
    label: "River Distance",
    desc: "How far the point is from the nearest river",
  },
  drainage_density: {
    label: "Drainage Density",
    desc: "Stream length per unit area",
  },
  chirps: { label: "CHIRPS Rainfall", desc: "Satellite rainfall estimate" },
  gpm: { label: "GPM Rainfall", desc: "Global precipitation measurement" },
  wetness_index: {
    label: "Terrain Wetness Index",
    desc: "Wetness weighted by water flow",
  },
  flood_concentration: {
    label: "Flood Concentration",
    desc: "Runoff accumulated near rivers",
  },
  twi_hand_ratio: {
    label: "Wetness-to-Drainage Ratio",
    desc: "Ratio of wetness to elevation above drainage",
  },
  northness: {
    label: "North-Facing Slope",
    desc: "How much the slope faces north",
  },
  eastness: {
    label: "East-Facing Slope",
    desc: "How much the slope faces east",
  },
  relative_elevation: {
    label: "Relative Terrain Height",
    desc: "Low-lying areas relative to overall elevation",
  },
  slope_aspect: {
    label: "Slope Orientation",
    desc: "Combined effect of steepness and direction",
  },
  river_proximity: {
    label: "River Proximity",
    desc: "Inverse distance to river (higher = closer)",
  },
  floodplain_index: {
    label: "Floodplain Susceptibility",
    desc: "Flat, low areas near water",
  },
  rainfall_intensity: {
    label: "Rainfall Intensity",
    desc: "Combined rainfall from CHIRPS + GPM",
  },
  rainfall_ratio: {
    label: "Rainfall Source Ratio",
    desc: "Balance between the two rainfall sources",
  },
  rainfall_wetness: {
    label: "Rain-Coupled Wetness",
    desc: "Rainfall interacting with terrain wetness",
  },
  rainfall_flow: {
    label: "Rain-Driven Runoff",
    desc: "Rainfall combined with flow accumulation",
  },
  twi_hand: {
    label: "Combined Terrain Wetness",
    desc: "Interaction between wetness and elevation",
  },
  dem_river_ratio: {
    label: "Elevation-to-River Proximity",
    desc: "Height relative to river distance",
  },
  hand_dem_ratio: {
    label: "Lowland Relative Elevation",
    desc: "Low-lying areas relative to total elevation",
  },
  flow_dist_ratio: {
    label: "Flow-to-River Distance",
    desc: "Water flow relative to distance from river",
  },
  hand_squared: {
    label: "Extreme Lowland Indicator",
    desc: "Nonlinear elevation effect amplifying extreme lows",
  },
};

function getFactorInfo(name) {
  return (
    FACTOR_INFO[name] || {
      label: name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      desc: "",
    }
  );
}

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

const FSI_OPACITY = {
  normal: 0.6,
  hover: 0.78,
  selected: 0.88,
  borderOpacity: 0.85,
};

const ROUTE_COLORS = ["#2563eb", "#f59e0b", "#ef4444"];

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
const DEFAULT_VIEWBOX = "121.85,7.30,122.20,6.85";
const MARITIME_BOUNDARY_CACHE_KEY = "zc_maritime_boundary_v1";
const MARITIME_BOUNDARY_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const POPULATION_XLSX_URL =
  "https://xflhynxdadwlrloxiogv.supabase.co/storage/v1/object/public/fsi-bucket/SOCIO%20DEMOGRAPHIC%20DATAS/Region-IX_0.xlsx";

const BLOB_SAS_URL = import.meta.env.VITE_BLOB_SAS_URL || "";

function buildAzurePath(relativePath) {
  if (!BLOB_SAS_URL) {
    console.warn("VITE_BLOB_SAS_URL is not defined in .env");
    return "";
  }
  const [baseUrl, sasToken] = BLOB_SAS_URL.split("?");
  const encodedPath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const finalUrl = sasToken
    ? `${baseUrl}/${encodedPath}?${sasToken}`
    : `${baseUrl}/${encodedPath}`;
  return finalUrl;
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

function formatRasterValue(value) {
  if (value == null || Number.isNaN(value)) return "N/A";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

const LEGEND_BUCKETS = [
  { t0: 0, t1: 0.2 },
  { t0: 0.2, t1: 0.4 },
  { t0: 0.4, t1: 0.6 },
  { t0: 0.6, t1: 0.8 },
  { t0: 0.8, t1: 1 },
];

function buildLegendStops(colorScale, minVal, maxVal) {
  const range = maxVal - minVal;
  return LEGEND_BUCKETS.map(({ t0, t1 }) => {
    const mid = (t0 + t1) / 2;
    const [r, g, b] = getColorRamp(mid, colorScale);
    return {
      color: `rgb(${r}, ${g}, ${b})`,
      v0: minVal + t0 * range,
      v1: minVal + t1 * range,
    };
  });
}

const QGIS_LAYER_CONFIGS = {
  dem: {
    name: "Digital Elevation Model",
    path: buildAzurePath("Zamboanga_DEM.tif"),
    preview: "dem.png",
    colorScale: "terrain",
    opacity: 0.8,
    previewColor: "#4CAF50",
    description: "Terrain elevation data",
    unit: " m",
  },
  slope: {
    name: "Slope",
    path: buildAzurePath("Zamboanga_Slope.tiff"),
    preview: "/slope.png",
    colorScale: "slope",
    opacity: 0.8,
    previewColor: "#FF9800",
    description: "Terrain steepness",
    unit: "°",
  },
  aspect: {
    name: "Aspect",
    path: buildAzurePath("Zamboanga_Aspect.tiff"),
    preview: "/aspect.png",
    colorScale: "hsv",
    opacity: 0.8,
    previewColor: "#9C27B0",
    description: "Slope direction",
    unit: "°",
  },
  twi: {
    name: "Topographic Wetness Index",
    path: buildAzurePath("Zamboanga_TWI.tif"),
    preview: "/twi.png",
    colorScale: "blues",
    opacity: 0.8,
    previewColor: "#2196F3",
    description: "Soil moisture potential",
    unit: "",
  },
  hand: {
    name: "Height Above Nearest Drainage",
    path: buildAzurePath("Zamboanga_HAND.tif"),
    preview: "/hand.png",
    colorScale: "reds",
    opacity: 0.8,
    previewColor: "#F44336",
    description: "Flood depth proxy",
    unit: " m",
  },
  flow_accumulation: {
    name: "Flow Accumulation",
    path: buildAzurePath("Zamboanga_Flow_Accumulation.tif"),
    preview: "/flow_accumulation.png",
    colorScale: "blues",
    opacity: 0.8,
    previewColor: "#00BCD4",
    description: "Water concentration areas",
    unit: " cells",
  },
  chirps: {
    name: "CHIRPS Rainfall",
    path: buildAzurePath("Zamboanga_CHIRPS_Resampled.tiff"),
    preview: "/rainfall.png",
    colorScale: "rainbow",
    opacity: 0.8,
    previewColor: "#E91E63",
    description: "Rainfall data",
    unit: " mm",
  },
  distance_to_river: {
    name: "Distance to River",
    path: buildAzurePath("Zamboanga_Distance_to_river.tiff"),
    preview: "/river_distance.png",
    colorScale: "purples",
    opacity: 0.8,
    previewColor: "#6A1B9A",
    description: "Proximity to water bodies",
    unit: " m",
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
  if (data.code !== "Ok" || !data.routes?.length)
    throw new Error(data.message || "Route request failed");
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
  if (APP_CACHE.populations) return APP_CACHE.populations;
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
    APP_CACHE.populations = popMap;
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
      )
        return parsed.geojson;
    }
  } catch {}

  try {
    const query = `
      [out:json][timeout:25];
      relation["type"="boundary"]["boundary"="administrative"]["admin_level"="6"]["name"="Zamboanga City"]->.city;
      way(r.city);
      out tags geom;
    `;

    // Call the Vercel serverless proxy instead of Overpass directly
    const res = await fetch(`/api/overpass?data=${encodeURIComponent(query)}`);

    if (!res.ok) {
      throw new Error(`Proxy request failed: ${res.status}`);
    }

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

function getFeatureCentroid(feature) {
  const geom = feature?.geometry;
  if (!geom) return null;
  let coords;
  if (geom.type === "Polygon") coords = geom.coordinates[0];
  else if (geom.type === "MultiPolygon") {
    let largest = null,
      largestArea = -1;
    for (const poly of geom.coordinates) {
      const ring = poly[0];
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++)
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      area = Math.abs(area) / 2;
      if (area > largestArea) {
        largestArea = area;
        largest = ring;
      }
    }
    coords = largest;
  } else return null;

  if (!coords || coords.length === 0) return null;
  const isClosed =
    coords.length > 1 &&
    coords[0][0] === coords[coords.length - 1][0] &&
    coords[0][1] === coords[coords.length - 1][1];
  const n = isClosed ? coords.length - 1 : coords.length;
  if (n <= 0) return null;
  let sumLng = 0,
    sumLat = 0;
  for (let i = 0; i < n; i++) {
    sumLng += coords[i][0];
    sumLat += coords[i][1];
  }
  return { lng: sumLng / n, lat: sumLat / n };
}

async function fetchServerFsiPoint(
  lat,
  lng,
  model = DEFAULT_FSI_MODEL,
  { explain = false } = {},
) {
  const res = await fetch(`${API_BASE_URL}/api/predict/point`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng, model, explain }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) detail = j.detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

async function fetchServerFsiBatch(points, model = DEFAULT_FSI_MODEL) {
  const res = await fetch(`${API_BASE_URL}/api/predict/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, explain: false, points }),
  });
  if (!res.ok) throw new Error(`Batch failed: HTTP ${res.status}`);
  return res.json();
}

async function resolveBarangayFsi(features, model = DEFAULT_FSI_MODEL) {
  if (APP_CACHE.fsi[model]) {
    return APP_CACHE.fsi[model];
  }
  const result = new Map();
  if (!USE_SERVER) {
    for (const f of features) {
      const name = f.properties?.adm4_name || "";
      result.set(name, {
        risk: getRandomRiskLevel(),
        probability: null,
        centroid: getFeatureCentroid(f),
        top_factors: [],
      });
    }
    APP_CACHE.fsi[model] = result;
    return result;
  }
  const order = [],
    points = [];
  for (const f of features) {
    const name = f.properties?.adm4_name || "";
    const centroid = getFeatureCentroid(f);
    if (!centroid) {
      result.set(name, {
        risk: "Low Risk",
        probability: null,
        centroid: null,
        top_factors: [],
      });
      continue;
    }
    order.push({ name, lat: centroid.lat, lng: centroid.lng, centroid });
    points.push({ lat: centroid.lat, lng: centroid.lng });
  }
  if (points.length === 0) return result;
  const t0 = performance.now();
  try {
    const data = await fetchServerFsiBatch(points, model);
    const results = data.results || [];
    const dt = Math.round(performance.now() - t0);
    console.log(
      `[FSI][${model}] Batch: ${results.length}/${points.length} in ${dt}ms`,
    );
    for (let i = 0; i < order.length; i++) {
      const r = results[i],
        o = order[i];
      if (r && !r.error && typeof r.probability === "number")
        result.set(o.name, {
          risk: r.risk_class || "Low Risk",
          probability: r.probability,
          centroid: o.centroid,
          top_factors: [],
        });
      else
        result.set(o.name, {
          risk: "Low Risk",
          probability: null,
          centroid: o.centroid,
          top_factors: [],
          error: r?.error || "no result",
        });
    }
  } catch (err) {
    console.warn(
      `[FSI][${model}] Batch failed (${err.message}); falling back to random`,
    );
    for (const o of order)
      result.set(o.name, {
        risk: getRandomRiskLevel(),
        probability: null,
        centroid: o.centroid,
        top_factors: [],
      });
  }
  APP_CACHE.fsi[model] = result;
  return result;
}

function useBarangayExplanation(barangay, model) {
  const [factors, setFactors] = useState(barangay?.top_factors || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    setFactors(barangay?.top_factors || []);
    setError(null);
    if (
      !USE_SERVER ||
      !barangay ||
      typeof barangay?.lat !== "number" ||
      typeof barangay?.lng !== "number"
    )
      return;
    let cancelled = false;
    setLoading(true);
    fetchServerFsiPoint(barangay.lat, barangay.lng, model, { explain: true })
      .then((data) => {
        if (!cancelled) setFactors(data.top_factors || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [barangay, model]);
  return { factors, loading, error };
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

function CustomPanes() {
  const map = useMap();
  useEffect(() => {
    // Stacking order (low -> high):
    // qgis 600 < fsi 640 < routes 645 < facilities/markers 650 < tooltips 660
    if (!map.getPane("routes-pane")) {
      const routes = map.createPane("routes-pane");
      routes.style.zIndex = 645;
      routes.style.pointerEvents = "none";
    }
    if (!map.getPane("facilities-pane")) {
      const pane = map.createPane("facilities-pane");
      pane.style.zIndex = 650;
    }
  }, [map]);
  return null;
}

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [map]);
  return null;
}

function LegendControl({
  fsiVisible,
  onToggleFsi,
  compact = false,
  legendOpen,
  setLegendOpen,
}) {
  const map = useMap();
  const divRef = useRef(null);
  const toggleRef = useRef(onToggleFsi);
  const compactRef = useRef(compact);
  const switchRootRef = useRef(null);
  const switchContainerRef = useRef(null);

  const collapsed = compact && !legendOpen;

  useEffect(() => {
    toggleRef.current = onToggleFsi;
  }, [onToggleFsi]);
  useEffect(() => {
    compactRef.current = compact;
  }, [compact]);

  useEffect(() => {
    const legend = L.control({ position: "topright" });
    legend.onAdd = () => {
      const t = getLegendTheme(compactRef.current);
      const div = L.DomUtil.create("div", "info legend");
      Object.assign(div.style, legendBaseStyle(t));
      div.style.marginTop = px(t.marginTop);
      div.style.marginRight = px(t.marginRight);
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      divRef.current = div;
      return div;
    };
    legend.addTo(map);
    return () => {
      legend.remove();
      divRef.current = null;
      if (switchRootRef.current) {
        const root = switchRootRef.current;
        switchRootRef.current = null;
        queueMicrotask(() => {
          try {
            root.unmount();
          } catch {}
        });
      }
    };
  }, [map]);

  useEffect(() => {
    const div = divRef.current;
    if (!div) return;
    const t = getLegendTheme(compact);

    if (switchRootRef.current) {
      const root = switchRootRef.current;
      switchRootRef.current = null;
      queueMicrotask(() => {
        try {
          root.unmount();
        } catch {}
      });
    }
    switchContainerRef.current = null;

    Object.assign(div.style, legendBaseStyle(t));
    div.style.marginTop = px(t.marginTop);
    div.style.marginRight = px(t.marginRight);
    div.style.cursor = collapsed ? "pointer" : "default";
    div.onclick = null;
    div.innerHTML = "";

    if (collapsed) {
      div.style.width = "auto";
      div.style.padding = "7px 10px";
      const dots = Object.values(RISK_LEVELS)
        .map(
          (c) =>
            `<span style="width:8px;height:8px;border-radius:50%;background:${c};display:inline-block;"></span>`,
        )
        .join("");
      div.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;opacity:${fsiVisible ? 1 : 0.5};">
          <span style="display:flex;gap:3px;">${dots}</span>
          <strong style="font-size:11px;">FSI</strong>
          <span style="font-size:9px;color:#777;">▾</span>
        </div>`;
      div.onclick = (e) => {
        L.DomEvent.stop(e);
        setLegendOpen(true);
      };
      return;
    }

    const header = document.createElement("div");
    Object.assign(header.style, legendHeaderStyle(t));
    header.style.alignItems = "center";

    const title = document.createElement("strong");
    title.textContent = compact ? "Flood Risk" : "Flood Susceptibility";
    Object.assign(title.style, legendTitleStyle(t));
    header.appendChild(title);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;align-items:center;gap:6px;";

    const toggleContainer = document.createElement("div");
    toggleContainer.style.display = "flex";
    toggleContainer.style.alignItems = "center";
    toggleContainer.style.minWidth = compact ? "32px" : "40px";
    toggleContainer.style.minHeight = compact ? "16px" : "20px";

    L.DomEvent.disableClickPropagation(toggleContainer);
    L.DomEvent.disableScrollPropagation(toggleContainer);

    switchContainerRef.current = toggleContainer;
    actions.appendChild(toggleContainer);
    switchRootRef.current = createRoot(toggleContainer);

    if (compact) {
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.title = "Collapse legend";
      closeBtn.textContent = "✕";
      closeBtn.style.cssText =
        "border:none;background:transparent;color:#666;font-size:12px;cursor:pointer;padding:2px 4px;line-height:1;";
      closeBtn.addEventListener("click", (e) => {
        L.DomEvent.stop(e);
        setLegendOpen(false);
      });
      actions.appendChild(closeBtn);
    }
    header.appendChild(actions);
    div.appendChild(header);

    const body = document.createElement("div");
    Object.assign(body.style, legendBodyStyle(t));

    for (const [level, color] of Object.entries(RISK_LEVELS)) {
      const row = document.createElement("div");
      Object.assign(row.style, legendRowStyle(t));
      row.className = "legend-row";
      row.style.transition = "opacity 0.15s ease";

      const swatch = document.createElement("div");
      Object.assign(swatch.style, legendSwatchStyle(t, color));

      const label = document.createElement("span");
      label.textContent = level;
      Object.assign(label.style, legendLabelStyle(t));

      row.appendChild(swatch);
      row.appendChild(label);
      body.appendChild(row);
    }
    div.appendChild(body);
  }, [compact, collapsed, setLegendOpen]);

  useEffect(() => {
    if (switchRootRef.current) {
      switchRootRef.current.render(
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: "flex", alignItems: "center" }}
        >
          <Switch
            checked={fsiVisible}
            onCheckedChange={() => toggleRef.current?.()}
            className={cn(
              "data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-slate-300 transition-colors",
              compact ? "h-4 w-8" : "h-5 w-9",
            )}
          />
        </div>,
      );
    }

    if (divRef.current) {
      divRef.current.querySelectorAll(".legend-row").forEach((row) => {
        row.style.opacity = fsiVisible ? "1" : "0.4";
      });
    }
  }, [fsiVisible, compact]);

  return null;
}

function MapControls({
  onLocate,
  onClear,
  hasLocation,
  onCenterLocation,
  compact = false,
}) {
  const map = useMap();
  useEffect(() => {
    const boxW = compact ? "36px" : "40px";
    const iconSize = compact ? 18 : 20;

    const control = L.control({ position: "bottomright" });
    control.onAdd = () => {
      const container = L.DomUtil.create("div", "map-controls");
      container.style.backgroundColor = "white";
      container.style.borderRadius = "8px";
      container.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.overflow = "hidden";
      container.style.width = boxW;

      const makeBtn = (svg, title, onClick, disabled = false) => {
        const b = document.createElement("button");
        b.innerHTML = `<svg viewBox="0 0 24 24" width="${iconSize}" height="${iconSize}" style="pointer-events:none;">${svg}</svg>`;
        b.style.cssText = `
          background: none; border: none; padding: ${compact ? "7px 8px" : "8px 10px"};
          display: flex; align-items: center; justify-content: center;
          transition: background 0.2s; width: 100%; cursor: pointer;
          border-bottom: 1px solid #e0e0e0;
          ${disabled ? "opacity: 0.4; pointer-events: none;" : ""}
        `;
        b.title = title;
        b.addEventListener("mouseenter", () => {
          if (!disabled) b.style.backgroundColor = "#f0f0f0";
        });
        b.addEventListener("mouseleave", () => {
          b.style.backgroundColor = "transparent";
        });
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!disabled) onClick();
        });
        return b;
      };

      container.appendChild(
        makeBtn(
          `<path fill="#444" d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>`,
          "Find my location",
          () => onLocate?.(),
        ),
      );
      container.appendChild(
        makeBtn(
          `<path fill="#444" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>`,
          "Center on location",
          () => onCenterLocation?.(),
          !hasLocation,
        ),
      );
      container.appendChild(
        makeBtn(
          `<path fill="#444" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>`,
          "Clear location",
          () => onClear?.(),
          !hasLocation,
        ),
      );
      return container;
    };
    control.addTo(map);

    const zoomControl = L.control({ position: "bottomright" });
    zoomControl.onAdd = () => {
      const c = L.DomUtil.create("div", "zoom-controls");
      c.style.backgroundColor = "white";
      c.style.borderRadius = "8px";
      c.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
      c.style.overflow = "hidden";
      c.style.width = boxW;

      const makeZoom = (svg, title, fn) => {
        const b = document.createElement("button");
        b.innerHTML = `<svg viewBox="0 0 24 24" width="${iconSize}" height="${iconSize}" style="pointer-events:none;">${svg}</svg>`;
        b.style.cssText = `background: none; border: none; padding: ${compact ? "6px 8px" : "6px 10px"}; display: flex; align-items: center; justify-content: center; transition: background 0.2s; width: 100%; cursor: pointer; border-bottom: 1px solid #e0e0e0;`;
        b.title = title;
        b.addEventListener("mouseenter", () => {
          b.style.backgroundColor = "#f0f0f0";
        });
        b.addEventListener("mouseleave", () => {
          b.style.backgroundColor = "transparent";
        });
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          fn();
        });
        return b;
      };
      c.appendChild(
        makeZoom(
          `<path fill="#444" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>`,
          "Zoom in",
          () => map.zoomIn(),
        ),
      );
      c.appendChild(
        makeZoom(`<path fill="#444" d="M5 13h14v-2H5v2z"/>`, "Zoom out", () =>
          map.zoomOut(),
        ),
      );
      return c;
    };
    zoomControl.addTo(map);

    return () => {
      control.remove();
      zoomControl.remove();
    };
  }, [map, onLocate, onClear, hasLocation, onCenterLocation, compact]);
  return null;
}

function MapModeControl({ mode, onModeChange, compact = false }) {
  const containerRef = useRef(null);
  useEffect(() => {
    if (!containerRef.current) return;
    L.DomEvent.disableClickPropagation(containerRef.current);
    L.DomEvent.disableScrollPropagation(containerRef.current);
  }, []);

  const baseBtnStyle = {
    padding: "7px 9px",
    fontSize: "11px",
    fontFamily: "Arial, sans-serif",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "5px",
    transition: "all 0.15s ease",
    whiteSpace: "nowrap",
  };
  const activeStyle = {
    ...baseBtnStyle,
    backgroundColor: "#2563eb",
    color: "#ffffff",
    fontWeight: "600",
    boxShadow: "0 1px 4px rgba(37,99,235,0.4)",
  };
  const inactiveStyle = {
    ...baseBtnStyle,
    backgroundColor: "transparent",
    color: "#444",
    fontWeight: "500",
  };

  const modes = [
    {
      key: "marker",
      label: "Marker",
      title: "Click the map to find nearest facilities",
      Icon: MapPin,
    },
    {
      key: "barangay",
      label: "Barangay",
      title: "Click a barangay to view its details",
      Icon: Hexagon,
    },
  ];

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: compact ? "70px" : "84px",
        left: compact ? "12px" : "16px",
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
      {modes.map(({ key, label, title, Icon }) => {
        const active = mode === key;
        return (
          <button
            key={key}
            type="button"
            // Clicking the active mode deselects it ("none")
            onClick={() => onModeChange(active ? "none" : key)}
            style={active ? activeStyle : inactiveStyle}
            title={active ? `${label} mode (click to turn off)` : title}
            aria-label={active ? `${label} mode, click to turn off` : title}
            aria-pressed={active}
          >
            <Icon size={15} />
            {active && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}

function MapSearchControl({
  cityBoundary,
  onSelectLocation,
  onHome,
  compact = false,
  openOverlay,
}) {
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
    const onOut = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target))
        setShowResults(false);
    };
    document.addEventListener("click", onOut);
    return () => document.removeEventListener("click", onOut);
  }, []);

  // add openOverlay prop, then:
  useEffect(() => {
    if (openOverlay !== null) setShowResults(false);
  }, [openOverlay]);

  const doSearch = useCallback(async (q) => {
    if (!q || q.trim().length < 3) {
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
      const url = `${NOMINATIM_BASE}/search?format=json&limit=6&countrycodes=ph&viewbox=${viewbox}&bounded=1&q=${encodeURIComponent(`${q}, Zamboanga City, Philippines`)}`;
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

  const onChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => doSearch(v), 400);
  };

  const onSelect = (item) => {
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
        top: compact ? "12px" : "16px",
        left: compact ? "12px" : "16px",
        zIndex: 2000,
        display: "flex",
        gap: "8px",
        alignItems: "stretch",
        pointerEvents: "auto",
        width: compact ? "calc(100% - 24px)" : "380px",
        maxWidth: compact ? "none" : "calc(100% - 32px)",
      }}
    >
      {onHome && (
        <button
          onClick={onHome}
          title="Back to Home"
          style={{
            background: "rgba(255,255,255,0.75)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderRadius: "10px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
            border: "1px solid rgba(255,255,255,0.5)",
            padding: "0 12px",
            cursor: "pointer",
            color: "#333",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "rgba(255,255,255,0.95)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "rgba(255,255,255,0.75)")
          }
        >
          <Home size={18} />
        </button>
      )}

      <div
        style={{
          position: "relative",
          flex: 1,
          background: "rgba(255,255,255,0.75)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: "10px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
          border: "1px solid rgba(255,255,255,0.5)",
          padding: compact ? "4px" : "6px",
        }}
      >
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder={
              compact ? "Search place…" : "Search a place in Zamboanga City…"
            }
            value={query}
            onChange={onChange}
            onFocus={() => {
              if (results.length > 0) setShowResults(true);
            }}
            className="pl-8 h-9 text-sm bg-white/70 border-white/60 focus-visible:bg-white/95 focus-visible:ring-1 focus-visible:ring-primary/40 placeholder:text-muted-foreground/70"
          />
        </div>
        {showResults && (
          <div
            className="overlay-animate-in"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              background: "rgba(255,255,255,0.95)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              borderRadius: "10px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
              border: "1px solid rgba(255,255,255,0.5)",
              maxHeight: compact ? "40vh" : "260px",
              overflowY: "auto",
              transformOrigin: "top center",
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
                  onClick={() => onSelect(item)}
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
  for (const m of markers) {
    const t = m.options.facilityType;
    const e = TYPE_ICONS[t] || DEFAULT_MARKER_EMOJI;
    counts[e] = (counts[e] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return DEFAULT_MARKER_EMOJI;
  entries.sort((a, b) => b[1] - a[1]);
  const topCount = entries[0][1];
  const topEmojis = entries.filter(([, c]) => c === topCount);
  return topEmojis.length === 1 ? topEmojis[0][0] : DEFAULT_MARKER_EMOJI;
}

function POILayer({
  onFacilities,
  hiddenFacilities = [],
  visible = true,
  onFacilityClick,
}) {
  const map = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const clusterRef = useRef(null);
  const onFacilitiesRef = useRef(onFacilities);
  const onFacilityClickRef = useRef(onFacilityClick);
  const allFacilitiesRef = useRef([]);
  const [currentZoom, setCurrentZoom] = useState(map.getZoom());
  const visibleRef = useRef(visible);
  const [renderTick, setRenderTick] = useState(0);

  useEffect(() => {
    visibleRef.current = visible;
    setRenderTick((t) => t + 1);
  }, [visible]);
  useEffect(() => {
    onFacilitiesRef.current = onFacilities;
  }, [onFacilities]);
  useEffect(() => {
    onFacilityClickRef.current = onFacilityClick;
  }, [onFacilityClick]);
  useEffect(() => {
    const h = () => setCurrentZoom(map.getZoom());
    map.on("zoomend", h);
    return () => map.off("zoomend", h);
  }, [map]);

  const renderFacilities = useCallback(
    (rows, zoomLevel) => {
      if (!map) return;
      const hiddenIds = new Set(
        hiddenFacilities.map((f) => `${f.lat},${f.lon}`),
      );
      const visibleRows = rows.filter(
        (r) => !hiddenIds.has(`${r.lat},${r.lon}`),
      );
      if (clusterRef.current) {
        map.removeLayer(clusterRef.current);
        clusterRef.current = null;
      }
      if (!visibleRef.current || visibleRows.length === 0) {
        setLoading(false);
        return;
      }
      const shouldCluster = zoomLevel < 13;

      if (shouldCluster) {
        const cg = L.markerClusterGroup({
          maxClusterRadius: 40,
          iconCreateFunction: function (cluster) {
            const emoji = getDominantEmoji(cluster.getAllChildMarkers());
            const div = document.createElement("div");
            div.style.cssText = `width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:24px;text-shadow:0 0 4px rgba(255,255,255,0.8);`;
            div.innerHTML = emoji;
            return L.divIcon({
              html: div.outerHTML,
              iconSize: [36, 36],
              className: "custom-cluster-icon",
            });
          },
        });
        const markers = visibleRows.map((row) => {
          const emoji = TYPE_ICONS[row.type] || DEFAULT_MARKER_EMOJI;
          const icon = L.divIcon({
            html: `<div style="font-size:24px;text-shadow:0 0 2px white;">${emoji}</div>`,
            iconSize: [24, 24],
            className: "custom-poi-marker",
          });
          const popup = `<div style="min-width: 150px;"><strong>${row.name}</strong><br>Type: ${row.type}<br>${row.addr_street ? `Address: ${row.addr_street}<br>` : ""}${row.addr_city ? `City: ${row.addr_city}<br>` : ""}${row.phone ? `Phone: ${row.phone}<br>` : ""}${row.website ? `Website: <a href="${row.website}" target="_blank">link</a>` : ""}</div>`;
          const marker = L.marker([row.lat, row.lon], {
            icon,
            facilityType: row.type,
            pane: "facilities-pane",
          }).bindPopup(popup);
          marker.on("click", () => {
            if (onFacilityClickRef.current) onFacilityClickRef.current(row);
          });
          return marker;
        });
        cg.addLayers(markers);
        cg.addTo(map);
        clusterRef.current = cg;
      } else {
        const group = L.layerGroup();
        visibleRows.forEach((row) => {
          const emoji = TYPE_ICONS[row.type] || DEFAULT_MARKER_EMOJI;
          const icon = L.divIcon({
            html: `<div style="font-size:24px;text-shadow:0 0 2px white;">${emoji}</div>`,
            iconSize: [24, 24],
            className: "custom-poi-marker",
          });
          const popup = `<div style="min-width: 150px;"><strong>${row.name}</strong><br>Type: ${row.type}<br>${row.addr_street ? `Address: ${row.addr_street}<br>` : ""}${row.addr_city ? `City: ${row.addr_city}<br>` : ""}${row.phone ? `Phone: ${row.phone}<br>` : ""}${row.website ? `Website: <a href="${row.website}" target="_blank">link</a>` : ""}</div>`;
          const marker = L.marker([row.lat, row.lon], {
            icon,
            facilityType: row.type,
            pane: "facilities-pane",
          }).bindPopup(popup);
          marker.on("click", () => {
            if (onFacilityClickRef.current) onFacilityClickRef.current(row);
          });
          group.addLayer(marker);
        });
        group.addTo(map);
        clusterRef.current = group;
      }
      setLoading(false);
    },
    [map, hiddenFacilities],
  );

  const renderRef = useRef(renderFacilities);
  useEffect(() => {
    renderRef.current = renderFacilities;
  }, [renderFacilities]);

  useEffect(() => {
    let mounted = true;
    const fetchPois = async () => {
      try {
        setLoading(true);
        setError(null);

        // Check cache first
        if (APP_CACHE.facilities) {
          allFacilitiesRef.current = APP_CACHE.facilities;
          onFacilitiesRef.current?.(
            APP_CACHE.facilities.map((row) => ({
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
          renderRef.current?.(APP_CACHE.facilities, map.getZoom());
          setLoading(false);
          return;
        }

        const { data, error: qe } = await supabase
          .from("health_facilities")
          .select(
            "name, type, lat, lon, addr_street, addr_city, phone, website",
          );
        if (qe) throw qe;
        if (mounted && data) {
          APP_CACHE.facilities = data; // Save to cache
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
          renderRef.current?.(data, map.getZoom());
        }
      } catch (err) {
        if (mounted) {
          setError(`Failed to load health facilities: ${err.message}`);
          setLoading(false);
        }
      }
    };
    fetchPois();
    return () => {
      mounted = false;
      if (clusterRef.current && map) {
        map.removeLayer(clusterRef.current);
        clusterRef.current = null;
      }
    };
  }, [map]);

  useEffect(() => {
    if (allFacilitiesRef.current.length > 0)
      renderFacilities(allFacilitiesRef.current, currentZoom);
  }, [currentZoom, hiddenFacilities, renderFacilities, renderTick]);

  return null;
}

function EvacuationCentersLayer({
  onCentersLoaded,
  visible = true,
  onFacilityClick,
}) {
  const map = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentZoom, setCurrentZoom] = useState(map.getZoom());
  const clusterRef = useRef(null);
  const allCentersRef = useRef([]);
  const onCentersRef = useRef(onCentersLoaded);
  const onFacilityClickRef = useRef(onFacilityClick);
  const visibleRef = useRef(visible);
  const [renderTick, setRenderTick] = useState(0);

  useEffect(() => {
    visibleRef.current = visible;
    setRenderTick((t) => t + 1);
  }, [visible]);
  useEffect(() => {
    onCentersRef.current = onCentersLoaded;
  }, [onCentersLoaded]);
  useEffect(() => {
    onFacilityClickRef.current = onFacilityClick;
  }, [onFacilityClick]);
  useEffect(() => {
    const h = () => setCurrentZoom(map.getZoom());
    map.on("zoomend", h);
    return () => map.off("zoomend", h);
  }, [map]);

  const popupHtml = (row) =>
    `<div style="min-width: 210px; font-family: Arial, sans-serif; font-size: 12px; line-height: 1.5;"><strong style="font-size: 13px;">${row.name}</strong><br><span style="color:#555;">District: ${row.district || "N/A"}</span><br>${row.location ? `Location: ${row.location}<br>` : ""}${row.proximity ? `Proximity: ${row.proximity}<br>` : ""}${row.floor_area_sqm != null ? `Floor area: ${row.floor_area_sqm} sqm<br>` : ""}${row.remarks ? `<em style="color:#b00020;">${row.remarks}</em><br>` : ""}<span style="font-size:10px; color:#999;">Center No. ${row.center_no}</span></div>`;
  const markerIcon = () =>
    L.divIcon({
      html: `<div style="font-size:22px;line-height:22px;text-shadow:0 0 3px #fff,0 0 2px #fff;">⛺</div>`,
      iconSize: [24, 24],
      className: "custom-evac-marker",
    });

  const render = useCallback(
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
      if (valid.length === 0) {
        setLoading(false);
        return;
      }

      if (zoomLevel < 13) {
        const cg = L.markerClusterGroup({
          maxClusterRadius: 45,
          iconCreateFunction: function (cluster) {
            const count = cluster.getChildCount();
            const size = 34 + Math.min(20, count);
            const div = document.createElement("div");
            div.style.cssText = `width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:#d32f2f;color:#fff;font-weight:bold;font-family:Arial,sans-serif;font-size:13px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);`;
            div.innerHTML = `⛺<span style="font-size:11px;margin-left:2px;">${count}</span>`;
            return L.divIcon({
              html: div.outerHTML,
              iconSize: [size, size],
              className: "custom-cluster-icon",
            });
          },
        });
        valid.forEach((row) => {
          const marker = L.marker([row.latitude, row.longitude], {
            icon: markerIcon(),
            pane: "facilities-pane",
          }).bindPopup(popupHtml(row));
          marker.on("click", () => {
            if (onFacilityClickRef.current) {
              // Convert to facility format for consistency
              onFacilityClickRef.current(evacCenterToFacility(row));
            }
          });
          marker.addTo(cg);
        });
        cg.addTo(map);
        clusterRef.current = cg;
      } else {
        const group = L.layerGroup();
        valid.forEach((row) => {
          const marker = L.marker([row.latitude, row.longitude], {
            icon: markerIcon(),
            pane: "facilities-pane",
          }).bindPopup(popupHtml(row));
          marker.on("click", () => {
            if (onFacilityClickRef.current) {
              onFacilityClickRef.current(evacCenterToFacility(row));
            }
          });
          marker.addTo(group);
        });
        group.addTo(map);
        clusterRef.current = group;
      }
      setLoading(false);
    },
    [map],
  );

  const renderRef = useRef(render);
  useEffect(() => {
    renderRef.current = render;
  }, [render]);

  useEffect(() => {
    let mounted = true;
    const fetch = async () => {
      try {
        setLoading(true);
        setError(null);

        // Check cache first
        if (APP_CACHE.evacCenters) {
          allCentersRef.current = APP_CACHE.evacCenters;
          onCentersRef.current?.(APP_CACHE.evacCenters);
          renderRef.current?.(APP_CACHE.evacCenters, map.getZoom());
          setLoading(false);
          return;
        }

        const { data, error: qe } = await supabase
          .from("evacuation_centers")
          .select(
            "id, center_no, district, name, location, proximity, floor_area_sqm, remarks, latitude, longitude",
          );
        if (qe) throw qe;
        if (mounted && data) {
          APP_CACHE.evacCenters = data; // Save to cache
          allCentersRef.current = data;
          onCentersRef.current?.(data);
          renderRef.current?.(data, map.getZoom());
        }
      } catch (err) {
        if (mounted) {
          setError(`Failed to load evacuation centers: ${err.message}`);
          setLoading(false);
        }
      }
    };
    fetch();
    return () => {
      mounted = false;
      if (clusterRef.current && map) {
        map.removeLayer(clusterRef.current);
        clusterRef.current = null;
      }
    };
  }, [map]);

  useEffect(() => {
    if (allCentersRef.current.length > 0)
      render(allCentersRef.current, currentZoom);
  }, [currentZoom, render, renderTick]);

  return null;
}

function findBarangayForPoint(latlng, barangayData) {
  if (!barangayData) return null;
  const pt = [latlng.lng, latlng.lat];
  const match = barangayData.features.find((feature) =>
    booleanPointInPolygon(pt, feature),
  );
  if (!match) return null;
  const props = match.properties || {};
  return {
    name: props.adm4_name,
    risk: props.fsi_risk,
    population: props.population ?? null,
    probability: props.fsi_probability ?? null,
    lat: props.centroid_lat ?? null,
    lng: props.centroid_lng ?? null,
    top_factors: [],
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
  onMapClick, // NEW
}) {
  const map = useMap();
  const [mode, setMode] = useState("idle");
  const [origin, setOrigin] = useState(null);
  const [results, setResults] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [outsideBoundary, setOutsideBoundary] = useState(false);
  const layerRef = useRef(null);

  const originBarangay = useMemo(
    () => (origin ? findBarangayForPoint(origin, barangayData) : null),
    [origin, barangayData],
  );

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
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

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

  const isInsideBoundary = useCallback(
    (latlng) => {
      if (!cityBoundary) return true;
      return booleanPointInPolygon([latlng.lng, latlng.lat], cityBoundary);
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
        const active = selectedTypes || [];
        const healthTypes = active.filter((t) => t !== EVACUATION_CENTER_TYPE);
        const evacSelected = active.includes(EVACUATION_CENTER_TYPE);
        let filtered;
        if (active.length === 0)
          filtered = [...(facilities || []), ...evacAsFacility];
        else {
          const parts = [];
          if (healthTypes.length > 0)
            parts.push(
              ...(facilities || []).filter((f) => healthTypes.includes(f.type)),
            );
          if (evacSelected) parts.push(...evacAsFacility);
          filtered = parts;
        }
        if (filtered.length === 0) {
          const names = active.length === 0 ? "facilities" : active.join(", ");
          throw new Error(`No matching ${names} available`);
        }
        const oc = [latlng.lat, latlng.lng];
        const cands = kNearestByHaversine(oc, filtered, 15);
        const ranked = await fetchRoadDistances(oc, cands);
        const valid = ranked.filter((r) => r.distanceMeters != null);
        if (valid.length === 0)
          throw new Error("No reachable facility found by road");
        valid.sort((a, b) => a.distanceMeters - b.distanceMeters);
        const top = valid.slice(0, 3);
        const routes = await Promise.all(
          top.map(async (item) => {
            const r = await fetchRoadRoute(oc, [
              item.facility.lat,
              item.facility.lon,
            ]);
            return { ...item, routeGeoJSON: r.geometry };
          }),
        );
        setResults(routes);
        setMode("done");
        onNearestFacilitiesFound?.(top.map((i) => i.facility));
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
      if (!isInsideBoundary(latlng)) {
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
    [mode, isInsideBoundary, runSearch, onClearHighlight],
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
    if (origin) map.setView([origin.lat, origin.lng], 14);
  }, [origin, map]);

  useMapEvents({
    click(e) {
      if (onMapClickRef.current) onMapClickRef.current(); // Clear selection

      const m = mapModeRef.current;
      if (m === "barangay") {
        const b = findBarangayForPoint(e.latlng, barangayDataRef.current);
        if (b) onBarangaySelectRef.current?.(b);
        return;
      }
      if (m === "marker") handleNewOrigin(e.latlng);
      // m === "none": map clicks do nothing
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
        let msg = err.message;
        if (err.code === 1)
          msg =
            "Location permission was denied. You can still click the map directly to find the nearest facility.";
        else if (err.code === 2)
          msg =
            "Your location couldn't be determined. Check that Location Services are enabled for your browser, or click the map directly instead.";
        else if (err.code === 3)
          msg =
            "Location request timed out. Try again, or click the map directly.";
        setErrorMsg(msg);
        setMode("error");
        onClearHighlight?.();
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  }, [handleNewOrigin, onClearHighlight]);

  const resetOutsideBoundary = useCallback(() => setOutsideBoundary(false), []);
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
    if (!origin) onClearHighlight?.();
  }, [origin, onClearHighlight]);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!origin) return;

    if (!map.getPane("routes-pane")) {
      const rp = map.createPane("routes-pane");
      rp.style.zIndex = 645;
      rp.style.pointerEvents = "none";
    }
    if (!map.getPane("facilities-pane")) {
      const fp = map.createPane("facilities-pane");
      fp.style.zIndex = 650;
    }

    const group = L.layerGroup();
    L.marker(origin, {
      icon: L.divIcon({
        html: `<div style="font-size:26px;">📍</div>`,
        iconSize: [26, 26],
        className: "custom-poi-marker",
      }),
      pane: "facilities-pane",
    }).addTo(group);
    const bounds = L.latLngBounds(
      [origin.lat, origin.lng],
      [origin.lat, origin.lng],
    );

    results.forEach((item, i) => {
      const color = ROUTE_COLORS[i] || "#9e9e9e";
      const ll = [item.facility.lat, item.facility.lon];
      bounds.extend(ll);

      if (item.routeGeoJSON)
        L.geoJSON(item.routeGeoJSON, {
          pane: "routes-pane",
          interactive: false,
          style: { color, weight: 5, opacity: 0.95 },
        }).addTo(group);

      L.marker(ll, {
        icon: L.divIcon({
          html: `<div style="font-size:20px;background:${color};color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:bold;box-shadow:0 0 4px rgba(0,0,0,0.3);">${i + 1}</div>`,
          iconSize: [24, 24],
          className: "custom-poi-marker",
        }),
        pane: "facilities-pane",
      })
        .bindPopup(
          `<strong>#${i + 1} ${item.facility.name}</strong><br>${(item.distanceMeters / 1000).toFixed(2)} km, ${Math.round(item.durationSeconds / 60)} min`,
        )
        .addTo(group);
    });

    group.addTo(map);
    layerRef.current = group;

    if (results.length > 0)
      map.fitBounds(bounds, {
        padding: [50, 50],
        maxZoom: 15,
        animate: true,
        duration: 0.5,
      });
    else map.setView([origin.lat, origin.lng], 14);

    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current);
    };
  }, [origin, results, map]);

  return null;
}

function ZamboangaMask({
  onBoundaryLoaded,
  onBarangaysLoaded,
  rasterActive,
  fsiVisible,
  mapMode,
  selectedBarangayName,
  fsiModel,
  onFsiStatusChange,
}) {
  const map = useMap();
  const barangayLayerRef = useRef(null);
  const maskLayerRef = useRef(null);
  const borderLayerRef = useRef(null);
  const maritimeLayerRef = useRef(null);
  const barangayLayersByNameRef = useRef({});
  const prevSelectedRef = useRef(null);
  const barangayDataRef = useRef(null);
  const popMapRef = useRef(null);
  const activeTooltipRef = useRef(null);

  const rasterActiveRef = useRef(rasterActive);
  useEffect(() => {
    rasterActiveRef.current = rasterActive;
  }, [rasterActive]);
  const fsiVisibleRef = useRef(fsiVisible);
  useEffect(() => {
    fsiVisibleRef.current = fsiVisible;
  }, [fsiVisible]);
  const mapModeRef = useRef(mapMode);
  useEffect(() => {
    mapModeRef.current = mapMode;
  }, [mapMode]);

  const getBaseFill = () => {
    if (!fsiVisibleRef.current) return 0;
    return rasterActiveRef.current ? 0.12 : FSI_OPACITY.normal;
  };
  const getBaseBorder = () =>
    fsiVisibleRef.current ? FSI_OPACITY.borderOpacity : 0;

  useEffect(() => {
    if (!map) return;
    const handleMapMouseOut = () => {
      if (activeTooltipRef.current) {
        activeTooltipRef.current.closeTooltip();
        activeTooltipRef.current = null;
      }
    };
    map.on("mouseout", handleMapMouseOut);
    return () => {
      map.off("mouseout", handleMapMouseOut);
    };
  }, [map]);

  useEffect(() => {
    let cancelled = false;
    if (!map.getPane("fsi-pane")) {
      const pane = map.createPane("fsi-pane");
      pane.style.zIndex = 640;
    }
    const tp = map.getPane("tooltipPane");
    if (tp) tp.style.zIndex = 660;

    const fetchBoundaries = async () => {
      let cityData = APP_CACHE.cityBoundary;
      if (!cityData) {
        const res = await fetch("/zamboanga_city_boundary.geojson");
        cityData = await res.json();
        APP_CACHE.cityBoundary = cityData;
      }

      let barangayData = APP_CACHE.barangays;
      if (!barangayData) {
        const res = await fetch("/zamboanga_city_barangays.geojson");
        barangayData = await res.json();
        APP_CACHE.barangays = barangayData;
      }

      const popMap = await fetchBarangayPopulations();
      const maritime = await fetchZamboangaMaritimeBoundary();

      return [cityData, barangayData, popMap, maritime];
    };

    fetchBoundaries().then(([cityData, barangayData, popMap, maritime]) => {
      if (cancelled) return;
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
      maskLayerRef.current = L.geoJSON(maskGeoJSON, {
        style: {
          color: "transparent",
          weight: 0,
          fillColor: "#d9d9d9",
          fillOpacity: 0.12,
        },
        interactive: false,
      }).addTo(map);
      borderLayerRef.current = L.geoJSON(cityData, {
        style: { color: "#e8401c", weight: 2.5, opacity: 1, fill: false },
        interactive: false,
      }).addTo(map);
      if (maritime?.features?.length)
        maritimeLayerRef.current = L.geoJSON(maritime, {
          style: {
            color: "#3388ff",
            weight: 1.5,
            opacity: 0.85,
            dashArray: "6, 6",
          },
          interactive: false,
        }).addTo(map);

      barangayDataRef.current = barangayData;
      popMapRef.current = popMap;
    });

    return () => {
      cancelled = true;
      if (maskLayerRef.current) map.removeLayer(maskLayerRef.current);
      if (borderLayerRef.current) map.removeLayer(borderLayerRef.current);
      if (barangayLayerRef.current) map.removeLayer(barangayLayerRef.current);
      if (maritimeLayerRef.current) map.removeLayer(maritimeLayerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    let cancelled = false;
    const build = async () => {
      onFsiStatusChange?.("boundaries");
      try {
        let waited = 0;
        while (!barangayDataRef.current && waited < 10000 && !cancelled) {
          await new Promise((r) => setTimeout(r, 100));
          waited += 100;
        }
        if (cancelled || !barangayDataRef.current) return;

        onFsiStatusChange?.("predicting");

        const barangayData = barangayDataRef.current;
        const popMap = popMapRef.current;
        const fsiMap = await resolveBarangayFsi(
          barangayData.features,
          fsiModel,
        );
        if (cancelled) return;

        let unmatched = 0;
        const featuresWithRisk = barangayData.features.map((f) => {
          const name = f.properties.adm4_name || "";
          let population = null;
          for (const k of buildNameKeys(name)) {
            if (popMap?.has(k)) {
              population = popMap.get(k);
              break;
            }
          }
          if (population == null) {
            unmatched += 1;
            console.warn("Unmatched:", name);
          }
          const fsi = fsiMap.get(name) || {};
          return {
            ...f,
            properties: {
              ...f.properties,
              fsi_risk: fsi.risk || "Low Risk",
              fsi_probability: fsi.probability ?? null,
              centroid_lat: fsi.centroid?.lat ?? null,
              centroid_lng: fsi.centroid?.lng ?? null,
              population,
            },
          };
        });

        if (unmatched > 0)
          console.warn(
            `Population data: ${unmatched} barangay(s) unmatched in PSA spreadsheet.`,
          );

        const updated = { ...barangayData, features: featuresWithRisk };
        onBarangaysLoaded?.(updated);

        if (barangayLayerRef.current) map.removeLayer(barangayLayerRef.current);
        barangayLayersByNameRef.current = {};
        prevSelectedRef.current = null;

        const layer = L.geoJSON(updated, {
          pane: "fsi-pane",
          style: (feat) => {
            const risk = feat?.properties?.fsi_risk || "Low Risk";
            const show = fsiVisibleRef.current;
            return {
              color: show ? "#ffffff" : "transparent",
              weight: 1,
              opacity: getBaseBorder(),
              fillColor: show
                ? RISK_LEVELS[risk] || RISK_LEVELS["Low Risk"]
                : "transparent",
              fillOpacity: getBaseFill(),
            };
          },
          interactive: true,
          onEachFeature: (feat, ly) => {
            const name = feat.properties.adm4_name;
            const risk = feat.properties.fsi_risk;
            const pop = feat.properties.population;
            const prob = feat.properties.fsi_probability;
            barangayLayersByNameRef.current[name] = ly;

            const popLine =
              pop != null
                ? `Population: ${pop.toLocaleString()}`
                : "Population: N/A";
            const probLine =
              typeof prob === "number"
                ? `<br>Probability: ${(prob * 100).toFixed(1)}%`
                : "";

            ly.bindTooltip(
              `${name}<br><strong>FSI: ${risk}</strong>${probLine}<br>${popLine}`,
              {
                permanent: false,
                direction: "center",
                className: "barangay-label",
                sticky: true,
                interactive: false,
              },
            );

            ly.on("mouseover", function () {
              const show = fsiVisibleRef.current;
              if (mapModeRef.current === "barangay") {
                if (prevSelectedRef.current !== this && show)
                  this.setStyle({ fillOpacity: FSI_OPACITY.hover, weight: 2 });
                else this.setStyle({ weight: 2 });
              } else {
                if (show)
                  this.setStyle({ fillOpacity: FSI_OPACITY.hover, weight: 2 });
                else this.setStyle({ weight: 2, fillOpacity: 0, opacity: 0 });
              }
              if (show) {
                if (
                  activeTooltipRef.current &&
                  activeTooltipRef.current !== this
                )
                  activeTooltipRef.current.closeTooltip();
                this.openTooltip();
                activeTooltipRef.current = this;
              }
            });

            ly.on("mouseout", function () {
              const show = fsiVisibleRef.current;
              const r = this.feature?.properties?.fsi_risk || "Low Risk";
              if (prevSelectedRef.current !== this) {
                this.setStyle({
                  fillColor: show
                    ? RISK_LEVELS[r] || RISK_LEVELS["Low Risk"]
                    : "transparent",
                  color: show ? "#ffffff" : "transparent",
                  fillOpacity: getBaseFill(),
                  weight: 1,
                  opacity: getBaseBorder(),
                });
              }
              if (activeTooltipRef.current === this) {
                this.closeTooltip();
                activeTooltipRef.current = null;
              }
            });
          },
        }).addTo(map);
        barangayLayerRef.current = layer;
      } finally {
        if (!cancelled) onFsiStatusChange?.(null);
      }
    };
    build();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fsiModel]);

  useEffect(() => {
    const layer = barangayLayerRef.current;
    if (!layer) return;
    layer.eachLayer((l) => {
      const risk = l.feature?.properties?.fsi_risk || "Low Risk";
      const show = fsiVisibleRef.current;
      l.setStyle({
        color: show ? "#ffffff" : "transparent",
        weight: 1,
        opacity: getBaseBorder(),
        fillColor: show ? RISK_LEVELS[risk] : "transparent",
        fillOpacity: getBaseFill(),
      });
    });
    if (layer.redraw) layer.redraw();
  }, [rasterActive, fsiVisible]);

  useEffect(() => {
    if (prevSelectedRef.current) {
      const show = fsiVisibleRef.current;
      const risk =
        prevSelectedRef.current.feature?.properties?.fsi_risk || "Low Risk";
      prevSelectedRef.current.setStyle({
        fillColor: show
          ? RISK_LEVELS[risk] || RISK_LEVELS["Low Risk"]
          : "transparent",
        color: show ? "#ffffff" : "transparent",
        weight: 1,
        opacity: getBaseBorder(),
        fillOpacity: getBaseFill(),
      });
      prevSelectedRef.current = null;
    }
    if (!selectedBarangayName) return;
    const layer = barangayLayersByNameRef.current[selectedBarangayName];
    if (!layer) return;
    layer.setStyle({
      color: "#2563eb",
      weight: 3,
      opacity: fsiVisible ? 1 : 0,
      fillOpacity: fsiVisible ? FSI_OPACITY.selected : 0,
    });
    if (layer.bringToFront) layer.bringToFront();
    prevSelectedRef.current = layer;
    if (layer.getBounds)
      map.fitBounds(layer.getBounds(), {
        padding: [40, 40],
        maxZoom: 14,
        animate: true,
        duration: 0.5,
      });
  }, [selectedBarangayName, fsiVisible, map]);

  return null;
}

function FacilityTypeControl({
  facilityTypes = [],
  selectedTypes = [],
  onSelectAllTypes,
  onToggleType,
  facilitiesVisible,
  onToggleFacilitiesVisibility,
  compact = false,
  openOverlay,
  setOpenOverlay,
}) {
  const ref = useRef(null);
  const open = openOverlay === "facility";

  useEffect(() => {
    if (!ref.current) return;
    L.DomEvent.disableClickPropagation(ref.current);
    L.DomEvent.disableScrollPropagation(ref.current);
  }, []);

  if (!facilityTypes || facilityTypes.length === 0) return null;

  const glass = {
    backgroundColor: "rgba(255,255,255,0.88)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    borderRadius: "10px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    border: "1px solid rgba(255,255,255,0.4)",
    fontFamily: "Arial, sans-serif",
  };

  const chip = (active) => ({
    padding: "5px 9px",
    fontSize: "11px",
    fontWeight: active ? 600 : 500,
    border: "none",
    borderRadius: "999px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
    backgroundColor: active ? "#2563eb" : "rgba(0,0,0,0.05)",
    color: active ? "#fff" : "#333",
    boxShadow: active ? "0 1px 4px rgba(37,99,235,0.4)" : "none",
    transition: "all 0.15s ease",
  });

  const eyeBtn = (
    <button
      type="button"
      onClick={onToggleFacilitiesVisibility}
      title={
        facilitiesVisible
          ? "Hide facilities on the map"
          : "Show facilities on the map"
      }
      aria-label={facilitiesVisible ? "Hide facilities" : "Show facilities"}
      style={{
        width: 28,
        height: 28,
        flexShrink: 0,
        border: "none",
        borderRadius: "50%",
        background: "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: facilitiesVisible ? "#333" : "#999",
      }}
    >
      {facilitiesVisible ? <Eye size={16} /> : <EyeOff size={16} />}
    </button>
  );

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: compact ? "124px" : "136px",
        left: compact ? "12px" : "16px",
        zIndex: 2000,
        pointerEvents: "auto",
      }}
    >
      {!open ? (
        <button
          type="button"
          onClick={() => setOpenOverlay("facility")}
          aria-label="Open facility filter"
          title="Facility filter"
          style={{
            ...glass,
            padding: "7px 10px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "11px",
            fontWeight: 600,
            color: "#333",
            cursor: "pointer",
          }}
        >
          <SlidersHorizontal size={14} />
          <span>
            {selectedTypes.length === 0
              ? "All facilities"
              : `${selectedTypes.length} selected`}
          </span>
          {!facilitiesVisible && <EyeOff size={13} color="#999" />}
        </button>
      ) : (
        <div
          className="overlay-animate-in"
          style={{
            ...glass,
            padding: "8px",
            minWidth: "150px",
            maxWidth: compact ? "calc(100vw - 24px - 176px - 8px)" : "340px",
            transformOrigin: "top left",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "6px",
            }}
          >
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: "#70757a",
              }}
            >
              Facility type
            </span>
            <div style={{ display: "flex", alignItems: "center" }}>
              {eyeBtn}
              <button
                type="button"
                onClick={() => setOpenOverlay(null)}
                aria-label="Collapse facility filter"
                title="Collapse"
                style={{
                  width: 28,
                  height: 28,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "#666",
                  fontSize: 13,
                }}
              >
                ✕
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            <button
              type="button"
              onClick={onSelectAllTypes}
              style={chip(selectedTypes.length === 0)}
              title="Show all health facilities and evacuation centers"
            >
              All
            </button>
            {facilityTypes.map((type) => {
              const active = selectedTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onToggleType(type)}
                  style={chip(active)}
                  title={
                    active
                      ? `Remove ${type} from filter`
                      : `Add ${type} to filter`
                  }
                >
                  {type}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function QGISLegend({
  layerKey,
  config,
  stats,
  compact = false,
  qgisOpen,
  setQgisOpen,
}) {
  const map = useMap();
  const [host, setHost] = useState(null);
  const t = getLegendTheme(compact);
  const open = qgisOpen;

  useEffect(() => {
    const ctrl = L.control({ position: "topright" });
    ctrl.onAdd = () => {
      const div = L.DomUtil.create("div", "qgis-legend-control");
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      return div;
    };
    ctrl.addTo(map);
    setHost(ctrl.getContainer());
    return () => {
      ctrl.remove();
      setHost(null);
    };
  }, [map]);

  const ready = !!(
    layerKey &&
    config &&
    stats &&
    stats.minVal != null &&
    stats.maxVal != null
  );

  useEffect(() => {
    if (!host) return;
    host.style.marginTop = ready ? px(t.stackGap) : "0px";
    host.style.marginRight = px(t.marginRight);
    host.style.marginBottom = "0px";
    host.style.display = ready ? "" : "none";
  }, [host, ready, t.stackGap, t.marginRight]);

  if (!host || !ready) return null;

  const stops = buildLegendStops(config.colorScale, stats.minVal, stats.maxVal);

  if (compact && !open) {
    return createPortal(
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setQgisOpen(true);
        }}
        title={`${config.name} legend`}
        aria-label={`Show ${config.name} legend`}
        style={{
          ...legendBaseStyle(t),
          width: "auto",
          maxWidth: "calc(100vw - 32px)",
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 36,
            height: 8,
            borderRadius: 4,
            flexShrink: 0,
            background: `linear-gradient(to right, ${stops.map((s) => s.color).join(", ")})`,
            border: "1px solid rgba(0,0,0,0.12)",
          }}
        />
        <span
          style={{
            fontSize: t.labelSize,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 120,
          }}
        >
          {config.name}
        </span>
        <ChevronUp
          size={12}
          color="#777"
          style={{ flexShrink: 0, transform: "rotate(180deg)" }}
        />
      </button>,
      host,
    );
  }

  return createPortal(
    <div style={legendBaseStyle(t)} onClick={(e) => e.stopPropagation()}>
      <div style={legendHeaderStyle(t)}>
        <div style={legendTitleStyle(t)}>{config.name}</div>
        {compact && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setQgisOpen(false);
            }}
            aria-label="Collapse legend"
            title="Collapse"
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: "2px 4px",
              color: "#666",
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            <ChevronUp size={14} />
          </button>
        )}
      </div>
      <div style={legendBodyStyle(t)}>
        {stops.map((s, i) => (
          <div key={i} style={legendRowStyle(t)}>
            <div style={legendSwatchStyle(t, s.color)} />
            <span style={legendLabelStyle(t)}>
              {formatRasterValue(s.v0)} – {formatRasterValue(s.v1)}
              {config.unit || ""}
            </span>
          </div>
        ))}
      </div>
    </div>,
    host,
  );
}

function QGISRasterLayer({
  layerKey,
  isActive,
  cityBoundary,
  onLoadingChange,
  onLoadError,
  onRasterLoaded,
  onProgress,
}) {
  const map = useMap();
  const layerRef = useRef(null);
  const attemptedRef = useRef(false);
  const mountedRef = useRef(true);
  const boundaryRef = useRef(cityBoundary);

  useEffect(() => {
    boundaryRef.current = cityBoundary;
  }, [cityBoundary]);

  useEffect(() => {
    if (!map.getPane("qgis-pane")) {
      const p = map.createPane("qgis-pane");
      p.style.zIndex = 600;
      p.style.pointerEvents = "none";
    }
  }, [map]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const tick = () => new Promise((r) => setTimeout(r, 0));

    const load = async () => {
      if (!isActive || !mountedRef.current) {
        if (layerRef.current) {
          map.removeLayer(layerRef.current);
          layerRef.current = null;
        }
        onLoadError?.(layerKey, null);
        onRasterLoaded?.(layerKey, null);
        attemptedRef.current = false;
        onLoadingChange?.(layerKey, false);
        return;
      }
      if (attemptedRef.current && layerRef.current) return;

      // CHECK CACHE FIRST
      if (APP_CACHE.qgis[layerKey]) {
        const cached = APP_CACHE.qgis[layerKey];
        if (layerRef.current) map.removeLayer(layerRef.current);

        const overlay = L.imageOverlay(cached.dataUrl, cached.bounds, {
          opacity: QGIS_LAYER_CONFIGS[layerKey].opacity || 0.8,
          interactive: false,
          pane: "qgis-pane",
        });
        overlay.addTo(map);
        layerRef.current = overlay;

        onRasterLoaded?.(layerKey, cached.stats);
        onProgress?.(layerKey, 100);
        map.fitBounds(cached.bounds, { padding: [50, 50] });
        attemptedRef.current = true;
        onLoadingChange?.(layerKey, false);
        return;
      }

      const config = QGIS_LAYER_CONFIGS[layerKey];
      try {
        onLoadingChange?.(layerKey, true);
        onLoadError?.(layerKey, null);
        onProgress?.(layerKey, 0);
        attemptedRef.current = true;

        // ---- Download (0–70%) ----
        const res = await fetch(config.path, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

        const total = Number(res.headers.get("content-length")) || 0;
        let buf;
        if (res.body && total > 0) {
          const reader = res.body.getReader();
          const chunks = [];
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            onProgress?.(
              layerKey,
              Math.min(70, Math.round((received / total) * 70)),
            );
          }
          const merged = new Uint8Array(received);
          let off = 0;
          for (const c of chunks) {
            merged.set(c, off);
            off += c.length;
          }
          buf = merged.buffer;
        } else {
          buf = await res.arrayBuffer();
        }
        if (cancelled) return;
        onProgress?.(layerKey, 72);
        await tick();

        // ---- Decode (72–85%) ----
        const tiff = await geotiff.fromArrayBuffer(buf);
        const image = await tiff.getImage();
        const bbox = image.getBoundingBox();
        const width = image.getWidth();
        const height = image.getHeight();
        const data = await image.readRasters();
        if (cancelled) return;
        onProgress?.(layerKey, 85);
        await tick();

        let noDataValue = null;
        try {
          const nd = image.getGDALNoData ? image.getGDALNoData() : null;
          if (nd !== null && nd !== undefined && !Number.isNaN(Number(nd)))
            noDataValue = Number(nd);
        } catch {}

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const img = ctx.createImageData(width, height);
        const values = data[0];
        let minVal = Infinity,
          maxVal = -Infinity;
        for (let i = 0; i < values.length; i++) {
          if (noDataValue != null && values[i] === noDataValue) continue;
          if (values[i] < minVal) minVal = values[i];
          if (values[i] > maxVal) maxVal = values[i];
        }
        const range = maxVal - minVal;
        onProgress?.(layerKey, 90);
        await tick();

        // ---- Colorize (90–95%) ----
        for (let i = 0; i < values.length; i++) {
          const idx = i * 4;
          if (noDataValue != null && values[i] === noDataValue) {
            img.data[idx + 3] = 0;
            continue;
          }
          const n = range > 0 ? (values[i] - minVal) / range : 0;
          const [r, g, b] = getColorRamp(n, config.colorScale);
          img.data[idx] = r;
          img.data[idx + 1] = g;
          img.data[idx + 2] = b;
          img.data[idx + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        if (cancelled) return;
        onProgress?.(layerKey, 95);
        await tick();

        // ---- Clip + overlay (95–99%) ----
        let outCanvas = canvas;
        const rings = getClipRingsFromBoundary(
          boundaryRef.current,
          bbox,
          width,
          height,
        );
        if (rings.length > 0) {
          const cc = document.createElement("canvas");
          cc.width = width;
          cc.height = height;
          const cctx = cc.getContext("2d");
          cctx.save();
          cctx.beginPath();
          rings.forEach((ring) => {
            ring.forEach(([x, y], i) => {
              if (i === 0) cctx.moveTo(x, y);
              else cctx.lineTo(x, y);
            });
            cctx.closePath();
          });
          cctx.clip("evenodd");
          cctx.drawImage(canvas, 0, 0);
          cctx.restore();
          outCanvas = cc;
        }

        const dataUrl = outCanvas.toDataURL("image/png");
        onProgress?.(layerKey, 99);

        const [west, south, east, north] = bbox;
        const bl = utmToLatLng(west, south);
        const tr = utmToLatLng(east, north);
        const bounds = [
          [bl.lat, bl.lng],
          [tr.lat, tr.lng],
        ];

        if (cancelled || !mountedRef.current) return;
        if (layerRef.current) map.removeLayer(layerRef.current);

        const overlay = L.imageOverlay(dataUrl, bounds, {
          opacity: config.opacity || 0.8,
          interactive: false,
          pane: "qgis-pane",
        });
        overlay.addTo(map);
        layerRef.current = overlay;

        const stats = {
          values,
          width,
          height,
          bbox,
          noDataValue,
          minVal,
          maxVal,
        };

        // SAVE TO CACHE
        APP_CACHE.qgis[layerKey] = { dataUrl, bounds, stats };

        onRasterLoaded?.(layerKey, stats);
        onProgress?.(layerKey, 100);
        map.fitBounds(bounds, { padding: [50, 50] });
      } catch (err) {
        if (err.name === "AbortError" || cancelled) return;
        console.error(`[QGIS] Failed ${layerKey}:`, err);
        if (mountedRef.current) {
          onLoadError?.(layerKey, err.message || "Failed to load layer");
          onRasterLoaded?.(layerKey, null);
          attemptedRef.current = false;
        }
      } finally {
        if (mountedRef.current) onLoadingChange?.(layerKey, false);
      }
    };

    load();
    return () => {
      cancelled = true;
      controller.abort();
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      onRasterLoaded?.(layerKey, null);
      onLoadingChange?.(layerKey, false);
      attemptedRef.current = false;
    };
  }, [
    map,
    layerKey,
    isActive,
    onLoadingChange,
    onLoadError,
    onRasterLoaded,
    onProgress,
  ]);

  return null;
}

function QGISHoverTooltip({ rasterDataRef }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const tooltipEl = document.createElement("div");
    tooltipEl.style.cssText = `position: absolute; z-index: 1000; pointer-events: none; background: rgba(0,0,0,0.78); color: #fff; font-size: 11px; font-family: Arial, sans-serif; padding: 6px 9px; border-radius: 4px; line-height: 1.5; display: none; white-space: nowrap; box-shadow: 0 1px 4px rgba(0,0,0,0.3);`;
    container.appendChild(tooltipEl);

    const fmt = (v) => {
      const a = Math.abs(v);
      if (a >= 1000) return v.toFixed(0);
      if (a >= 10) return v.toFixed(1);
      return v.toFixed(2);
    };

    const onMove = (e) => {
      const keys = Object.keys(rasterDataRef.current || {});
      if (keys.length === 0) {
        tooltipEl.style.display = "none";
        return;
      }
      const lines = [];
      for (const key of keys) {
        const info = rasterDataRef.current[key];
        if (!info) continue;
        const v = getRasterValueAtLatLng(e.latlng, info);
        if (v == null) continue;
        const cfg = QGIS_LAYER_CONFIGS[key];
        lines.push(
          `<strong>${cfg?.name || key}:</strong> ${fmt(v)}${cfg?.unit || ""}`,
        );
      }
      if (lines.length === 0) {
        tooltipEl.style.display = "none";
        return;
      }
      tooltipEl.innerHTML = lines.join("<br>");
      tooltipEl.style.display = "block";
      const p = map.latLngToContainerPoint(e.latlng);
      const cw = container.clientWidth;
      const tw = tooltipEl.offsetWidth;
      tooltipEl.style.left = `${p.x + 16 + tw > cw ? p.x - tw - 16 : p.x + 16}px`;
      tooltipEl.style.top = `${p.y + 16}px`;
    };
    const onLeave = () => {
      tooltipEl.style.display = "none";
    };
    map.on("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    return () => {
      map.off("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
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
    default: {
      const g = Math.round(value * 255);
      return [g, g, g];
    }
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
  onProgress,
}) {
  return (
    <>
      {activeLayers.map((k) => (
        <QGISRasterLayer
          key={k}
          layerKey={k}
          isActive={true}
          cityBoundary={cityBoundary}
          onLoadingChange={onLoadingChange}
          onLoadError={onLoadError}
          onRasterLoaded={onRasterLoaded}
          onProgress={onProgress}
        />
      ))}
    </>
  );
}

function FactorsListSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Top Contributing Factors
        </div>
      </div>
      <div className="rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground leading-relaxed">
        <Skeleton className="h-3.5 w-3/4 mb-2" />
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          <div className="flex items-center gap-1">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="flex items-center gap-1">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </div>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="text-xs">
          <div className="flex justify-between items-baseline mb-0.5 gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="h-3 w-48 mb-1" />
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}

function FactorsList({ factors, loading, error }) {
  if (loading) return <FactorsListSkeleton />;
  if (error)
    return (
      <div className="text-xs text-red-500">
        Factor breakdown unavailable: {error}
      </div>
    );
  if (!factors || factors.length === 0) return null;

  const maxAbs = Math.max(
    ...factors.map((f) => Math.abs(f.contribution)),
    1e-9,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Top Contributing Factors
        </div>
      </div>
      <div className="rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground leading-relaxed">
        Each factor below shows how much it pushed <em>this barangay's</em>{" "}
        flood probability.
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[#d73027]" />
            <strong className="text-[#d73027]">Higher risk</strong> — raises
            flood probability
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[#4575b4]" />
            <strong className="text-[#4575b4]">Lower risk</strong> — reduces
            flood probability
          </span>
        </div>
      </div>
      {factors.map((f, i) => {
        const info = getFactorInfo(f.feature);
        const pct = (Math.abs(f.contribution) / maxAbs) * 100;
        const positive = f.contribution > 0;
        const barColor = positive ? "#d73027" : "#4575b4";
        return (
          <div key={i} className="text-xs">
            <div className="flex justify-between items-baseline mb-0.5 gap-2">
              <span className="font-medium truncate" title={info.label}>
                {info.label}
              </span>
              <span
                className="ml-2 tabular-nums shrink-0"
                style={{ color: barColor, fontWeight: 600 }}
              >
                {positive ? "↑" : "↓"}{" "}
                {(Math.abs(f.contribution) * 100).toFixed(1)}%
              </span>
            </div>
            {info.desc && (
              <div className="text-[10px] text-muted-foreground leading-snug mb-1">
                {info.desc}
              </div>
            )}
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: barColor }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* BarangayCard Skeleton */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex justify-between items-start gap-2">
            <div className="w-full">
              <Skeleton className="h-3 w-24 mb-2" />
              <Skeleton className="h-5 w-3/4" />
            </div>
            <Skeleton className="h-8 w-16" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between items-center border-b pb-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <div className="flex justify-between border-b pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="flex justify-between border-b pb-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-12" />
          </div>
          <div className="space-y-1">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
          </div>
        </CardContent>
      </Card>

      {/* Facilities List Skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-40 mb-2" />
        <Card>
          <CardHeader className="pb-2 pl-5">
            <Skeleton className="h-4 w-3/4 mb-1" />
            <Skeleton className="h-3 w-1/3" />
          </CardHeader>
          <CardContent className="space-y-2 pl-5">
            <div className="flex justify-between border-b pb-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-32" />
            </div>
            <div className="flex justify-between border-b pb-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-24" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 pl-5">
            <Skeleton className="h-4 w-3/4 mb-1" />
            <Skeleton className="h-3 w-1/3" />
          </CardHeader>
          <CardContent className="space-y-2 pl-5">
            <div className="flex justify-between border-b pb-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-32" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BarangayCard({ barangay, onClear }) {
  const { factors, loading, error } = useBarangayExplanation(
    barangay,
    DEFAULT_FSI_MODEL,
  );
  if (!barangay) return null;
  const { name, risk, population, probability } = barangay;
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
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            className="border-slate-300 text-slate-700 hover:bg-slate-100"
          >
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
        {typeof probability === "number" && (
          <div className="flex justify-between border-b pb-2">
            <span className="text-muted-foreground">Probability</span>
            <span className="font-medium tabular-nums">
              {(probability * 100).toFixed(1)}%
            </span>
          </div>
        )}
        <div className="flex justify-between border-b pb-2">
          <span className="text-muted-foreground">Population</span>
          <span className="font-medium">
            {population != null ? population.toLocaleString() : "N/A"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {message}
        </p>
        {USE_SERVER && (
          <div className="border-t pt-3">
            <FactorsList factors={factors} loading={loading} error={error} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SelectedFacilityCard({ facility, onClear }) {
  if (!facility) return null;
  const isEvac =
    Boolean(facility._evac) || facility.type === EVACUATION_CENTER_TYPE;

  return (
    <Card className="relative">
      <div
        className="absolute top-0 left-0 w-1 h-full rounded-l-lg"
        style={{ backgroundColor: isEvac ? "#ef4444" : "#2563eb" }}
      />
      <CardHeader className="pb-2 pl-5">
        <div className="flex justify-between items-start">
          <CardTitle className="text-base">{facility.name}</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            className="h-6 px-2 text-xs"
          >
            Clear
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {isEvac ? "⛺ Evacuation Center" : facility.type}
        </p>
      </CardHeader>
      <CardContent className="space-y-2 text-sm pl-5">
        {isEvac ? (
          <>
            {facility._evac?.location && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Location</span>
                <span className="font-medium text-right">
                  {facility._evac.location}
                </span>
              </div>
            )}
            {facility._evac?.district && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">District</span>
                <span className="font-medium text-right">
                  {facility._evac.district}
                </span>
              </div>
            )}
            {facility._evac?.floor_area_sqm != null && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Floor area</span>
                <span className="font-medium text-right">
                  {facility._evac.floor_area_sqm} sqm
                </span>
              </div>
            )}
            {facility._evac?.proximity && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Proximity</span>
                <span className="font-medium text-right">
                  {facility._evac.proximity}
                </span>
              </div>
            )}
            {facility._evac?.remarks && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Remarks</span>
                <span className="font-medium text-right text-amber-600">
                  {facility._evac.remarks}
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

function FacilityDetailsPanel({
  selection,
  onUseMyLocation,
  selectedTypes = [],
  mapMode = "marker",
  selectedBarangay,
  onClearBarangay,
  facilitiesInBarangay = [],
  isLoadingBarangays = false,
  selectedFacility, // NEW
  onClearFacility, // NEW
}) {
  const {
    mode = "idle",
    results = [],
    errorMsg = null,
    origin = null,
    originBarangay = null,
  } = selection || {};

  // If a facility is selected via map click, override the current panel content
  if (selectedFacility) {
    return (
      <div className="space-y-4">
        <SelectedFacilityCard
          facility={selectedFacility}
          onClear={onClearFacility}
        />
      </div>
    );
  }

  // ---------- No mode selected ----------
  if (mapMode === "none") {
    return (
      <div className="space-y-4">
        <Card className="border-dashed border-slate-300 bg-slate-50">
          <CardContent className="p-4 text-center text-sm text-slate-600">
            No mode selected. Choose <strong>Marker</strong> or{" "}
            <strong>Barangay</strong> mode on the map to start.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {mapMode === "barangay" ? (
        <>
          {isLoadingBarangays && !selectedBarangay ? (
            <SidebarSkeleton />
          ) : selectedBarangay ? (
            <div className="space-y-6">
              <BarangayCard
                barangay={selectedBarangay}
                onClear={onClearBarangay}
              />

              {/* List of facilities inside the barangay */}
              <div className="space-y-3">
                <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                  Facilities in {selectedBarangay.name}
                </h4>
                {facilitiesInBarangay.length === 0 ? (
                  <Card className="border-dashed border-slate-300 bg-slate-50">
                    <CardContent className="p-4 text-center text-sm text-slate-600">
                      No matching health facilities or evacuation centers found
                      in this barangay.
                    </CardContent>
                  </Card>
                ) : (
                  facilitiesInBarangay.map((facility, index) => {
                    const isEvac =
                      Boolean(facility._evac) ||
                      facility.type === EVACUATION_CENTER_TYPE;
                    return (
                      <Card
                        key={`${facility.name}-${index}`}
                        className="relative"
                      >
                        <div
                          className="absolute top-0 left-0 w-1 h-full rounded-l-lg"
                          style={{
                            backgroundColor: isEvac ? "#ef4444" : "#2563eb",
                          }}
                        />
                        <CardHeader className="pb-2 pl-5">
                          <CardTitle className="text-sm leading-tight">
                            {facility.name}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground">
                            {isEvac ? "⛺ Evacuation Center" : facility.type}
                          </p>
                        </CardHeader>
                        <CardContent className="space-y-1 text-xs pl-5">
                          {isEvac ? (
                            <>
                              {facility._evac?.location && (
                                <div className="flex justify-between border-b pb-1">
                                  <span className="text-muted-foreground">
                                    Location
                                  </span>
                                  <span className="font-medium text-right">
                                    {facility._evac.location}
                                  </span>
                                </div>
                              )}
                              {facility._evac?.district && (
                                <div className="flex justify-between border-b pb-1">
                                  <span className="text-muted-foreground">
                                    District
                                  </span>
                                  <span className="font-medium text-right">
                                    {facility._evac.district}
                                  </span>
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              {facility.addr_street && (
                                <div className="flex justify-between border-b pb-1">
                                  <span className="text-muted-foreground">
                                    Address
                                  </span>
                                  <span className="font-medium text-right">
                                    {facility.addr_street}
                                  </span>
                                </div>
                              )}
                              {facility.phone && (
                                <div className="flex justify-between border-b pb-1">
                                  <span className="text-muted-foreground">
                                    Phone
                                  </span>
                                  <span className="font-medium">
                                    {facility.phone}
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <Card className="border-dashed border-slate-300 bg-slate-50">
              <CardContent className="p-4 text-center text-sm text-slate-600">
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
            className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all"
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
            <Card className="border-dashed border-slate-300 bg-slate-50">
              <CardContent className="p-4 text-center text-sm text-slate-600">
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
    <div className="space-y-4 animate-pulse">
      <Card>
        <CardContent className="p-4 flex gap-3 items-center">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-40" />
          </div>
        </CardContent>
      </Card>
      {[1, 2, 3].map((i) => (
        <Card key={i} className="relative">
          <div className="absolute top-0 left-0 w-1 h-full rounded-l-lg bg-slate-200" />
          <CardHeader className="pb-2 pl-5">
            <div className="flex justify-between items-start">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            <Skeleton className="h-4 w-1/3 mt-1" />
          </CardHeader>
          <CardContent className="space-y-2 pl-5">
            <div className="flex justify-between border-b pb-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex justify-between border-b pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="flex justify-between border-b pb-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-32" />
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

function FsiLoadingIndicator({ status, visible = true, compact = false }) {
  if (!status || !visible) return null;
  const label =
    status === "predicting"
      ? "Computing flood susceptibility…"
      : "Loading barangay data…";

  const risk = ["#91bfdb", "#fee090", "#fc8d59", "#d73027"];

  return createPortal(
    <>
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9997,
          backgroundColor: "rgba(15, 23, 42, 0.35)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
          cursor: "progress",
          pointerEvents: "auto",
          touchAction: "none",
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      />

      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 9998,
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
          width: compact ? "220px" : "260px", // Fixed width
          boxSizing: "border-box", // Prevents padding from expanding the width
          padding: compact ? "16px 20px" : "20px 28px",
          backgroundColor: "rgba(255,255,255,0.97)",
          borderRadius: "14px",
          border: "1px solid rgba(0,0,0,0.06)",
          boxShadow: "0 2px 6px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.18)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <style>{`
          @keyframes fsi-rise {
            0%, 100% { transform: translateY(0); opacity: .35; }
            50%      { transform: translateY(-8px); opacity: 1; }
          }
          @media (prefers-reduced-motion: reduce) {
            .fsi-bar { animation: none !important; opacity: 1 !important; }
          }
        `}</style>

        {/* Four bars rising in sequence, one per risk level */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: "6px",
            height: "28px",
          }}
        >
          {risk.map((color, i) => (
            <span
              key={color}
              className="fsi-bar"
              style={{
                width: "10px",
                height: `${12 + i * 4}px`,
                borderRadius: "3px",
                backgroundColor: color,
                animation: `fsi-rise 1.2s ease-in-out ${i * 0.15}s infinite`,
              }}
            />
          ))}
        </div>

        <span
          style={{
            fontSize: compact ? "11px" : "12px",
            fontWeight: 600,
            color: "#1a1a1a",
            textAlign: "center",
          }}
        >
          {label}
        </span>
      </div>
    </>,
    document.body,
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
  const [qgisLayerStats, setQgisLayerStats] = useState({});
  const [fsiVisible, setFsiVisible] = useState(true);
  const [baseLayer, setBaseLayer] = useState("satellite");
  const [fsiStatus, setFsiStatus] = useState("boundaries");
  const navigate = useNavigate();

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
  const [facilitiesVisible, setFacilitiesVisible] = useState(true);
  const [mapMode, setMapMode] = useState("none");
  const [selectedBarangay, setSelectedBarangay] = useState(null);
  const [selectedFacility, setSelectedFacility] = useState(null);

  // Overlay states
  const [openOverlay, setOpenOverlay] = useState(null); // "facility" | null
  const [legendOpen, setLegendOpen] = useState(false);
  const [qgisOpen, setQgisOpen] = useState(false);

  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mapAreaRef = useRef(null);
  const [mapWidth, setMapWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1200,
  );
  const compact = mapWidth < 900;

  const [qgisLayerProgress, setQgisLayerProgress] = useState({});

  const handleQGISProgress = useCallback((key, pct) => {
    setQgisLayerProgress((p) => ({ ...p, [key]: pct }));
  }, []);

  const handleQGISLoadingChange = useCallback((key, loading) => {
    setQgisLayerLoading((p) => ({ ...p, [key]: loading }));
    if (!loading) {
      setQgisLayerProgress((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
    }
  }, []);

  useEffect(() => {
    const el = mapAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setMapWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleToggleSidebar = useCallback(() => {
    if (isDesktop) setSidebarOpen((v) => !v);
    else setDrawerOpen((v) => !v);
  }, [isDesktop]);

  useEffect(() => {
    if (
      !isDesktop &&
      (selection.mode === "done" || selectedBarangay || selectedFacility)
    )
      setDrawerOpen(true);
  }, [isDesktop, selection.mode, selectedBarangay, selectedFacility]);

  const searchSelectRef = useRef(null);
  const clearLocationRef = useRef(null);
  const centerLocationRef = useRef(null);
  const locationHandlerRef = useRef(null);
  const resetHandlerRef = useRef(null);
  const qgisRasterDataRef = useRef({});

  const hasQGISLayersActive = activeQGISLayers.length > 0;
  const activeLayerKey = activeQGISLayers[0] || null;

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

  const handleBoundaryLoaded = useCallback((f) => setCityBoundary(f), []);
  const handleBarangaysLoaded = useCallback((d) => setBarangayData(d), []);
  const handleSelectionChange = useCallback((d) => setSelection(d), []);
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
    (nearest) => {
      const ids = new Set(nearest.map((f) => `${f.lat},${f.lon}`));
      setHiddenFacilities(
        facilities.filter((f) => !ids.has(`${f.lat},${f.lon}`)),
      );
    },
    [facilities],
  );

  const handleClearHighlight = useCallback(() => setHiddenFacilities([]), []);
  const handleLocationChange = useCallback((loc) => setHasLocation(!!loc), []);

  const handleLocate = useCallback(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          searchSelectRef.current?.({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
        },
        (err) => console.warn("Geolocation error:", err.message),
        { timeout: 10000, maximumAge: 60000 },
      );
    }
  }, []);

  const handleClear = useCallback(() => {
    clearLocationRef.current?.();
    setSelectedFacility(null);
    setSelectedBarangay(null);
  }, []);

  const handleCenter = useCallback(() => centerLocationRef.current?.(), []);

  const handleLayerToggle = useCallback((key) => {
    setActiveQGISLayers((prev) => (prev.includes(key) ? [] : [key]));
  }, []);

  const handleQGISLoadError = useCallback((key, msg) => {
    setQgisLayerErrors((p) => {
      const n = { ...p };
      if (msg) n[key] = msg;
      else delete n[key];
      return n;
    });
  }, []);
  const handleRasterLoaded = useCallback((key, data) => {
    if (data) {
      qgisRasterDataRef.current[key] = data;
      setQgisLayerStats((p) => ({
        ...p,
        [key]: { minVal: data.minVal, maxVal: data.maxVal },
      }));
    } else {
      delete qgisRasterDataRef.current[key];
      setQgisLayerStats((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
    }
  }, []);

  const handleRequestClear = useCallback((fn) => {
    clearLocationRef.current = fn;
  }, []);
  const handleRequestCenter = useCallback((fn) => {
    centerLocationRef.current = fn;
  }, []);

  const handleUseMyLocationClick = () => locationHandlerRef.current?.();

  const handleAlertClose = () => {
    resetHandlerRef.current?.();
    setSelection((p) => ({
      ...p,
      outsideBoundary: false,
      mode: "idle",
      errorType: null,
    }));
  };

  const handleModeChange = useCallback((newMode) => {
    setMapMode(newMode);
    if (newMode !== "barangay") setSelectedBarangay(null);
    setSelectedFacility(null);
  }, []);

  const handleBarangaySelect = useCallback((b) => {
    setSelectedBarangay(b);
    setSelectedFacility(null);
  }, []);
  const handleClearBarangay = useCallback(() => setSelectedBarangay(null), []);

  const handleSearchSelect = useCallback(
    (latlng) => {
      if (barangayData) {
        const b = findBarangayForPoint(latlng, barangayData);
        if (b) {
          handleBarangaySelect(b);
          setMapMode("barangay");
          return;
        }
      }
      searchSelectRef.current?.(latlng);
    },
    [barangayData, handleBarangaySelect],
  );

  const handleSelectAllTypes = useCallback(() => setSelectedTypes([]), []);
  const handleToggleType = useCallback((type) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);
  const handleToggleFacilitiesVisibility = useCallback(() => {
    setFacilitiesVisible((v) => !v);
  }, []);
  const handleToggleFsi = useCallback(() => setFsiVisible((v) => !v), []);

  const effectiveHiddenFacilities = useMemo(() => {
    const hidden = new Set();
    if (selectedTypes.length > 0) {
      const healthTypes = selectedTypes.filter(
        (t) => t !== EVACUATION_CENTER_TYPE,
      );
      facilities.forEach((f) => {
        if (healthTypes.length === 0 || !healthTypes.includes(f.type))
          hidden.add(`${f.lat},${f.lon}`);
      });
    }
    hiddenFacilities.forEach((f) => hidden.add(`${f.lat},${f.lon}`));
    return facilities.filter((f) => hidden.has(`${f.lat},${f.lon}`));
  }, [facilities, selectedTypes, hiddenFacilities]);

  const showEvacCenters =
    facilitiesVisible &&
    (selectedTypes.length === 0 ||
      selectedTypes.includes(EVACUATION_CENTER_TYPE));

  const facilitiesInSelectedBarangay = useMemo(() => {
    if (mapMode !== "barangay" || !selectedBarangay || !barangayData) return [];

    const feature = barangayData.features.find(
      (f) => f.properties.adm4_name === selectedBarangay.name,
    );
    if (!feature) return [];

    const active = selectedTypes || [];
    const healthTypes = active.filter((t) => t !== EVACUATION_CENTER_TYPE);
    const evacSelected = active.includes(EVACUATION_CENTER_TYPE);

    let visibleHealth = [];
    if (active.length === 0 || healthTypes.length > 0) {
      visibleHealth = facilities.filter((f) => {
        if (active.length > 0 && !healthTypes.includes(f.type)) return false;
        if (
          effectiveHiddenFacilities.some(
            (h) => h.lat === f.lat && h.lon === f.lon,
          )
        )
          return false;
        return booleanPointInPolygon([f.lon, f.lat], feature);
      });
    }

    let visibleEvac = [];
    if (facilitiesVisible && (active.length === 0 || evacSelected)) {
      visibleEvac = evacuationCenters
        .map(evacCenterToFacility)
        .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon))
        .filter((f) => booleanPointInPolygon([f.lon, f.lat], feature));
    }

    return [...visibleHealth, ...visibleEvac];
  }, [
    mapMode,
    selectedBarangay,
    barangayData,
    facilities,
    evacuationCenters,
    selectedTypes,
    facilitiesVisible,
    effectiveHiddenFacilities,
  ]);

  const isLoadingBarangays =
    mapMode === "barangay" && (!barangayData || fsiStatus !== null);

  const sidebarContent = (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-200">
        <p className="text-sm font-extrabold text-slate-900 leading-snug">
          <span className="block mb-1 text-xl text-blue-600 uppercase tracking-tight">
            ABENIDA
          </span>
          Mapping High-Resolution Flood Susceptibility in Zamboanga City Using
          Spatial Machine Learning
        </p>
      </div>

      <FacilityDetailsPanel
        selection={selection}
        onUseMyLocation={handleUseMyLocationClick}
        selectedTypes={selectedTypes}
        mapMode={mapMode}
        selectedBarangay={selectedBarangay}
        onClearBarangay={handleClearBarangay}
        facilitiesInBarangay={facilitiesInSelectedBarangay}
        isLoadingBarangays={isLoadingBarangays}
        selectedFacility={selectedFacility}
        onClearFacility={() => setSelectedFacility(null)}
      />
    </div>
  );

  const sidebarOpenNow = isDesktop ? sidebarOpen : drawerOpen;
  const showPeek = !isDesktop && !drawerOpen;

  return (
    <div className="flex w-full h-screen supports-[height:100dvh]:h-dvh overflow-hidden">
      <div
        ref={mapAreaRef}
        className={cn(
          "relative isolate flex-1 min-w-0 h-full",
          compact && "map-compact",
          showPeek && "has-peek",
        )}
      >
        <style>{`
          .barangay-label { background: rgba(0,0,0,0.75); border: none; border-radius: 4px; color: #ffffff; font-size: 11px; font-weight: 500; padding: 3px 7px; white-space: nowrap; }
          .barangay-label::before { display: none; }
          .custom-poi-icon { background: none; border: none; }
          .search-item:last-child { border-bottom: none; }
          .search-item:hover { background: #f2f2f2; }
          .leaflet-tooltip { pointer-events: none !important; }
          .custom-cluster-icon { background: transparent !important; border: none !important; }
          .custom-cluster-icon div { background: transparent !important; border: none !important; }
          .marker-cluster { background: transparent !important; border: none !important; box-shadow: none !important; }
          .marker-cluster div { background: transparent !important; border: none !important; box-shadow: none !important; }
          .leaflet-interactive { pointer-events: auto !important; }
          .info.legend { margin-bottom: 0; }

          .leaflet-bottom.leaflet-right { display: flex !important; flex-direction: column !important; align-items: flex-end !important; gap: 8px !important; margin-right: 12px !important; margin-bottom: 12px !important; }
          .leaflet-bottom.leaflet-right .leaflet-control { margin: 0 !important; float: none !important; }

          .has-peek .leaflet-bottom.leaflet-right { margin-bottom: ${PEEK_HEIGHT + 12}px !important; }

          .leaflet-container,
          .leaflet-container .info.legend,
          .leaflet-container .info.legend *,
          .leaflet-tooltip,
          .leaflet-popup-content,
          .leaflet-popup-content *,
          .barangay-label,
          .map-controls button,
          .zoom-controls button {
            font-family: var(--font-body) !important;
          }

          .info.legend strong:first-child,
          .qgis-legend-control > div > div:first-child {
            font-family: var(--font-display) !important;
          }

          .relative.isolate [style*="Arial"] {
            font-family: var(--font-body) !important;
          }

          [data-slot="card-title"],
          [data-slot="sheet-title"] {
            font-family: var(--font-display);
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
            key={baseLayer}
            attribution={BASE_LAYERS[baseLayer].attribution}
            url={BASE_LAYERS[baseLayer].url}
          />
          <CustomPanes />
          <MapResizer />
          <ZamboangaMask
            onBoundaryLoaded={handleBoundaryLoaded}
            onBarangaysLoaded={handleBarangaysLoaded}
            rasterActive={hasQGISLayersActive}
            fsiVisible={fsiVisible}
            mapMode={mapMode}
            selectedBarangayName={selectedBarangay?.name || null}
            fsiModel={DEFAULT_FSI_MODEL}
            onFsiStatusChange={setFsiStatus}
          />
          <POILayer
            onFacilities={setFacilities}
            hiddenFacilities={effectiveHiddenFacilities}
            visible={facilitiesVisible}
            onFacilityClick={setSelectedFacility}
          />
          <EvacuationCentersLayer
            onCentersLoaded={setEvacuationCenters}
            visible={showEvacCenters}
            onFacilityClick={setSelectedFacility}
          />
          <QGISLayers
            activeLayers={activeQGISLayers}
            cityBoundary={cityBoundary}
            onLoadingChange={handleQGISLoadingChange}
            onLoadError={handleQGISLoadError}
            onRasterLoaded={handleRasterLoaded}
            onProgress={handleQGISProgress}
          />
          <QGISHoverTooltip rasterDataRef={qgisRasterDataRef} />
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
            onMapClick={() => {
              setSelectedFacility(null);
              setOpenOverlay(null);
            }}
          />
          <MapControls
            onLocate={handleLocate}
            onClear={handleClear}
            onCenterLocation={handleCenter}
            hasLocation={hasLocation}
            compact={compact}
          />
          <LegendControl
            fsiVisible={fsiVisible}
            onToggleFsi={handleToggleFsi}
            compact={compact}
            legendOpen={legendOpen}
            setLegendOpen={setLegendOpen}
          />
          <QGISLegend
            layerKey={activeLayerKey}
            config={activeLayerKey ? QGIS_LAYER_CONFIGS[activeLayerKey] : null}
            stats={activeLayerKey ? qgisLayerStats[activeLayerKey] : null}
            compact={compact}
            qgisOpen={qgisOpen}
            setQgisOpen={setQgisOpen}
          />
        </MapContainer>

        {isDesktop && (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={handleToggleSidebar}
            aria-label={sidebarOpenNow ? "Close sidebar" : "Open sidebar"}
            aria-expanded={sidebarOpenNow}
            aria-controls="flood-map-sidebar"
            title={sidebarOpenNow ? "Close sidebar" : "Open sidebar"}
            className="absolute top-2 right-4 z-[2000] h-10 w-10 shadow-md bg-white/85 backdrop-blur hover:bg-white"
          >
            {sidebarOpen ? (
              <PanelRightClose className="h-5 w-5" />
            ) : (
              <PanelRightOpen className="h-5 w-5" />
            )}
          </Button>
        )}

        {showPeek && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open details drawer"
            aria-expanded={false}
            aria-controls="flood-map-sidebar"
            style={{ height: PEEK_HEIGHT }}
            className="absolute bottom-0 left-0 right-0 z-[2000] flex flex-col items-center justify-start gap-1 rounded-t-2xl border-t bg-background/95 px-4 pt-2 shadow-[0_-2px_10px_rgba(0,0,0,0.15)] backdrop-blur"
          >
            <span className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
              {mapMode === "barangay"
                ? "Barangay Details"
                : "Nearby Facilities"}
            </span>
          </button>
        )}
        <MapModeControl
          mode={mapMode}
          onModeChange={handleModeChange}
          compact={compact}
        />
        <FacilityTypeControl
          facilityTypes={facilityTypes}
          selectedTypes={selectedTypes}
          onSelectAllTypes={handleSelectAllTypes}
          onToggleType={handleToggleType}
          facilitiesVisible={facilitiesVisible}
          onToggleFacilitiesVisibility={handleToggleFacilitiesVisibility}
          compact={compact}
          openOverlay={openOverlay}
          setOpenOverlay={setOpenOverlay}
        />
        <MapSearchControl
          cityBoundary={cityBoundary}
          onSelectLocation={handleSearchSelect}
          compact={compact}
          onHome={() => navigate("/")}
          openOverlay={openOverlay}
        />
        <FsiLoadingIndicator
          status={fsiStatus}
          visible={fsiVisible}
          compact={compact}
        />

        {/* 
          ADDED onClickCapture: 
          This ensures that if the user clicks the Layers button, 
          it will close the FacilityTypeControl automatically.
        */}
        <div onClickCapture={() => setOpenOverlay(null)}>
          <BaseLayerSwitcher
            baseLayer={baseLayer}
            onBaseLayerChange={setBaseLayer}
            layerConfigs={QGIS_LAYER_CONFIGS}
            activeLayers={activeQGISLayers}
            onLayerToggle={handleLayerToggle}
            layerErrors={qgisLayerErrors}
            layerLoading={qgisLayerLoading}
            layerProgress={qgisLayerProgress}
            compact={compact}
            bottomOffset={showPeek ? PEEK_HEIGHT : 0}
          />
        </div>
      </div>

      {isDesktop && (
        <aside
          id="flood-map-sidebar"
          aria-hidden={!sidebarOpen}
          className={cn(
            "h-full shrink-0 overflow-hidden bg-background",
            sidebarOpen ? "w-[360px] xl:w-[420px] border-l" : "w-0",
          )}
          style={{
            visibility: sidebarOpen ? "visible" : "hidden",
            transition: `width 300ms ease-in-out, visibility 0s linear ${sidebarOpen ? "0ms" : "300ms"}`,
          }}
        >
          <div className="h-full w-[360px] xl:w-[420px] overflow-y-auto p-6">
            {sidebarContent}
          </div>
        </aside>
      )}

      {!isDesktop && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent
            id="flood-map-sidebar"
            side="bottom"
            className="flex flex-col gap-0 p-0 max-h-[85dvh] sm:max-h-[80dvh] rounded-t-2xl"
          >
            <div className="pt-2 pb-1 flex justify-center">
              <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
            </div>
            <SheetHeader className="border-b px-4 pb-3 pt-1 text-left">
              <SheetTitle>
                {mapMode === "barangay"
                  ? "Barangay Details"
                  : "Nearby Facilities"}
              </SheetTitle>
              <SheetDescription>
                {mapMode === "barangay"
                  ? "Flood susceptibility and population."
                  : "Find the nearest health facilities and evacuation centers."}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-4">{sidebarContent}</div>
          </SheetContent>
        </Sheet>
      )}

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
