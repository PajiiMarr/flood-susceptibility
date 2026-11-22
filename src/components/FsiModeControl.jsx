// flood-map/src/components/FsiModeControl.jsx
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Check, X } from "lucide-react";

const ACCENT = "#1a73e8";

// ==========================================
// FSI MAP OPTIONS
// ==========================================
export const FSI_MAP_OPTIONS = {
  fsi: {
    key: "fsi",
    name: "Flood Susceptibility Index",
    short: "FSI",
    description: "Combined flood susceptibility",
    gradient:
      "linear-gradient(135deg, rgb(145,191,219), rgb(254,224,144), rgb(252,141,89), rgb(215,48,39))",
    fallback: "#fee090",
  },
  susceptibility: {
    key: "susceptibility",
    name: "Susceptibility Map",
    short: "Susceptibility",
    description: "Event-specific susceptibility",
    gradient:
      "linear-gradient(135deg, rgb(145,191,219), rgb(254,224,144), rgb(252,141,89), rgb(215,48,39))",
    fallback: "#fc8d59",
  },
};

const FSI_ORDER = ["fsi", "susceptibility"];

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

function ModeOption({ opt, size, active, onClick, tabIndex, compact, selectedEvent }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      tabIndex={tabIndex}
      onClick={onClick}
      title={`${opt.name}: ${opt.description}`}
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
            border: active ? `2px solid ${ACCENT}` : "2px solid transparent",
            boxShadow: active ? "none" : "inset 0 0 0 1px rgba(0,0,0,0.1)",
            background: opt.gradient,
            transition: "border-color 0.15s ease",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 800,
              color: "#fff",
              textShadow: "0 1px 2px rgba(0,0,0,0.45)",
              letterSpacing: 0.5,
              pointerEvents: "none",
            }}
          >
            {opt.key === "fsi" ? "FSI" : "SUS"}
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,255,255,0.28)",
              opacity: active ? 0 : 1,
              transition: "opacity 0.15s ease",
            }}
          />
        </div>
        {active && <SelectedBadge />}
      </div>
      <span
        style={{
          fontSize: compact ? 10 : 11,
          lineHeight: 1.2,
          textAlign: "center",
          fontWeight: active ? 700 : 500,
          color: active ? ACCENT : "#3c4043",
          maxWidth: size + 6,
          whiteSpace: "normal",
          overflowWrap: "anywhere",
        }}
      >
        {opt.short}
        {opt.key === "susceptibility" && selectedEvent
          ? ` (${selectedEvent})`
          : ""}
      </span>
    </button>
  );
}

export default function FsiModeControl({
  mode,               // "none" | "fsi" | "susceptibility"
  onModeChange,
  selectedEvent,
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
  const detailSize = compact ? 56 : 62;
  const gap = compact ? 10 : 12;
  const padX = compact ? 14 : 18;
  const cardWidth = FSI_ORDER.length * detailSize + (FSI_ORDER.length - 1) * gap + padX * 2;

  const activeOpt = mode !== "none" ? FSI_MAP_OPTIONS[mode] : null;

  return (
    <div
      ref={rootRef}
      style={{
        position: "absolute",
        left: 16,
        bottom: 24 + btnSize + 12 + bottomOffset, // sits above BaseLayerSwitcher
        zIndex: 1000,
        pointerEvents: "auto",
        fontFamily: "Arial, sans-serif",
      }}
    >
      {/* ---------- Collapsed floating button ---------- */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-label={`Flood susceptibility layers${activeOpt ? `: ${activeOpt.name}` : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        title="Flood susceptibility"
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
          background: activeOpt ? activeOpt.fallback : "#d73027",
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
            background: activeOpt
              ? activeOpt.gradient
              : FSI_MAP_OPTIONS.fsi.gradient,
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 800,
              color: "#fff",
              textShadow: "0 1px 2px rgba(0,0,0,0.5)",
              letterSpacing: 0.5,
            }}
          >
            FSI
          </span>
          <span
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              padding: "10px 0 3px",
              textAlign: "center",
              fontSize: compact ? 9 : 10,
              fontWeight: 600,
              color: "#fff",
              background:
                "linear-gradient(to top, rgba(0,0,0,0.62), rgba(0,0,0,0))",
              pointerEvents: "none",
            }}
          >
            Flood
          </span>
        </div>
        {activeOpt && (
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
            1
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
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
          }}
        >
          <SectionLabel>Flood susceptibility</SectionLabel>
          <button
            type="button"
            aria-label="Close flood susceptibility panel"
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
          aria-label="Flood susceptibility layer"
          style={{ display: "flex", gap: compact ? 12 : 16 }}
        >
          {FSI_ORDER.map((key) => (
            <ModeOption
              key={key}
              opt={FSI_MAP_OPTIONS[key]}
              size={detailSize}
              compact={compact}
              active={mode === key}
              selectedEvent={selectedEvent}
              tabIndex={open ? 0 : -1}
              onClick={() => onModeChange(mode === key ? "none" : key)}
            />
          ))}
        </div>

        {mode === "susceptibility" && (
          <div
            style={{
              marginTop: 10,
              fontSize: 10.5,
              lineHeight: 1.35,
              color: "#5f6368",
            }}
          >
            Event: <strong>{selectedEvent || "overall"}</strong>
          </div>
        )}
      </div>
    </div>
  );
}