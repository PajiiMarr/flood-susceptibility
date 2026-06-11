// FloodMap.jsx
import { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

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

// Legend component
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

// POILayer.js

// ... (previous imports, other components)

function POILayer() {
  const map = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [poiCount, setPoiCount] = useState(null);
  const markerLayerRef = useRef(null);

  const fetchWithRetry = async (url, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url);
        if (response.status === 429) {
          await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
          continue;
        }
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        // Check if the API returned an error message
        if (data.remark && data.remark.includes('runtime error')) {
          throw new Error(`Overpass API error: ${data.remark}`);
        }
        return data;
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
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
        // Cache key based on the new relation ID
        const cacheKey = 'poi_zamboanga_health_3617877';
        const cached = sessionStorage.getItem(cacheKey);
        
        if (cached) {
          const data = JSON.parse(cached);
          if (isMounted) {
            addMarkersToMap(data);
            setLoading(false);
          }
          return;
        }

        // --- STEP 1: Search for known tags (Pharmacies & Hospitals) ---
        const overpassQuery = `
          [out:json][timeout:60];
          // Define the area using the correct Zamboanga City relation ID (3617877)
          // For Overpass, a relation ID is converted to an area ID by adding 3600000000
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
        
        // --- STEP 2: If the first query found nothing, search for clinics and doctors as a fallback ---
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
      
      // Default fallback marker
      const defaultIcon = L.divIcon({
        html: `<div style="font-size:24px; text-shadow: 0 0 2px white;">📍</div>`,
        iconSize: [24, 24],
        className: 'custom-poi-marker'
      });
      
      elements.forEach(el => {
        let lat, lon;
        if (el.type === 'node' && el.lat && el.lon) {
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
        
        // Determine icon based on tags
        if (tags.amenity === 'pharmacy' || tags.healthcare === 'pharmacy') {
          icon = L.divIcon({
            html: `<div style="font-size:24px; text-shadow: 0 0 2px white;">💊</div>`,
            iconSize: [24, 24],
            className: 'custom-poi-marker'
          });
          name = tags.name || 'Pharmacy';
          type = 'Pharmacy';
        } 
        else if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') {
          icon = L.divIcon({
            html: `<div style="font-size:24px; text-shadow: 0 0 2px white;">🏥</div>`,
            iconSize: [24, 24],
            className: 'custom-poi-marker'
          });
          name = tags.name || 'Hospital';
          type = 'Hospital';
        }
        else if (tags.amenity === 'clinic' || tags.healthcare === 'clinic') {
          icon = L.divIcon({
            html: `<div style="font-size:24px; text-shadow: 0 0 2px white;">🏥</div>`,
            iconSize: [24, 24],
            className: 'custom-poi-marker'
          });
          name = tags.name || 'Clinic';
          type = 'Clinic';
        }
        else if (tags.amenity === 'doctors' || tags.healthcare === 'doctor') {
          icon = L.divIcon({
            html: `<div style="font-size:24px; text-shadow: 0 0 2px white;">👨‍⚕️</div>`,
            iconSize: [24, 24],
            className: 'custom-poi-marker'
          });
          name = tags.name || `Doctor's Office`;
          type = 'Medical Office';
        }
        else {
          icon = defaultIcon;
          name = tags.name || 'Health Facility';
          type = tags.amenity || tags.healthcare || 'Facility';
        }
        
        markerCount++;
        const popupContent = `
          <div style="min-width: 150px;">
            <strong>${name}</strong><br>
            Type: ${type}<br>
            ${tags['addr:street'] ? `Address: ${tags['addr:street']}<br>` : ''}
            ${tags['addr:city'] ? `City: ${tags['addr:city']}<br>` : ''}
            ${tags.phone ? `Phone: ${tags.phone}<br>` : ''}
            ${tags.website ? `Website: <a href="${tags.website}" target="_blank">link</a>` : ''}
          </div>
        `;
        L.marker([lat, lon], { icon }).bindPopup(popupContent).addTo(markerGroup);
      });
      
      console.log(`✅ Added ${markerCount} health facility markers`);
      setPoiCount(markerCount);
      markerGroup.addTo(map);
      markerLayerRef.current = markerGroup;
    };

    fetchPois();

    // Add status control
    if (map) {
      statusControl = L.control({ position: 'bottomleft' });
      statusControl.onAdd = () => {
        const div = L.DomUtil.create('div', 'poi-status');
        div.style.cssText = 'background:rgba(0,0,0,0.7);color:white;padding:5px 10px;border-radius:4px;font-size:12px;z-index:1000';
        if (loading) div.innerText = '⏳ Loading health facilities across Zamboanga City...';
        else if (error) div.innerText = `⚠️ ${error}`;
        else if (poiCount === 0) div.innerText = '⚠️ No health facilities found. Try zooming in or check OSM data.';
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

// ZamboangaMask component (unchanged)
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

// Main FloodMap component
function FloodMap() {
  const position = [7.0736, 122.01];

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
          url="https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}{r}.png"
        />
        <ZamboangaMask />
        <POILayer />
        <LegendControl />
      </MapContainer>
    </>
  );
}

export default FloodMap;
