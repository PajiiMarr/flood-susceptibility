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
  Users,
  ArrowRight,
  TrendingUp,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export default function Dashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overview");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  const handleLogout = () => navigate("/login");

  const navItems = [
    {
      id: "overview",
      label: "Dashboard Overview",
      icon: LayoutDashboard,
      onClick: () => setActiveTab("overview"),
    },
    {
      id: "map",
      label: "Interactive Map",
      icon: MapPin,
      onClick: () => navigate("/map"),
    },
    { id: "datasets", label: "Datasets", icon: Database },
    { id: "models", label: "Model Registry", icon: Layers },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  const stats = [
    {
      title: "Total Models",
      value: "16",
      subtext: "4 Categories × 4 Models",
      icon: Cpu,
      color: "text-blue-600",
      bg: "bg-blue-100",
    },
    {
      title: "Dataset Size",
      value: "20,000",
      subtext: "Flood & Non-flood samples",
      icon: Database,
      color: "text-green-600",
      bg: "bg-green-100",
    },
    {
      title: "Best AUC",
      value: "0.9010",
      subtext: "GWR (Overall Category)",
      icon: TrendingUp,
      color: "text-amber-600",
      bg: "bg-amber-100",
    },
    {
      title: "Active Events",
      value: "3",
      subtext: "Paeng, Shearline, Habagat",
      icon: Activity,
      color: "text-purple-600",
      bg: "bg-purple-100",
    },
  ];

  const categories = [
    { name: "Overall", models: 4, best: "Stacking Ensemble", auc: "0.9017" },
    { name: "Oct 2022 (Paeng)", models: 4, best: "GWR", auc: "0.9507" },
    { name: "Jan 2023 (Shearline)", models: 4, best: "MGWR", auc: "0.8959" },
    { name: "Jul 2024 (Habagat)", models: 4, best: "SVM", auc: "0.8223" },
  ];

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-slate-50 font-sans overflow-hidden">
        {/* SIDEBAR */}
        <Sidebar className="bg-slate-900 border-r border-slate-800 [&_[data-sidebar=sidebar]]:bg-slate-900 [&_[data-sidebar=sidebar]]:text-slate-300">
          {/* Fixed Header Alignment */}
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
                  {navItems.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={activeTab === item.id}
                        onClick={item.onClick}
                        className={`h-11 px-4 text-sm font-medium transition-all duration-200 ${
                          activeTab === item.id
                            ? "bg-blue-600 text-white hover:bg-blue-700 hover:text-white"
                            : "hover:bg-slate-800 hover:text-white"
                        }`}
                      >
                        <item.icon size={18} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
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
          {/* Reduced Header Text Size */}
          <header className="h-20 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-10">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="text-slate-500 hover:text-slate-900" />
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  Dashboard Overview
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
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {isLoading
                ? [1, 2, 3, 4].map((i) => (
                    <Card key={i} className="border-slate-200 shadow-sm">
                      <CardContent className="p-6 flex items-center justify-between">
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-8 w-16" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                        <Skeleton className="h-14 w-14 rounded-full" />
                      </CardContent>
                    </Card>
                  ))
                : stats.map((stat, idx) => (
                    <Card
                      key={idx}
                      className="group border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 animate-fade-in-up"
                      style={{ animationDelay: `${idx * 100}ms`, opacity: 0 }}
                    >
                      <CardContent className="p-6 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-500 mb-1">
                            {stat.title}
                          </p>
                          <h3 className="text-3xl font-bold text-slate-900">
                            {stat.value}
                          </h3>
                          <p className="text-xs text-slate-400 mt-1">
                            {stat.subtext}
                          </p>
                        </div>
                        <div
                          className={`p-4 rounded-full ${stat.bg} transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}
                        >
                          <stat.icon size={24} className={stat.color} />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
            </div>

            {/* Table & Side Panels */}
            <div
              className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in-up delay-200"
              style={{ opacity: 0 }}
            >
              <Card className="lg:col-span-2 border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="border-b border-slate-100 pb-4">
                  <CardTitle className="text-lg">Model Categories</CardTitle>
                  <CardDescription>
                    Performance of the 16-model suite per flood event
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 bg-slate-50 uppercase">
                      <tr>
                        <th className="px-6 py-4 font-medium">Category</th>
                        <th className="px-6 py-4 font-medium">Models</th>
                        <th className="px-6 py-4 font-medium">
                          Best Algorithm
                        </th>
                        <th className="px-6 py-4 font-medium">AUC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {isLoading
                        ? [1, 2, 3, 4].map((row) => (
                            <tr key={row}>
                              <td className="px-6 py-4">
                                <Skeleton className="h-4 w-32" />
                              </td>
                              <td className="px-6 py-4">
                                <Skeleton className="h-4 w-8" />
                              </td>
                              <td className="px-6 py-4">
                                <Skeleton className="h-6 w-28 rounded-full" />
                              </td>
                              <td className="px-6 py-4">
                                <Skeleton className="h-4 w-16" />
                              </td>
                            </tr>
                          ))
                        : categories.map((cat, idx) => (
                            <tr
                              key={idx}
                              className="hover:bg-slate-50/80 transition-colors group"
                            >
                              <td className="px-6 py-4 font-medium text-slate-900 group-hover:text-blue-600 transition-colors">
                                {cat.name}
                              </td>
                              <td className="px-6 py-4 text-slate-500">
                                {cat.models}
                              </td>
                              <td className="px-6 py-4">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 transition-transform group-hover:scale-105">
                                  {cat.best}
                                </span>
                              </td>
                              <td className="px-6 py-4 font-bold text-green-600">
                                {cat.auc}
                              </td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card className="border-slate-200 shadow-sm bg-slate-900 text-white">
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      System Status
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      API and model server status
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {isLoading ? (
                      [1, 2, 3].map((row) => (
                        <div key={row} className="flex justify-between">
                          <Skeleton className="h-4 w-24 bg-slate-700" />
                          <Skeleton className="h-4 w-16 bg-slate-700" />
                        </div>
                      ))
                    ) : (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-300">
                            FastAPI Backend
                          </span>
                          <span className="flex items-center gap-2 text-green-400">
                            <span className="animate-ping absolute h-2 w-2 rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative h-2 w-2 rounded-full bg-green-500"></span>{" "}
                            Online
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-300">Supabase DB</span>
                          <span className="flex items-center gap-2 text-green-400">
                            <span className="animate-ping absolute h-2 w-2 rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative h-2 w-2 rounded-full bg-green-500"></span>{" "}
                            Connected
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-300">
                            R Engine (MARS)
                          </span>
                          <span className="flex items-center gap-2 text-amber-400">
                            <span className="relative h-2 w-2 rounded-full bg-amber-500"></span>{" "}
                            Idle
                          </span>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-lg">Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {isLoading ? (
                      [1, 2, 3].map((btn) => (
                        <Skeleton
                          key={btn}
                          className="h-10 w-full rounded-md"
                        />
                      ))
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          className="w-full justify-start group"
                        >
                          <Cpu
                            size={16}
                            className="mr-2 group-hover:rotate-12 transition-transform"
                          />{" "}
                          Retrain Models
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full justify-start group"
                        >
                          <Database
                            size={16}
                            className="mr-2 group-hover:-translate-y-1 transition-transform"
                          />{" "}
                          Export Dataset
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full justify-start group"
                        >
                          <Users
                            size={16}
                            className="mr-2 group-hover:scale-110 transition-transform"
                          />{" "}
                          Manage Users
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </main>
      </div>

      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in-up { animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .delay-200 { animation-delay: 200ms; }
      `}</style>
    </SidebarProvider>
  );
}
