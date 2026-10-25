import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Check, AlertTriangle, X } from "lucide-react";

// ==========================================
// BASE LAYER DEFINITIONS
// ==========================================
export const BASE_LAYERS = {
  map: {
    key: "map",
    label: "Map",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    thumbnail:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/11/984/1718",
    fallback: "#e8eaed",
  },
  satellite: {
    key: "satellite",
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    thumbnail:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/11/984/1718",
    fallback: "#2f4a3a",
  },
};

const BASE_LAYER_ORDER = ["map", "satellite"];
const ACCENT = "#1a73e8";

// Short display names for the small tiles (full name stays in the tooltip).
const SHORT_NAMES = {
  dem: "Elevation",
  slope: "Slope",
  aspect: "Aspect",
  twi: "Wetness (TWI)",
  hand: "HAND",
  flow_accumulation: "Flow Accum.",
  chirps: "Rainfall",
  distance_to_river: "River Distance",
};

// CSS gradients that mirror getColorRamp() in FloodMap, so each tile previews
// the exact colours the raster will be drawn with.
const RAMP_GRADIENTS = {
  terrain:
    "linear-gradient(135deg, rgb(34,139,34), rgb(107,142,35), rgb(139,119,101), rgb(160,140,120), rgb(120,100,80))",
  slope:
    "linear-gradient(135deg, rgb(200,220,100), rgb(255,200,50), rgb(255,150,50), rgb(200,80,50), rgb(150,30,30))",
  blues:
    "linear-gradient(135deg, rgb(240,248,255), rgb(150,200,240), rgb(70,150,220), rgb(30,100,180), rgb(10,50,140))",
  reds: "linear-gradient(135deg, rgb(255,240,240), rgb(255,200,200), rgb(255,150,150), rgb(220,80,80), rgb(180,30,30))",
  greens:
    "linear-gradient(135deg, rgb(240,255,240), rgb(180,220,180), rgb(100,180,100), rgb(50,140,50), rgb(20,100,20))",
  purples:
    "linear-gradient(135deg, rgb(245,240,255), rgb(200,180,240), rgb(150,120,220), rgb(100,60,180), rgb(60,20,140))",
  hsv: "linear-gradient(135deg, hsl(0,100%,50%), hsl(72,100%,50%), hsl(144,100%,50%), hsl(216,100%,50%), hsl(288,100%,50%))",
  rainbow:
    "linear-gradient(135deg, hsl(0,100%,50%), hsl(90,100%,50%), hsl(180,100%,50%), hsl(270,100%,50%), hsl(340,100%,50%))",
};
const FALLBACK_GRADIENT = "linear-gradient(135deg, #eee, #999)";

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: "#70757a",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function SelectedBadge() {
  return (
    <span
      style={{
        position: "absolute",
        top: -3,
        right: -3,
        width: 18,
        height: 18,
        borderRadius: "50%",
        backgroundColor: ACCENT,
        border: "2px solid #fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        zIndex: 2,
      }}
    >
      <Check size={10} color="#fff" strokeWidth={3.5} />
    </span>
  );
}

// Circular progress ring with the percentage in the middle.
// Falls back to an indeterminate spinner when no progress number is known.
function ProgressRing({ progress }) {
  if (typeof progress !== "number") return <span className="mlc-spinner" />;
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: 48, height: 48 }}>
      <svg
        width="48"
        height="48"
        viewBox="0 0 42 42"
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle
          cx="21"
          cy="21"
          r={r}
          fill="rgba(255,255,255,0.85)"
          stroke="rgba(26,115,232,0.2)"
          strokeWidth="3.5"
        />
        <circle
          cx="21"
          cy="21"
          r={r}
          fill="none"
          stroke={ACCENT}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: "stroke-dashoffset 0.25s ease" }}
        />
      </svg>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          color: "#1a1a1a",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pct}%
      </span>
    </div>
  );
}

// "x" badge on an active / loading tile (clicking the tile removes the layer).
function RemoveBadge() {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        top: -4,
        right: -4,
        width: 20,
        height: 20,
        borderRadius: "50%",
        backgroundColor: "#3c4043",
        border: "2px solid #fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
        zIndex: 2,
      }}
    >
      <X size={10} color="#fff" strokeWidth={3.5} />
    </span>
  );
}

// ---------- Base map option (Map / Satellite) ----------
function BaseOption({ layer, size, selected, onClick, tabIndex, compact }) {
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: 0,
        background: "none",
        border: "none",
        cursor: "pointer",
        outline: "none",
      }}
    >
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          borderRadius: 12,
          overflow: "visible",
          transform: hover ? "scale(1.04)" : "scale(1)",
          transition: "transform 0.15s ease",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 12,
            overflow: "hidden",
            boxSizing: "border-box",
            backgroundColor: layer.fallback,
            border: selected ? `2px solid ${ACCENT}` : "2px solid transparent",
            boxShadow: selected ? "none" : "inset 0 0 0 1px rgba(0,0,0,0.1)",
            transition: "border-color 0.15s ease",
          }}
        >
          {!failed && (
            <img
              src={layer.thumbnail}
              alt=""
              draggable={false}
              onError={() => setFailed(true)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
        {selected && <SelectedBadge />}
      </div>
      <span
        style={{
          fontSize: compact ? 11 : 12,
          fontWeight: selected ? 700 : 500,
          color: selected ? ACCENT : "#3c4043",
        }}
      >
        {layer.label}
      </span>
    </button>
  );
}

// ---------- Raster ("map details") option ----------
function DetailOption({
  layerKey,
  config,
  size,
  active,
  loading,
  progress,
  error,
  onClick,
  tabIndex,
  compact,
}) {
  const [hover, setHover] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const gradient = RAMP_GRADIENTS[config.colorScale] || FALLBACK_GRADIENT;
  // Show the ring while loading, or whenever a live progress value exists
  // for an active layer (guards against loading flicker).
  const showProgress =
    loading || (active && typeof progress === "number" && progress < 100);
  const label = SHORT_NAMES[layerKey] || config.name;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      tabIndex={tabIndex}
      onClick={onClick}
      title={
        error
          ? `${config.name} — ${error}`
          : `${config.name}: ${config.description}`
      }
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
        padding: 0,
        background: "none",
        border: "none",
        cursor: "pointer",
        outline: "none",
        width: size,
      }}
    >
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          transform: hover ? "scale(1.05)" : "scale(1)",
          transition: "transform 0.15s ease",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 12,
            overflow: "hidden",
            boxSizing: "border-box",
            border: error
              ? "2px solid #e53935"
              : active
                ? `2px solid ${ACCENT}`
                : "2px solid transparent",
            boxShadow:
              active || error ? "none" : "inset 0 0 0 1px rgba(0,0,0,0.1)",
            // With a PNG preview use a neutral backdrop so transparent PNG
            // areas don't show the gradient; gradient is only the fallback.
            background:
              config.preview && !imgFailed ? "#2b3a32" : `${gradient}`,
            transition: "border-color 0.15s ease",
          }}
        >
          {/* PNG preview (falls back to the gradient background if missing) */}
          {config.preview && !imgFailed && (
            <img
              src={config.preview}
              alt=""
              draggable={false}
              onError={() => setImgFailed(true)}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                pointerEvents: "none",
              }}
            />
          )}
          {/* Dim inactive tiles slightly so the active one pops */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,255,255,0.28)",
              opacity: active ? 0 : 1,
              transition: "opacity 0.15s ease",
            }}
          />
          {showProgress && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.28)",
                pointerEvents: "none",
                zIndex: 1,
              }}
            >
              <ProgressRing progress={progress} />
            </div>
          )}
          {error && !showProgress && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(255,255,255,0.6)",
              }}
            >
              <AlertTriangle size={20} color="#e53935" />
            </div>
          )}
        </div>
        {(active || loading) && <RemoveBadge />}
      </div>
      <span
        style={{
          fontSize: compact ? 10 : 11,
          lineHeight: 1.2,
          textAlign: "center",
          fontWeight: active ? 700 : 500,
          color: error ? "#e53935" : active ? ACCENT : "#3c4043",
          maxWidth: size + 6,
          whiteSpace: "normal",
          overflowWrap: "anywhere",
        }}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * Google-Maps-style layers control (base map + QGIS raster layers).
 *
 * Collapsed: floating thumbnail button (bottom-left). Shows a small blue dot
 * when a raster layer is active.
 * Expanded: rounded card with two sections:
 *   - "Map type"    -> Map / Satellite (radio)
 *   - "Map details" -> DEM, Slope, Aspect, TWI ... (one active at a time,
 *                      click the active one again to turn it off)
 *
 * Render as a sibling of <MapContainer>, replacing <QGISLayerControl />.
 */
export default function BaseLayerSwitcher({
  baseLayer,
  onBaseLayerChange,
  layerConfigs = {},
  activeLayers = [],
  onLayerToggle,
  layerErrors = {},
  layerLoading = {},
  layerProgress = {},
  compact = false,
  bottomOffset = 0,
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!rootRef.current) return;
    L.DomEvent.disableClickPropagation(rootRef.current);
    L.DomEvent.disableScrollPropagation(rootRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target))
        setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const btnSize = compact ? 56 : 64;
  const baseSize = compact ? 56 : 64;
  const detailSize = compact ? 56 : 62;
  const columns = compact ? 3 : 4;
  const gap = compact ? 10 : 12;
  const padX = compact ? 14 : 18;

  const current = BASE_LAYERS[baseLayer] || BASE_LAYERS.satellite;
  const next =
    BASE_LAYERS[BASE_LAYER_ORDER.find((k) => k !== current.key)] ||
    BASE_LAYERS.map;

  const detailEntries = Object.entries(layerConfigs);
  const activeCount = activeLayers.length;
  const firstError = Object.entries(layerErrors).find(([, v]) => v);

  const cardWidth = columns * detailSize + (columns - 1) * gap + padX * 2;

  const handleBaseSelect = (key) => {
    if (key !== baseLayer) onBaseLayerChange?.(key);
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: "absolute",
        left: 16,
        bottom: 24 + bottomOffset,
        zIndex: 1000,
        pointerEvents: "auto",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <style>{`
        @keyframes mlc-spin { to { transform: rotate(360deg); } }
        .mlc-spinner {
          width: 20px; height: 20px; border-radius: 50%;
          border: 2.5px solid rgba(26,115,232,0.25);
          border-top-color: #1a73e8;
          animation: mlc-spin 0.7s linear infinite;
        }
      `}</style>

      {/* ---------- Collapsed floating button ---------- */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-label={`Map layers. Base map: ${current.label}.${activeCount ? ` ${activeCount} data layer active.` : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        title="Layers"
        style={{
          position: "relative",
          display: "block",
          width: btnSize,
          height: btnSize,
          padding: 0,
          border: "2px solid #fff",
          borderRadius: 14,
          overflow: "visible",
          cursor: "pointer",
          background: next.fallback,
          boxShadow: hover
            ? "0 4px 14px rgba(0,0,0,0.35)"
            : "0 2px 8px rgba(0,0,0,0.3)",
          transform: open ? "scale(0.85)" : hover ? "translateY(-1px)" : "none",
          opacity: open ? 0 : 1,
          pointerEvents: open ? "none" : "auto",
          transition:
            "opacity 0.16s ease, transform 0.2s ease, box-shadow 0.2s ease",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <img
            src={next.thumbnail}
            alt=""
            draggable={false}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              pointerEvents: "none",
            }}
          />
          <span
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              padding: "10px 0 3px",
              textAlign: "center",
              fontSize: compact ? 10 : 11,
              fontWeight: 600,
              color: "#fff",
              background:
                "linear-gradient(to top, rgba(0,0,0,0.62), rgba(0,0,0,0))",
              pointerEvents: "none",
            }}
          >
            Layers
          </span>
        </div>
        {activeCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: ACCENT,
              border: "2px solid #fff",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            }}
          >
            {activeCount}
          </span>
        )}
      </button>

      {/* ---------- Expanded card ---------- */}
      <div
        aria-hidden={!open}
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: cardWidth,
          maxWidth: "calc(100vw - 32px)",
          boxSizing: "border-box",
          maxHeight: "min(70vh, 520px)",
          overflowY: "auto",
          padding: `14px ${padX}px 16px`,
          backgroundColor: "#fff",
          borderRadius: 18,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.18)",
          border: "1px solid rgba(0,0,0,0.05)",
          transformOrigin: "bottom left",
          transform: open ? "scale(1)" : "scale(0.5)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          visibility: open ? "visible" : "hidden",
          transition: `transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
                       opacity 0.18s ease,
                       visibility 0s linear ${open ? "0s" : "0.22s"}`,
        }}
      >
        {/* Header: section label + close button */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
          }}
        >
          <SectionLabel>Map type</SectionLabel>
          <button
            type="button"
            aria-label="Close layers panel"
            title="Close"
            tabIndex={open ? 0 : -1}
            onClick={() => setOpen(false)}
            style={{
              marginTop: -4,
              marginRight: -6,
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "none",
              background: "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#5f6368",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0,0,0,0.06)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div
          role="radiogroup"
          aria-label="Base map"
          style={{ display: "flex", gap: compact ? 12 : 16 }}
        >
          {BASE_LAYER_ORDER.map((key) => (
            <BaseOption
              key={key}
              layer={BASE_LAYERS[key]}
              size={baseSize}
              compact={compact}
              selected={key === baseLayer}
              tabIndex={open ? 0 : -1}
              onClick={() => handleBaseSelect(key)}
            />
          ))}
        </div>

        {/* Divider */}
        {detailEntries.length > 0 && (
          <div
            style={{
              height: 1,
              background: "rgba(0,0,0,0.08)",
              margin: "14px -2px 12px",
            }}
          />
        )}

        {/* Map details (QGIS raster layers) */}
        {detailEntries.length > 0 && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: "#70757a",
                }}
              >
                Map details
              </div>
              {activeCount > 0 && (
                <button
                  type="button"
                  tabIndex={open ? 0 : -1}
                  onClick={() =>
                    activeLayers.forEach((k) => onLayerToggle?.(k))
                  }
                  style={{
                    border: "none",
                    background: "none",
                    padding: "2px 4px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: ACCENT,
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            <div
              role="group"
              aria-label="Data layers"
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, ${detailSize}px)`,
                columnGap: gap,
                rowGap: 12,
              }}
            >
              {detailEntries.map(([key, config]) => (
                <DetailOption
                  key={key}
                  layerKey={key}
                  config={config}
                  size={detailSize}
                  compact={compact}
                  active={activeLayers.includes(key)}
                  loading={!!layerLoading[key]}
                  progress={layerProgress[key]}
                  error={layerErrors[key]}
                  tabIndex={open ? 0 : -1}
                  onClick={() => onLayerToggle?.(key)}
                />
              ))}
            </div>
            {firstError && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 10.5,
                  lineHeight: 1.35,
                  color: "#e53935",
                }}
              >
                {layerConfigs[firstError[0]]?.name || firstError[0]}:{" "}
                {firstError[1]}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
