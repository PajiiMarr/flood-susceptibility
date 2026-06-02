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

function ZamboangaMask() {
  const map = useMap();

  useEffect(() => {
    let maskLayer, borderLayer, barangayLayer;

    // Load the correct files
    Promise.all([
      fetch("/zamboanga_city_boundary.geojson").then((r) => r.json()),
      fetch("/zamboanga_city_barangays.geojson").then((r) => r.json()),
    ]).then(([cityData, barangayData]) => {
      // --- City mask (gray overlay with hole) ---
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
          fillColor: "#d9d9d9", // ← light gray
          fillOpacity: 0.2,
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

      // --- Barangay boundaries ---
      barangayLayer = L.geoJSON(barangayData, {
        style: {
          color: "#ffffff",
          weight: 1,
          opacity: 0.7,
          fillColor: "#ffffff",
          fillOpacity: 0.08,
        },
        interactive: true,
        onEachFeature: (feature, layer) => {
          // Use the correct property name: adm4_name
          const name = feature.properties.adm4_name;
          layer.bindTooltip(name, {
            permanent: false,
            direction: "center",
            className: "barangay-label",
          });
          layer.on("mouseover", function () {
            this.setStyle({
              fillOpacity: 0.25,
              weight: 2,
            });
          });
          layer.on("mouseout", function () {
            this.setStyle({
              fillOpacity: 0.08,
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
          background: rgba(0,0,0,0.65);
          border: none;
          border-radius: 4px;
          color: #ffffff;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 7px;
          box-shadow: none;
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
      </MapContainer>
    </>
  );
}

export default FloodMap;
