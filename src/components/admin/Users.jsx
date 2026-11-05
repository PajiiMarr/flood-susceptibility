import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Map,
  LayoutDashboard,
  CalendarDays,
  Users,
  LogOut,
  Search,
  Mail,
  ShieldCheck,
  ShieldAlert,
  Clock,
  ArrowRight,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
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

export default function UsersPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const fetchUsers = async () => {
    setIsLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (data) setUsers(data);
    } catch (err) {
      console.error("Failed to fetch users:", err);
      if (
        err.message.includes("schema cache") ||
        err.message.includes("not find the table")
      ) {
        setErrorMsg(
          "Database view missing. Please run the 'CREATE VIEW public.users' SQL script in your Supabase dashboard.",
        );
      } else {
        setErrorMsg(err.message || "Failed to load users.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const filteredUsers = users.filter((user) =>
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-slate-50 font-sans overflow-hidden">
        {/* SIDEBAR */}
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
                      onClick={() => navigate("/events")}
                      className="h-11 px-4 text-sm font-medium text-slate-300 transition-all duration-200 hover:bg-slate-800 hover:text-white"
                    >
                      <CalendarDays size={18} />
                      <span>Flood Events</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={true}
                      onClick={() => navigate("/users")}
                      className="h-11 px-4 text-sm font-medium bg-white text-slate-900 shadow-sm hover:bg-slate-100 hover:text-slate-900 transition-all duration-200"
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

        {/* MAIN CONTENT */}
        <main className="flex-1 overflow-y-auto relative">
          <header className="h-20 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-10">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="text-slate-500 hover:text-slate-900" />
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  User Management
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

          <div className="p-4 sm:p-8 space-y-8 max-w-7xl mx-auto">
            <Card className="border-slate-200 shadow-sm animate-fade-in-up">
              <CardHeader className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">System Users</CardTitle>
                  <CardDescription>
                    A list of all registered users in the system.
                  </CardDescription>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    type="text"
                    placeholder="Search by email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-slate-50 border-slate-200 focus-visible:ring-blue-500"
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {errorMsg ? (
                  <div className="p-8 text-center text-red-500 bg-red-50">
                    <ShieldAlert className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p className="font-medium">Error loading users</p>
                    <p className="text-sm mt-1 max-w-md mx-auto">{errorMsg}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs text-slate-500 bg-slate-50 uppercase">
                        <tr>
                          <th className="px-6 py-4 font-medium">User Email</th>
                          <th className="px-6 py-4 font-medium">Status</th>
                          <th className="px-6 py-4 font-medium">Joined At</th>
                          <th className="px-6 py-4 font-medium">
                            Last Sign In
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {isLoading ? (
                          [1, 2, 3, 4].map((row) => (
                            <tr key={row}>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <Skeleton className="h-8 w-8 rounded-full" />
                                  <Skeleton className="h-4 w-40" />
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <Skeleton className="h-6 w-20 rounded-full" />
                              </td>
                              <td className="px-6 py-4">
                                <Skeleton className="h-4 w-28" />
                              </td>
                              <td className="px-6 py-4">
                                <Skeleton className="h-4 w-28" />
                              </td>
                            </tr>
                          ))
                        ) : filteredUsers.length === 0 ? (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-6 py-12 text-center text-slate-500"
                            >
                              <Users className="h-10 w-10 mx-auto mb-3 text-slate-300" />
                              No users found matching your search.
                            </td>
                          </tr>
                        ) : (
                          filteredUsers.map((user) => {
                            const isBanned =
                              user.banned_until &&
                              new Date(user.banned_until) > new Date();
                            const isConfirmed = !!user.confirmed_at;

                            return (
                              <tr
                                key={user.id}
                                className="hover:bg-slate-50/80 transition-colors group"
                              >
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold">
                                      {user.email?.charAt(0).toUpperCase() ||
                                        "U"}
                                    </div>
                                    <div>
                                      <p className="font-medium text-slate-900">
                                        {user.email}
                                      </p>
                                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                                        {user.id.slice(0, 8)}...
                                      </p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  {isBanned ? (
                                    <Badge
                                      variant="outline"
                                      className="bg-red-50 text-red-700 border-red-200 gap-1"
                                    >
                                      <ShieldAlert size={12} /> Banned
                                    </Badge>
                                  ) : isConfirmed ? (
                                    <Badge
                                      variant="outline"
                                      className="bg-green-50 text-green-700 border-green-200 gap-1"
                                    >
                                      <ShieldCheck size={12} /> Active
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="bg-amber-50 text-amber-700 border-amber-200 gap-1"
                                    >
                                      <Clock size={12} /> Unconfirmed
                                    </Badge>
                                  )}
                                </td>
                                <td className="px-6 py-4 text-slate-600">
                                  {formatDate(user.created_at)}
                                </td>
                                <td className="px-6 py-4 text-slate-600">
                                  {user.last_sign_in_at ? (
                                    <div className="flex items-center gap-1.5">
                                      <Mail
                                        size={14}
                                        className="text-slate-400"
                                      />
                                      {formatDate(user.last_sign_in_at)}
                                    </div>
                                  ) : (
                                    <span className="text-slate-400 italic">
                                      Never
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
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
