import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

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

const OSRM_BASE = "https://router.project-osrm.org";

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
        return {
          lat: row.lat,
          lon: row.lon,
          name: row.name,
          type: row.type,
          addr_street: row.addr_street,
          addr_city: row.addr_city,
          phone: row.phone,
          website: row.website,
        };
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
          .select(
            "name, type, lat, lon, addr_street, addr_city, phone, website",
          );
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

    return () => {
      isMounted = false;
      if (markerLayerRef.current && map)
        map.removeLayer(markerLayerRef.current);
      if (statusControl && map) map.removeControl(statusControl);
    };
  }, [map, poiCount]);

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
  };
}

function RoutingLayer({
  facilities,
  onSelectionChange,
  onRequestLocation,
  onRequestReset,
  filterType,
  cityBoundary,
  barangayData,
}) {
  const map = useMap();
  const [mode, setMode] = useState("idle");
  const [origin, setOrigin] = useState(null);
  const [results, setResults] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [outsideBoundary, setOutsideBoundary] = useState(false);
  const layerRef = useRef(null);

  // Derived value — the barangay (and its FSI risk) containing the current
  // origin point. Recomputed from origin + barangayData, no separate state.
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

  const isPointInsideBoundary = useCallback(
    (latlng) => {
      if (!cityBoundary) return true; // boundary not loaded yet – allow
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
      } catch (err) {
        setErrorMsg(err.message);
        setMode("error");
      }
    },
    [facilities, filterType],
  );

  useMapEvents({
    click(e) {
      if (mode !== "loading") {
        if (!isPointInsideBoundary(e.latlng)) {
          setOutsideBoundary(true);
          setOrigin(e.latlng);
          setErrorMsg("Location is outside Zamboanga City boundary.");
          return;
        }
        setOutsideBoundary(false);
        setOrigin(e.latlng);
        runSearch(e.latlng);
      }
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
        const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!isPointInsideBoundary(latlng)) {
          setOutsideBoundary(true);
          setOrigin(latlng);
          setErrorMsg(
            "Your location is outside Zamboanga City. Only locations within the city are supported.",
          );
          return;
        }
        setOutsideBoundary(false);
        setOrigin(latlng);
        runSearch(latlng);
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
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  }, [runSearch, isPointInsideBoundary]);

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
    if (origin && mode !== "loading") {
      runSearch(origin);
    }
  }, [filterType]); // eslint-disable-line react-hooks/exhaustive-deps

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
    results.forEach((item, index) => {
      const color = ROUTE_COLORS[index] || "#9e9e9e";
      L.marker([item.facility.lat, item.facility.lon], {
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
    ]).then(([cityData, barangayData]) => {
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
      const featuresWithRisk = barangayData.features.map((feature) => ({
        ...feature,
        properties: { ...feature.properties, fsi_risk: getRandomRiskLevel() },
      }));
      const updatedBarangayData = {
        ...barangayData,
        features: featuresWithRisk,
      };

      // Report the risk-tagged barangay collection upward so RoutingLayer
      // can do its own point-in-polygon lookups against the same dataset
      // used for rendering the map fill colors.
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
  }, [map, onBoundaryLoaded, onBarangaysLoaded]);
  return null;
}

function FloodMap({
  onSelectionChange,
  onRequestLocation,
  onRequestReset,
  filterType,
}) {
  const position = [7.0736, 122.01];
  const [facilities, setFacilities] = useState([]);
  const [cityBoundary, setCityBoundary] = useState(null);
  const [barangayData, setBarangayData] = useState(null);

  const handleBoundaryLoaded = useCallback((feature) => {
    setCityBoundary(feature);
  }, []);

  const handleBarangaysLoaded = useCallback((data) => {
    setBarangayData(data);
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
        <POILayer onFacilities={setFacilities} />
        <RoutingLayer
          facilities={facilities}
          onSelectionChange={onSelectionChange}
          onRequestLocation={onRequestLocation}
          onRequestReset={onRequestReset}
          filterType={filterType}
          cityBoundary={cityBoundary}
          barangayData={barangayData}
        />
        <LegendControl />
      </MapContainer>
    </>
  );
}

export default FloodMap;