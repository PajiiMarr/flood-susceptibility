import { useEffect } from "react";
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

// Demo FSI risk levels (colors remain the same, but opacity will be low)
const RISK_LEVELS = {
  "Very High Risk": "#d73027", // red
  "High Risk": "#fc8d59", // orange
  "Medium Risk": "#fee090", // yellow
  "Low Risk": "#91bfdb", // light blue
};

// Helper to assign a random risk level for demo purposes
function getRandomRiskLevel() {
  const levels = Object.keys(RISK_LEVELS);
  return levels[Math.floor(Math.random() * levels.length)];
}

// Legend component
function LegendControl() {
  const map = useMap();

  useEffect(() => {
    const legend = L.control({ position: "topright" }); // ← changed from "bottomright"

    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "info legend");
      div.style.backgroundColor = "rgba(255,255,255,0.9)";
      div.style.padding = "10px";
      div.style.borderRadius = "5px";
      div.style.boxShadow = "0 1px 5px rgba(0,0,0,0.2)";
      div.style.fontFamily = "Arial, sans-serif";
      div.style.fontSize = "12px";
      div.style.lineHeight = "1.4";
      div.innerHTML = "<strong>Flood Susceptibility Index (Demo)</strong><br>";

      for (const [level, color] of Object.entries(RISK_LEVELS)) {
        div.innerHTML += `
          <div style="display: flex; align-items: center; margin-top: 4px;">
            <div style="background: ${color}; width: 18px; height: 18px; border-radius: 2px; margin-right: 8px; opacity: 0.6;"></div>
            <span>${level}</span>
          </div>
        `;
      }
      div.innerHTML +=
        "<br><i style='font-size:10px;'>Demo classification only</i>";
      return div;
    };

    legend.addTo(map);
    return () => legend.remove();
  }, [map]);

  return null;
}

function ZamboangaMask() {
  const map = useMap();

  useEffect(() => {
    let maskLayer, borderLayer, barangayLayer;

    Promise.all([
      fetch("/zamboanga_city_boundary.geojson").then((r) => r.json()),
      fetch("/zamboanga_city_barangays.geojson").then((r) => r.json()),
    ]).then(([cityData, barangayData]) => {
      // --- City mask (light gray overlay) ---
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
          fillOpacity: 0.15, // even lighter mask
        },
        interactive: false,
      }).addTo(map);

      // --- City border ---
      borderLayer = L.geoJSON(cityData, {
        style: {
          color: "#e8401c",
          weight: 2.5,
          opacity: 1,
          fill: false,
        },
        interactive: false,
      }).addTo(map);

      // --- Barangay boundaries with light opacity FSI fills ---
      const featuresWithRisk = barangayData.features.map((feature) => {
        const riskLevel = getRandomRiskLevel();
        return {
          ...feature,
          properties: {
            ...feature.properties,
            fsi_risk: riskLevel,
          },
        };
      });

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
            fillOpacity: 0.35, // LIGHT opacity – satellite map clearly visible
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
            this.setStyle({
              fillOpacity: 0.6, // slightly brighter on hover
              weight: 2,
            });
          });
          layer.on("mouseout", function () {
            this.setStyle({
              fillOpacity: 0.35,
              weight: 1,
            });
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
        <LegendControl />
      </MapContainer>
    </>
  );
}

export default FloodMap;
