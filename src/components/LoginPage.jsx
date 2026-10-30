import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, ArrowRight, ShieldCheck, Map } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Reusing the wobbly contour logic from LandingPage
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

export default function LoginPage({
  onLogin,
  onNavigateToRegister,
  onNavigateHome,
}) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      if (onLogin) onLogin({ email });
      navigate("/dashboard"); // <-- Redirect to Dashboard after login
    }, 1500);
  };

  return (
    <div className="flex min-h-screen w-full bg-slate-50">
      {/* LEFT SIDE: Branding & Topographic Background */}
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

        <div className="relative z-10 flex items-center gap-2 text-white">
          <Map className="h-8 w-8 text-blue-500" />
          <span className="text-2xl font-extrabold tracking-tight uppercase text-blue-500">
            ABENIDA
          </span>
        </div>

        <div className="relative z-10 max-w-lg">
          <h1 className="mb-4 text-4xl font-bold leading-tight text-white">
            Mapping High-Resolution Flood Susceptibility
          </h1>
          <p className="text-lg text-slate-300">
            Using Spatial Machine Learning in Zamboanga City. Log in to access
            the interactive map, spatial models, and risk assessments.
          </p>
          <div className="mt-8 flex items-center gap-4 text-sm font-medium tracking-widest text-slate-400 uppercase">
            <span>Balagosa</span>
            <span className="h-1 w-1 rounded-full bg-slate-600"></span>
            <span>Manon-og</span>
            <span className="h-1 w-1 rounded-full bg-slate-600"></span>
            <span>Brillantes</span>
          </div>
        </div>

        <div className="relative z-10 text-sm text-slate-500">
          &copy; {new Date().getFullYear()} ABENIDA Thesis Project.
        </div>
      </div>

      {/* RIGHT SIDE: Login Form */}
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
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="researcher@zamboanga.edu.ph"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-10 h-11 bg-white border-slate-300 focus-visible:ring-blue-600"
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
                    className="pl-10 h-11 bg-white border-slate-300 focus-visible:ring-blue-600"
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

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-slate-50 px-2 text-slate-500">
                Or continue with
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              type="button"
              className="w-full h-11 bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              <ShieldCheck className="mr-2 h-4 w-4 text-green-600" />
              Google
            </Button>
            <Button
              variant="outline"
              type="button"
              className="w-full h-11 bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              <svg
                className="mr-2 h-4 w-4"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                  clipRule="evenodd"
                />
              </svg>
              GitHub
            </Button>
          </div>

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
