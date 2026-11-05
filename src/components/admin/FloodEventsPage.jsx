import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Map,
  LayoutDashboard,
  LogOut,
  ArrowRight,
  CalendarDays,
  CloudRain,
  Wind,
  AlertTriangle,
  ChevronRight,
  UploadCloud,
  CheckCircle2,
  FileWarning,
  Loader2,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import * as geotiff from "geotiff";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { toast } from "sonner";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const EXPECTED_METADATA = {
  width: 5923,
  height: 7299,
  originX: 121.89749655352134,
  originY: 7.513751632015,
  pixelSizeX: 8.983152841195215e-5,
  pixelSizeY: 8.983152841195215e-5,
};

async function validateTiffMetadata(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const tiff = await geotiff.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const origin = image.getOrigin();
    const resolution = image.getResolution();

    if (width !== EXPECTED_METADATA.width)
      throw new Error(
        `Width mismatch: Expected ${EXPECTED_METADATA.width}, got ${width}`,
      );
    if (height !== EXPECTED_METADATA.height)
      throw new Error(
        `Height mismatch: Expected ${EXPECTED_METADATA.height}, got ${height}`,
      );
    if (Math.abs(origin[0] - EXPECTED_METADATA.originX) > 1e-6)
      throw new Error(`Origin X mismatch.`);
    if (Math.abs(origin[1] - EXPECTED_METADATA.originY) > 1e-6)
      throw new Error(`Origin Y mismatch.`);
    if (Math.abs(Math.abs(resolution[0]) - EXPECTED_METADATA.pixelSizeX) > 1e-8)
      throw new Error(`Pixel Size X mismatch.`);
    if (Math.abs(Math.abs(resolution[1]) - EXPECTED_METADATA.pixelSizeY) > 1e-8)
      throw new Error(`Pixel Size Y mismatch.`);

    return { valid: true, message: "Metadata verified successfully." };
  } catch (err) {
    return { valid: false, message: err.message || "Invalid TIFF format." };
  }
}

export default function FloodEventsPage() {
  const navigate = useNavigate();
  const [dbEvents, setDbEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [files, setFiles] = useState({
    floodMap: { file: null, status: "idle", message: "" },
    diffDb: { file: null, status: "idle", message: "" },
    ndfi: { file: null, status: "idle", message: "" },
  });

  const [metadata, setMetadata] = useState({
    eventName: "",
    rainfallDetails: "",
    affectedBarangays: "",
    affectedFamilies: "",
    affectedIndividuals: "",
    casualties: "",
    infrastructureDamages: "",
    totalCostDamaged: "",
    houseDamagesDetails: "",
    livestockDamages: "",
    agriculturalDamages: "",
    powerSupplyDamages: "",
  });

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const fetchEvents = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("flood_events")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setDbEvents(data);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setMetadata((prev) => ({ ...prev, [name]: value }));
    if (successMsg) setSuccessMsg("");
  };

  const handleFileChange = async (e, type) => {
    const file = e.target.files[0];
    if (!file) return;
    setFiles((prev) => ({
      ...prev,
      [type]: { file, status: "validating", message: "Checking metadata..." },
    }));
    const result = await validateTiffMetadata(file);
    setFiles((prev) => ({
      ...prev,
      [type]: {
        file,
        status: result.valid ? "success" : "error",
        message: result.message,
      },
    }));
    if (successMsg) setSuccessMsg("");
  };

  const isFormValid =
    metadata.eventName.trim() !== "" &&
    files.floodMap.status === "success" &&
    files.diffDb.status === "success" &&
    files.ndfi.status === "success";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isFormValid) return;

    setIsSubmitting(true);
    setSubmitError("");
    setSuccessMsg("");

    const formData = new FormData();
    formData.append("eventName", metadata.eventName);
    formData.append("rainfallDetails", metadata.rainfallDetails);
    formData.append("affectedBarangays", metadata.affectedBarangays);
    formData.append("affectedFamilies", metadata.affectedFamilies);
    formData.append("affectedIndividuals", metadata.affectedIndividuals);
    formData.append("casualties", metadata.casualties);
    formData.append("infrastructureDamages", metadata.infrastructureDamages);
    formData.append("totalCostDamaged", metadata.totalCostDamaged);
    formData.append("houseDamagesDetails", metadata.houseDamagesDetails);
    formData.append("livestockDamages", metadata.livestockDamages);
    formData.append("agriculturalDamages", metadata.agriculturalDamages);
    formData.append("powerSupplyDamages", metadata.powerSupplyDamages);
    formData.append("floodMap", files.floodMap.file);
    formData.append("diffDb", files.diffDb.file);
    formData.append("ndfi", files.ndfi.file);

    try {
      const response = await fetch(`${API_BASE_URL}/api/events/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.detail || "Failed to upload event data.");

      setMetadata({
        eventName: "",
        rainfallDetails: "",
        affectedBarangays: "",
        affectedFamilies: "",
        affectedIndividuals: "",
        casualties: "",
        infrastructureDamages: "",
        totalCostDamaged: "",
        houseDamagesDetails: "",
        livestockDamages: "",
        agriculturalDamages: "",
        powerSupplyDamages: "",
      });
      setFiles({
        floodMap: { file: null, status: "idle", message: "" },
        diffDb: { file: null, status: "idle", message: "" },
        ndfi: { file: null, status: "idle", message: "" },
      });
      fetchEvents();
      setIsUploadOpen(false);

      toast.success("Event data uploaded successfully!", {
        description:
          data.message || "Model retraining has started in the background.",
      });
    } catch (error) {
      console.error(error);
      setSubmitError(error.message);

      toast.error("Upload Failed", {
        description: error.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-6 pb-8">
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-900 border-b pb-2">
          General Information
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="eventName">Flood Event Name</Label>
            <Input
              id="eventName"
              name="eventName"
              placeholder="e.g., Severe Tropical Storm Paeng"
              value={metadata.eventName}
              onChange={handleInputChange}
              required
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="rainfallDetails">
              Amount of Rainfall / Details
            </Label>
            <Textarea
              id="rainfallDetails"
              name="rainfallDetails"
              placeholder="e.g., Actual amount of rainfall Accumulated volume of rainfall was 158.3mm as of 9 pm, October 27, 2022"
              value={metadata.rainfallDetails}
              onChange={handleInputChange}
              rows={2}
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-900 border-b pb-2">
          Impact Data
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label htmlFor="affectedBarangays">Affected Barangays</Label>
            <Input
              id="affectedBarangays"
              name="affectedBarangays"
              type="number"
              placeholder="e.g., 43"
              value={metadata.affectedBarangays}
              onChange={handleInputChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="affectedFamilies">Affected Families</Label>
            <Input
              id="affectedFamilies"
              name="affectedFamilies"
              type="number"
              placeholder="e.g., 21445"
              value={metadata.affectedFamilies}
              onChange={handleInputChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="affectedIndividuals">Affected Individuals</Label>
            <Input
              id="affectedIndividuals"
              name="affectedIndividuals"
              type="number"
              placeholder="e.g., 94279"
              value={metadata.affectedIndividuals}
              onChange={handleInputChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="casualties">Casualties</Label>
            <Input
              id="casualties"
              name="casualties"
              type="number"
              placeholder="e.g., 0"
              value={metadata.casualties}
              onChange={handleInputChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="infrastructureDamages">
              Infrastructure Damages
            </Label>
            <Input
              id="infrastructureDamages"
              name="infrastructureDamages"
              type="number"
              placeholder="e.g., 82"
              value={metadata.infrastructureDamages}
              onChange={handleInputChange}
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-900 border-b pb-2">
          Financial Damages (PHP)
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="totalCostDamaged">Total Cost of Damaged</Label>
            <Input
              id="totalCostDamaged"
              name="totalCostDamaged"
              type="number"
              step="0.01"
              placeholder="e.g., 1159856000.00"
              value={metadata.totalCostDamaged}
              onChange={handleInputChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="livestockDamages">Livestock and Poultry</Label>
            <Input
              id="livestockDamages"
              name="livestockDamages"
              type="number"
              step="0.01"
              placeholder="e.g., 582300.00"
              value={metadata.livestockDamages}
              onChange={handleInputChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agriculturalDamages">Agricultural Damages</Label>
            <Input
              id="agriculturalDamages"
              name="agriculturalDamages"
              type="number"
              step="0.01"
              placeholder="e.g., 70470648.25"
              value={metadata.agriculturalDamages}
              onChange={handleInputChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="powerSupplyDamages">
              Power Supply Cost Damages
            </Label>
            <Input
              id="powerSupplyDamages"
              name="powerSupplyDamages"
              type="number"
              step="0.01"
              placeholder="e.g., 2082414.00"
              value={metadata.powerSupplyDamages}
              onChange={handleInputChange}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="houseDamagesDetails">House Damages Details</Label>
            <Input
              id="houseDamagesDetails"
              name="houseDamagesDetails"
              placeholder="e.g., Partially Damage: 2,462, Totally Damage: 943"
              value={metadata.houseDamagesDetails}
              onChange={handleInputChange}
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-900 border-b pb-2">
          Spatial Data (GeoTIFF)
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <Label className="text-sm font-medium">1. Flood Map (.tif)</Label>
            <Input
              type="file"
              accept=".tif,.tiff"
              onChange={(e) => handleFileChange(e, "floodMap")}
              className="cursor-pointer file:text-blue-600 file:bg-blue-50 hover:file:bg-blue-100 transition-colors"
            />
            {files.floodMap.status !== "idle" && (
              <p
                className={`text-xs flex items-center gap-1 mt-1 ${files.floodMap.status === "error" ? "text-red-500" : files.floodMap.status === "success" ? "text-green-600" : "text-slate-500"}`}
              >
                {files.floodMap.status === "validating" && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {files.floodMap.status === "success" && (
                  <CheckCircle2 className="h-3 w-3" />
                )}
                {files.floodMap.status === "error" && (
                  <FileWarning className="h-3 w-3" />
                )}
                {files.floodMap.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              2. Difference DB (.tif)
            </Label>
            <Input
              type="file"
              accept=".tif,.tiff"
              onChange={(e) => handleFileChange(e, "diffDb")}
              className="cursor-pointer file:text-blue-600 file:bg-blue-50 hover:file:bg-blue-100 transition-colors"
            />
            {files.diffDb.status !== "idle" && (
              <p
                className={`text-xs flex items-center gap-1 mt-1 ${files.diffDb.status === "error" ? "text-red-500" : files.diffDb.status === "success" ? "text-green-600" : "text-slate-500"}`}
              >
                {files.diffDb.status === "validating" && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {files.diffDb.status === "success" && (
                  <CheckCircle2 className="h-3 w-3" />
                )}
                {files.diffDb.status === "error" && (
                  <FileWarning className="h-3 w-3" />
                )}
                {files.diffDb.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">3. NDFI (.tif)</Label>
            <Input
              type="file"
              accept=".tif,.tiff"
              onChange={(e) => handleFileChange(e, "ndfi")}
              className="cursor-pointer file:text-blue-600 file:bg-blue-50 hover:file:bg-blue-100 transition-colors"
            />
            {files.ndfi.status !== "idle" && (
              <p
                className={`text-xs flex items-center gap-1 mt-1 ${files.ndfi.status === "error" ? "text-red-500" : files.ndfi.status === "success" ? "text-green-600" : "text-slate-500"}`}
              >
                {files.ndfi.status === "validating" && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {files.ndfi.status === "success" && (
                  <CheckCircle2 className="h-3 w-3" />
                )}
                {files.ndfi.status === "error" && (
                  <FileWarning className="h-3 w-3" />
                )}
                {files.ndfi.message}
              </p>
            )}
          </div>
        </div>
      </div>

      {submitError && (
        <div className="p-4 text-sm text-red-500 bg-red-50 border border-red-200 rounded-md flex items-center gap-2">
          <FileWarning className="h-5 w-5 text-red-500" />
          <strong>Upload Failed:</strong> {submitError}
        </div>
      )}

      <div className="flex justify-end pt-4 border-t border-slate-100">
        <Button
          type="submit"
          disabled={!isFormValid || isSubmitting}
          className="bg-blue-600 hover:bg-blue-700 text-white px-8 w-full sm:w-auto"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : (
            "Validate & Save Event"
          )}
        </Button>
      </div>
    </form>
  );

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-slate-50 font-sans overflow-hidden">
        <Sidebar className="bg-slate-900 border-r border-slate-800 [&_[data-sidebar=sidebar]]:bg-slate-900 [&_[data-sidebar=sidebar]]:border-slate-800">
          <SidebarHeader className="h-20 border-b border-slate-800 p-0 bg-slate-900">
            <div className="flex h-full w-full items-center px-4">
              <Map className="h-8 w-8 text-blue-500 mr-3 shrink-0" />
              <span className="text-xl font-extrabold tracking-tight uppercase text-white">
                ABENIDA
              </span>
            </div>
          </SidebarHeader>
          <SidebarContent className="pt-4 bg-slate-900">
            <SidebarGroup className="bg-slate-900">
              <SidebarGroupContent className="bg-slate-900">
                <SidebarMenu className="gap-2 px-2 bg-slate-900">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => navigate("/dashboard")}
                      className="h-11 px-4 text-sm font-medium text-slate-300 transition-all duration-200 hover:bg-slate-800 hover:text-white"
                    >
                      <LayoutDashboard size={18} />
                      <span>Dashboard Overview</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={true}
                      onClick={() => navigate("/events")}
                      className="h-11 px-4 text-sm font-medium bg-white text-slate-900 shadow-sm hover:bg-slate-100 hover:text-slate-900 transition-all duration-200"
                    >
                      <CalendarDays size={18} />
                      <span>Flood Events</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => navigate("/users")}
                      className="h-11 px-4 text-sm font-medium text-slate-300 transition-all duration-200 hover:bg-slate-800 hover:text-white"
                    >
                      <Users size={18} />
                      <span>Users</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="p-4 border-t border-slate-800 bg-slate-900">
            <div className="flex items-center gap-3 px-2 py-3 mb-2 rounded-lg bg-slate-800/50">
              <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold">
                A
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium text-white truncate">
                  Admin User
                </p>
                <p className="text-xs text-slate-400 truncate">
                  admin@abenida.ph
                </p>
              </div>
            </div>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={handleLogout}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-400 h-10 px-2"
                >
                  <LogOut size={18} />
                  <span>Sign out</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 overflow-y-auto relative">
          <header className="h-20 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-10">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="text-slate-500 hover:text-slate-900" />
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  Flood Events
                </h2>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setIsUploadOpen(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
              >
                <UploadCloud size={16} />
                <span className="hidden sm:inline">Upload Event</span>
                <span className="sm:hidden">Upload</span>
              </Button>
              <Button
                onClick={() => navigate("/map")}
                variant="outline"
                className="gap-2 group hidden sm:flex"
              >
                Open Map{" "}
                <ArrowRight
                  size={16}
                  className="group-hover:translate-x-1 transition-transform"
                />
              </Button>
            </div>
          </header>

          <div className="p-4 sm:p-8 space-y-8 max-w-7xl mx-auto">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-4">
                Archived Events
              </h3>
              <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 animate-fade-in-up">
                {isLoading ? (
                  [1, 2, 3].map((i) => (
                    <Card key={i} className="h-[340px]">
                      <CardHeader>
                        <Skeleton className="h-6 w-3/4 mb-2" />
                        <Skeleton className="h-4 w-1/2" />
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <Skeleton className="h-16 w-full" />
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-2/3" />
                        </div>
                      </CardContent>
                    </Card>
                  ))
                ) : dbEvents.length === 0 ? (
                  <div className="col-span-full text-center py-16 text-slate-500 bg-white rounded-lg border border-dashed border-slate-300">
                    No flood events have been uploaded yet.
                  </div>
                ) : (
                  dbEvents.map((event) => (
                    <Card
                      key={event.id}
                      className="flex flex-col hover:shadow-lg transition-shadow duration-300 group border-slate-200"
                    >
                      <CardHeader className="pb-4">
                        <div className="flex justify-between items-start">
                          <Badge
                            variant="secondary"
                            className="bg-slate-100 text-slate-700 hover:bg-slate-200"
                          >
                            Event
                          </Badge>
                          <Badge
                            variant="outline"
                            className="text-green-700 border-green-200 bg-green-50"
                          >
                            Archived
                          </Badge>
                        </div>
                        <CardTitle className="text-xl mt-2 group-hover:text-blue-600 transition-colors">
                          {event.event_name}
                        </CardTitle>
                        <CardDescription className="flex items-center gap-1.5 mt-1">
                          <CalendarDays className="h-4 w-4" />
                          {new Date(event.created_at).toLocaleDateString(
                            "en-US",
                            { month: "long", year: "numeric" },
                          )}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1">
                        <p className="text-sm text-slate-600 mb-6 line-clamp-3">
                          {event.rainfall_details ||
                            "No rainfall details provided."}
                        </p>
                        <div className="grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
                          <div className="flex flex-col items-center text-center">
                            <CloudRain className="h-5 w-5 text-blue-500 mb-1" />
                            <span className="text-xs text-slate-500">
                              Rainfall
                            </span>
                            <span
                              className="text-sm font-semibold truncate max-w-full px-1"
                              title={event.rainfall_details}
                            >
                              Details
                            </span>
                          </div>
                          <div className="flex flex-col items-center text-center border-x border-slate-200">
                            <Wind className="h-5 w-5 text-teal-500 mb-1" />
                            <span className="text-xs text-slate-500">
                              Families
                            </span>
                            <span className="text-sm font-semibold">
                              {event.affected_families?.toLocaleString() ||
                                "N/A"}
                            </span>
                          </div>
                          <div className="flex flex-col items-center text-center">
                            <AlertTriangle className="h-5 w-5 text-amber-500 mb-1" />
                            <span className="text-xs text-slate-500">
                              Affected
                            </span>
                            <span className="text-sm font-semibold">
                              {event.affected_barangays || "N/A"} Brgys
                            </span>
                          </div>
                        </div>
                      </CardContent>
                      <CardFooter className="pt-4 pb-4 border-t border-slate-100 mt-auto">
                        <Button
                          variant="outline"
                          className="w-full text-slate-600 hover:text-slate-900 group-hover:border-blue-300"
                          onClick={() =>
                            console.log(`Viewing details for ${event.id}`)
                          }
                        >
                          View Details <ChevronRight className="ml-2 h-4 w-4" />
                        </Button>
                      </CardFooter>
                    </Card>
                  ))
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {isMobile ? (
        <Sheet open={isUploadOpen} onOpenChange={setIsUploadOpen}>
          <SheetContent
            side="bottom"
            className="flex flex-col gap-0 p-0 max-h-[85dvh] sm:max-h-[80dvh] rounded-t-2xl"
          >
            <div className="pt-2 pb-1 flex justify-center">
              <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
            </div>
            <SheetHeader className="border-b px-4 pb-3 pt-1 text-left">
              <SheetTitle className="flex items-center gap-2">
                <UploadCloud className="h-5 w-5 text-blue-600" />
                Upload New Event Data
              </SheetTitle>
              <SheetDescription>
                Add a new historical flood event by providing the impact data
                and uploading the validated GeoTIFF outputs.
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-4">{formContent}</div>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
          <DialogContent className="w-[95vw] !max-w-6xl sm:!max-w-6xl max-h-[90vh] p-6 overflow-y-auto">
            <DialogHeader className="mb-6">
              <DialogTitle className="flex items-center gap-2">
                <UploadCloud className="h-5 w-5 text-blue-600" />
                Upload New Event Data
              </DialogTitle>
              <DialogDescription>
                Add a new historical flood event by providing the impact data
                and uploading the validated GeoTIFF outputs.
              </DialogDescription>
            </DialogHeader>
            {formContent}
          </DialogContent>
        </Dialog>
      )}

      <style>{`@keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } } .animate-fade-in-up { animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }`}</style>
    </SidebarProvider>
  );
}
