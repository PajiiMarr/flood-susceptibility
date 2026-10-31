import React from "react";
import { useNavigate } from "react-router-dom";
import { Map, ArrowLeft, Home } from "lucide-react";

function contourPath(cx, cy, r, seed) {
  const pts = [];
  const steps = 72;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const wobble =
      1 +
      0.12 * Math.sin(3 * a + seed) +
      0.07 * Math.sin(5 * a + seed * 1.7) +
      0.04 * Math.sin(9 * a + seed * 0.6);
    pts.push(
      `${(cx + Math.cos(a) * r * wobble * 1.35).toFixed(1)},${(
        cy +
        Math.sin(a) * r * wobble
      ).toFixed(1)}`,
    );
  }
  return "M" + pts.join("L") + "Z";
}

const CONTOURS = Array.from({ length: 18 }, (_, i) =>
  contourPath(400, 400, 20 + i * 30, i * 0.4),
);

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-slate-900">
      <svg
        className="absolute inset-0 h-full w-full opacity-10 pointer-events-none"
        viewBox="0 0 800 800"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        {CONTOURS.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="#60a5fa"
            strokeWidth={i % 5 === 0 ? "2" : "1"}
          />
        ))}
      </svg>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="mb-6 flex items-center justify-center gap-3 text-blue-500">
          <Map className="h-10 w-10" />
          <span className="text-3xl font-extrabold tracking-tight uppercase text-blue-500">
            ABENIDA
          </span>
        </div>

        <h1 style={{ color: "#ffffff" }} className="mb-2 text-8xl font-black">
          404
        </h1>
        <h2 style={{ color: "#ffffff" }} className="mb-6 text-2xl font-bold">
          Page Not Found
        </h2>

        <p className="mb-10 max-w-md text-slate-300">
          The location you are trying to access does not exist on this map. It
          may have been moved, or you may have mistyped the URL.
        </p>

        {/* Replaced Buttons with minimalist links */}
        <div className="flex flex-col sm:flex-row items-center gap-8 py-3">
          <button
            onClick={() => navigate(-1)}
            className="group flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-white transition-colors duration-200"
          >
            <ArrowLeft className="h-4 w-4 transform group-hover:-translate-x-1 transition-transform duration-200" />
            <span>Go Back</span>
          </button>

          <button
            onClick={() => navigate("/")}
            className="group flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-white transition-colors duration-200"
          >
            <Home className="h-4 w-4" />
            <span>Back to Home</span>
          </button>
        </div>
      </div>

      <div className="relative z-10 py-8 text-center text-sm text-slate-500">
        &copy; {new Date().getFullYear()} ABENIDA Thesis Project.
      </div>
    </div>
  );
}
