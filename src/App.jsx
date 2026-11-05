import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import Dashboard from "./components/admin/Dashboard";
import FloodMap from "./components/Map";
import LandingPage from "./components/LandingPage";
import LoginPage from "./components/LoginPage";
import NotFoundPage from "./components/NotFoundPage";
import ForgotPassword from "./components/auth/ForgotPassword";
import UpdatePassword from "./components/auth/UpdatePassword";
import RequestAccount from "./components/auth/RequestAccount";
import "./App.css";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import FloodEventsPage from "./components/admin/FloodEventsPage";
import UsersPage from "./components/admin/Users";

function LandingPageWrapper() {
  const navigate = useNavigate();
  return <LandingPage onEnterMap={() => navigate("/map")} />;
}

function LoginPageWrapper() {
  const navigate = useNavigate();
  return (
    <LoginPage
      onLogin={() => navigate("/map")}
      onNavigateHome={() => navigate("/")}
      onNavigateToRegister={() => navigate("/register")}
      onNavigateToForgotPassword={() => navigate("/forgot-password")}
    />
  );
}

function ForgotPasswordWrapper() {
  const navigate = useNavigate();
  return (
    <ForgotPassword
      onNavigateToLogin={() => navigate("/login")}
      onNavigateHome={() => navigate("/")}
    />
  );
}

function RequestAccountWrapper() {
  const navigate = useNavigate();
  return (
    <RequestAccount
      onNavigateToLogin={() => navigate("/login")}
      onNavigateHome={() => navigate("/")}
    />
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPageWrapper />} />
          <Route path="/login" element={<LoginPageWrapper />} />
          <Route path="/forgot-password" element={<ForgotPasswordWrapper />} />

          <Route path="/register" element={<RequestAccountWrapper />} />

          <Route path="/update-password" element={<UpdatePassword />} />
          <Route path="/map" element={<FloodMap />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/events"
            element={
              <ProtectedRoute>
                <div className="min-h-screen bg-slate-50">
                  <FloodEventsPage />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute>
                <UsersPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </AuthProvider>
  );
}

export default App;
