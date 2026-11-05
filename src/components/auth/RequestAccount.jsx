import React, { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  Mail,
  User,
  Map,
  ArrowRight,
  ArrowLeft,
  Clock,
  Building,
  Lock,
} from "lucide-react";
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

export default function RequestAccount({ onNavigateToLogin, onNavigateHome }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);

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

    try {
      // 1. Create the Auth User with 'pending' metadata
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            organization: organization,
            status: "pending", // <-- Crucial flag for the admin to see
          },
        },
      });

      if (authError) throw authError;

      // 2. (Optional) Save to a public table for easy admin viewing
      // If you have an 'account_requests' table, we can insert here too.
      if (authData.user) {
        const { error: dbError } = await supabase
          .from("account_requests")
          .insert([
            {
              id: authData.user.id, // link to auth user
              full_name: fullName,
              email: email,
              organization: organization,
              status: "pending",
            },
          ]);

        // We don't throw here if dbError happens, because auth succeeded.
        if (dbError) console.warn("Could not save to public table:", dbError);
      }

      setIsSuccess(true);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Failed to submit request. Please try again.");
    } finally {
      setIsLoading(false);
    }
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

          {isSuccess ? (
            <div className="text-center space-y-6">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
                <Clock className="h-10 w-10 text-amber-600" />
              </div>
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-slate-900">
                  Request Pending
                </h2>
                <p className="mt-4 text-sm text-slate-500 leading-relaxed">
                  Your account has been created and is currently pending admin
                  approval. You will be able to log in once an administrator
                  reviews and approves your account.
                </p>
              </div>
              <Button
                onClick={onNavigateToLogin}
                className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm transition-all"
              >
                Back to Sign In
              </Button>
            </div>
          ) : (
            <>
              <div className="text-center lg:text-left">
                <h2 className="text-3xl font-bold tracking-tight text-slate-900">
                  Request Access
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  Create an account. All new accounts require admin approval
                  before granting access.
                </p>
              </div>

              <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="fullName"
                      className="mb-1 block text-sm font-medium text-slate-700"
                    >
                      Full Name
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        id="fullName"
                        type="text"
                        placeholder="John Doe"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        className="pl-10 h-11 bg-white border-slate-300 focus-visible:ring-blue-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="email"
                      className="mb-1 block text-sm font-medium text-slate-700"
                    >
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="name@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="pl-10 h-11 bg-white border-slate-300 focus-visible:ring-blue-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="organization"
                      className="mb-1 block text-sm font-medium text-slate-700"
                    >
                      Organization / Department
                    </label>
                    <div className="relative">
                      <Building className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        id="organization"
                        type="text"
                        placeholder="e.g., ZC DRRMO, WMSU"
                        value={organization}
                        onChange={(e) => setOrganization(e.target.value)}
                        required
                        className="pl-10 h-11 bg-white border-slate-300 focus-visible:ring-blue-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="password"
                      className="mb-1 block text-sm font-medium text-slate-700"
                    >
                      Password
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
                        className="pl-10 h-11 bg-white border-slate-300 focus-visible:ring-blue-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="confirmPassword"
                      className="mb-1 block text-sm font-medium text-slate-700"
                    >
                      Confirm Password
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
                        className="pl-10 h-11 bg-white border-slate-300 focus-visible:ring-blue-600"
                      />
                    </div>
                  </div>
                </div>

                {errorMsg && (
                  <p className="text-sm text-red-500 font-medium">{errorMsg}</p>
                )}

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm transition-all flex items-center justify-center gap-2 mt-2"
                >
                  {isLoading ? (
                    "Submitting Request..."
                  ) : (
                    <>
                      Submit Request <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            </>
          )}

          {!isSuccess && (
            <div className="text-center pt-2">
              <button
                onClick={onNavigateToLogin}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </button>
            </div>
          )}

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
