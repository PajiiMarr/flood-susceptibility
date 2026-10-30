import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import Dashboard from "./components/admin/Dashboard";
import FloodMap from "./components/Map";
import LandingPage from "./components/LandingPage";
import LoginPage from "./components/LoginPage";
import "./App.css";

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
      onNavigateToRegister={() => navigate("/register")} // Placeholder
    />
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPageWrapper />} />

        <Route path="/login" element={<LoginPageWrapper />} />

        <Route path="/map" element={<FloodMap />} />

        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
