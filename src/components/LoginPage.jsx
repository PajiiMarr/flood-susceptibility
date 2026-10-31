import React, { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, ArrowRight, Map } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

export default function LoginPage({ onNavigateToRegister, onNavigateHome }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMsg(error.message);
      setIsLoading(false);
      return;
    }

    navigate("/dashboard");
  };

  return (
    <div className="flex min-h-screen w-full bg-slate-50">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-slate-900 p-12 lg:flex">
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

        <div className="relative z-10 flex items-center gap-2">
          <Map className="h-8 w-8 text-blue-500" />
          <span className="text-2xl font-extrabold tracking-tight uppercase text-blue-500">
            ABENIDA
          </span>
        </div>

        <div className="relative z-10 max-w-lg">
          {/* Forced white text via inline styles */}
          <h1
            style={{ color: "#ffffff" }}
            className="mb-4 text-4xl font-bold leading-tight"
          >
            Mapping High-Resolution Flood Susceptibility
          </h1>
          <p style={{ color: "#cbd5e1" }} className="text-lg">
            Using Spatial Machine Learning in Zamboanga City. Log in to access
            the interactive map, spatial models, and risk assessments.
          </p>
          <div
            style={{ color: "#94a3b8" }}
            className="mt-8 flex items-center gap-4 text-sm font-medium tracking-widest uppercase"
          >
            <span>Balagosa</span>
            <span className="h-1 w-1 rounded-full bg-slate-600"></span>
            <span>Manon-og</span>
            <span className="h-1 w-1 rounded-full bg-slate-600"></span>
            <span>Brillantes</span>
          </div>
        </div>

        <div style={{ color: "#64748b" }} className="relative z-10 text-sm">
          &copy; {new Date().getFullYear()} ABENIDA Thesis Project.
        </div>
      </div>

      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center text-center lg:hidden">
            <Map className="mb-2 h-10 w-10 text-blue-600" />
            <h1 className="text-2xl font-extrabold uppercase tracking-tight text-blue-600">
              ABENIDA
            </h1>
          </div>

          <div className="text-center lg:text-left">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">
              Sign in to your account
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Enter your credentials to access the flood susceptibility
              dashboard.
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Username / Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your username or email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className={`pl-10 h-11 bg-white ${
                      errorMsg
                        ? "border-red-500 focus-visible:ring-red-500"
                        : "border-slate-300 focus-visible:ring-blue-600"
                    }`}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Password
                  </label>
                  <a
                    href="#"
                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    Forgot password?
                  </a>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={`pl-10 h-11 bg-white ${
                      errorMsg
                        ? "border-red-500 focus-visible:ring-red-500"
                        : "border-slate-300 focus-visible:ring-blue-600"
                    }`}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center">
              <input
                id="remember-me"
                name="remember-me"
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <label
                htmlFor="remember-me"
                className="ml-2 block text-sm text-slate-700"
              >
                Remember me
              </label>
            </div>

            {errorMsg && (
              <p className="text-sm text-red-500 font-medium">{errorMsg}</p>
            )}

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? (
                "Authenticating..."
              ) : (
                <>
                  Sign in <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-slate-600">
            Don't have an account?{" "}
            <button
              onClick={onNavigateToRegister}
              className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
            >
              Request access
            </button>
          </p>

          <div className="text-center">
            <button
              onClick={onNavigateHome}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              &larr; Back to home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
