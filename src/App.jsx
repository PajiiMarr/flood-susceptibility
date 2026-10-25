import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import FloodMap from "./components/Map";
import LandingPage from "./components/LandingPage";
import "./App.css";

// Wrapper for the Landing Page to handle navigation
function LandingPageWrapper() {
  const navigate = useNavigate();
  return <LandingPage onEnterMap={() => navigate("/map")} />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Root Route */}
        <Route path="/" element={<LandingPageWrapper />} />

        {/* Map Route */}
        <Route path="/map" element={<FloodMap />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
