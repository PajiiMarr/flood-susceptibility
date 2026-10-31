import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Map,
  LayoutDashboard,
  Database,
  Cpu,
  Settings,
  LogOut,
  Activity,
  Layers,
  ArrowRight,
  TrendingUp,
  MapPin,
  CalendarDays,
  CloudRain,
  Wind,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

const EVENTS_DATA = [
  {
    id: "paeng",
    name: "Tropical Storm Paeng",
    date: "October 2022",
    type: "Tropical Storm",
    status: "Archived",
    description:
      "Heavy rainfall and massive flooding caused by Tropical Storm Paeng across the Zamboanga Peninsula.",
    stats: {
      rainfall: "180 mm",
      windSpeed: "75 km/h",
      affectedBarangays: 42,
    },
  },
  {
    id: "shearline",
    name: "Shearline Event",
    date: "January 2023",
    type: "Weather System",
    status: "Archived",
    description:
      "Prolonged rainfall due to a shearline affecting the southern Philippines, triggering localized flooding.",
    stats: {
      rainfall: "120 mm",
      windSpeed: "N/A",
      affectedBarangays: 18,
    },
  },
  {
    id: "habagat",
    name: "Southwest Monsoon (Habagat)",
    date: "July 2024",
    type: "Monsoon",
    status: "Archived",
    description:
      "Enhanced Southwest Monsoon bringing continuous rains and subsequent flooding in low-lying areas.",
    stats: {
      rainfall: "150 mm",
      windSpeed: "45 km/h",
      affectedBarangays: 35,
    },
  },
];

export default function FloodEventsPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-slate-50 font-sans overflow-hidden">
        {/* SIDEBAR */}
        <Sidebar className="bg-slate-900 border-r border-slate-800 [&_[data-sidebar=sidebar]]:bg-slate-900 [&_[data-sidebar=sidebar]]:text-slate-300">
          <SidebarHeader className="h-20 border-b border-slate-800 p-0">
            <div className="flex h-full w-full items-center px-4">
              <Map className="h-8 w-8 text-blue-500 mr-3 shrink-0" />
              <span className="text-xl font-extrabold tracking-tight uppercase text-white">
                ABENIDA
              </span>
            </div>
          </SidebarHeader>

          <SidebarContent className="mt-4">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="gap-2 px-2">
                  {/* Dashboard Overview */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => navigate("/dashboard")}
                      className="h-11 px-4 text-sm font-medium transition-all duration-200 hover:bg-slate-800 hover:text-white"
                    >
                      <LayoutDashboard size={18} />
                      <span>Dashboard Overview</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  {/* Flood Events (Active) */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={true}
                      onClick={() => navigate("/events")}
                      className="h-11 px-4 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 hover:text-white transition-all duration-200"
                    >
                      <CalendarDays size={18} />
                      <span>Flood Events</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  {/* Remaining Nav Items */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => navigate("/map")}
                      className="h-11 px-4 text-sm font-medium hover:bg-slate-800 hover:text-white"
                    >
                      <MapPin size={18} />
                      <span>Interactive Map</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton className="h-11 px-4 text-sm font-medium hover:bg-slate-800 hover:text-white">
                      <Database size={18} />
                      <span>Datasets</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton className="h-11 px-4 text-sm font-medium hover:bg-slate-800 hover:text-white">
                      <Layers size={18} />
                      <span>Model Registry</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton className="h-11 px-4 text-sm font-medium hover:bg-slate-800 hover:text-white">
                      <Settings size={18} />
                      <span>Settings</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="p-4 border-t border-slate-800">
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

        {/* MAIN CONTENT */}
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
            <Button
              onClick={() => navigate("/map")}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-2 group"
            >
              Open Map{" "}
              <ArrowRight
                size={16}
                className="group-hover:translate-x-1 transition-transform"
              />
            </Button>
          </header>

          <div className="p-8 space-y-8 max-w-7xl mx-auto">
            <div className="mb-6">
              <p className="text-muted-foreground">
                Historical flood occurrences and their environmental impacts in
                Zamboanga City.
              </p>
            </div>

            {/* Events Grid */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 animate-fade-in-up">
              {isLoading
                ? [1, 2, 3].map((i) => (
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
                : EVENTS_DATA.map((event) => (
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
                            {event.type}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="text-green-700 border-green-200 bg-green-50"
                          >
                            {event.status}
                          </Badge>
                        </div>
                        <CardTitle className="text-xl mt-2 group-hover:text-blue-600 transition-colors">
                          {event.name}
                        </CardTitle>
                        <CardDescription className="flex items-center gap-1.5 mt-1">
                          <CalendarDays className="h-4 w-4" />
                          {event.date}
                        </CardDescription>
                      </CardHeader>

                      <CardContent className="flex-1">
                        <p className="text-sm text-slate-600 mb-6 line-clamp-3">
                          {event.description}
                        </p>

                        {/* Metrics */}
                        <div className="grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
                          <div className="flex flex-col items-center text-center">
                            <CloudRain className="h-5 w-5 text-blue-500 mb-1" />
                            <span className="text-xs text-slate-500">
                              Rainfall
                            </span>
                            <span className="text-sm font-semibold">
                              {event.stats.rainfall}
                            </span>
                          </div>
                          <div className="flex flex-col items-center text-center border-x border-slate-200">
                            <Wind className="h-5 w-5 text-teal-500 mb-1" />
                            <span className="text-xs text-slate-500">Wind</span>
                            <span className="text-sm font-semibold">
                              {event.stats.windSpeed}
                            </span>
                          </div>
                          <div className="flex flex-col items-center text-center">
                            <AlertTriangle className="h-5 w-5 text-amber-500 mb-1" />
                            <span className="text-xs text-slate-500">
                              Affected
                            </span>
                            <span className="text-sm font-semibold">
                              {event.stats.affectedBarangays} Brgys
                            </span>
                          </div>
                        </div>
                      </CardContent>

                      <CardFooter className="pt-2 pb-4">
                        <Button
                          className="w-full bg-slate-900 hover:bg-slate-800 text-white group-hover:bg-blue-600 transition-colors"
                          onClick={() => {
                            // Navigate to a specific event detail page
                            // navigate(`/events/${event.id}`)
                            console.log(`Viewing details for ${event.id}`);
                          }}
                        >
                          View Event Details
                          <ChevronRight className="ml-2 h-4 w-4" />
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
            </div>
          </div>
        </main>
      </div>

      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in-up { animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </SidebarProvider>
  );
}
