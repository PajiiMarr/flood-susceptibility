import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useNavigate } from "react-router-dom";
import { Lock, ArrowRight, Map, CheckCircle2, ArrowLeft } from "lucide-react";
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

export default function UpdatePassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isValidSession, setIsValidSession] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        setIsValidSession(true);
      } else {
        // Reset the session if the link is invalid/expired to clean up any state
        await supabase.auth.signOut();
        setErrorMsg(
          "Invalid or expired password reset link. Please request a new one.",
        );
      }
    };
    checkSession();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters long.");
      return;
    }

    setIsLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setErrorMsg(error.message);
      setIsLoading(false);
      return;
    }

    setSuccessMsg("Your password has been successfully updated.");

    // Redirect to dashboard after a short delay
    setTimeout(() => {
      navigate("/dashboard", { replace: true });
    }, 2000);
  };

  return (
    <div className="flex min-h-screen w-full bg-slate-50">
      {/* Left Pane - Branding */}
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
        </div>

        <div style={{ color: "#64748b" }} className="relative z-10 text-sm">
          &copy; {new Date().getFullYear()} ABENIDA Thesis Project.
        </div>
      </div>

      {/* Right Pane - Form */}
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
              Create new password
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Your new password must be different from previous used passwords.
            </p>
          </div>

          {successMsg ? (
            <div className="rounded-md bg-green-50 p-4 border border-green-200">
              <div className="flex">
                <div className="flex-shrink-0">
                  <CheckCircle2
                    className="h-5 w-5 text-green-400"
                    aria-hidden="true"
                  />
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-green-800">
                    Password updated
                  </h3>
                  <div className="mt-2 text-sm text-green-700">
                    <p>{successMsg} Redirecting to dashboard...</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="password"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={!isValidSession}
                      className={`pl-10 h-11 bg-white ${
                        errorMsg
                          ? "border-red-500 focus-visible:ring-red-500"
                          : "border-slate-300 focus-visible:ring-blue-600"
                      }`}
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="confirmPassword"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      disabled={!isValidSession}
                      className={`pl-10 h-11 bg-white ${
                        errorMsg
                          ? "border-red-500 focus-visible:ring-red-500"
                          : "border-slate-300 focus-visible:ring-blue-600"
                      }`}
                    />
                  </div>
                </div>
              </div>

              {errorMsg && (
                <p className="text-sm text-red-500 font-medium">{errorMsg}</p>
              )}

              <Button
                type="submit"
                disabled={isLoading || !isValidSession}
                className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm transition-all flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  "Updating..."
                ) : (
                  <>
                    Update Password <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          )}

          <div className="text-center">
            <button
              onClick={() => navigate("/login")}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
