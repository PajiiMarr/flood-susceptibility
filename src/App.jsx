import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import Dashboard from "./components/admin/Dashboard";
import FloodMap from "./components/Map";
import LandingPage from "./components/LandingPage";
import LoginPage from "./components/LoginPage";
import NotFoundPage from "./components/NotFoundPage"; // <-- Add import
import "./App.css";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import FloodEventsPage from "./components/admin/FloodEventsPage";

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
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
