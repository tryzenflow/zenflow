import { useEffect, useState } from "react";
import { AnalyticsNavbar } from "../components/analytics/analytics-navbar";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tooltip, ResponsiveContainer, Cell, Pie, PieChart } from "recharts";
import { getData } from "../api";
import { format } from "date-fns";
import {
  Activity,
  Calendar,
  Clock,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react"; // Icons for visual flair
import { useUserStore } from "@/hooks/use-user-store";
import { useNavigate } from "react-router-dom";

interface DashboardSummary {
  totalScheduledTime: number;
  utilization: number;
  tasksScheduled: number;
  tasksPending: number;
  energyAlignment: {
    highFocus: number;
    mediumFocus: number;
    lowFocus: number;
  };
  dailyLoad: {
    maxLoad: number;
    scheduled: number;
  };
  categoryDistribution: { id: string; name: string; minutes: number }[];
  contextSwitches: {
    count: number;
    avgGap: number;
  };
}

export default function AnalyticsPage() {
  const [selectedStartDate, setSelectedStartDate] = useState<Date>(new Date());
  const [selectedEndDate, setSelectedEndDate] = useState<Date>(new Date());
  const [dashboardData, setDashboardData] = useState<DashboardSummary | null>(
    null,
  );
  const user = useUserStore().user;
  const userFetching = useUserStore().loading;
  const navigate = useNavigate();
  useEffect(() => {
    if (userFetching === null || userFetching) return;
    if (!user) {
      navigate("/login?callback=/");
      return;
    }
    if (user._count.categories === 0 || user._count.constraints === 0) {
      navigate("/prefs?callback=/");
      return;
    }
  }, [user, userFetching, navigate]);
  useEffect(() => {
    const formattedStartDate = format(selectedStartDate, "yyyy-MM-dd");
    const formattedEndDate = format(selectedEndDate, "yyyy-MM-dd");
    getData<DashboardSummary>(
      `/analytics/summary?start=${formattedStartDate}&end=${formattedEndDate}`,
    ).then((data) => setDashboardData(data));
  }, [selectedStartDate, selectedEndDate]);

  return (
    <>
      <AnalyticsNavbar
        selectedDateStart={selectedStartDate}
        selectedDateEnd={selectedEndDate}
        setSelectedDateEnd={setSelectedEndDate}
        setSelectedDateStart={setSelectedStartDate}
      />
      <main className="px-4 sm:px-6 lg:px-8 py-8">
        {dashboardData ? (
          <Dashboard data={dashboardData} />
        ) : (
          <p>Loading analytics data...</p>
        )}
      </main>
    </>
  );
}

interface Props {
  data: DashboardSummary;
}

const COLORS = {
  primary: "#6366f1",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  purple: "#8b5cf6",
  cyan: "#06b6d4",
};

const formatMinutes = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${Math.floor(mins)}m`;
  if (mins === 0) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours)}h ${Math.floor(mins)}m`;
};

const StatCard: React.FC<{
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: string;
  color?: string;
}> = ({ title, value, subtitle, icon, trend, color = "text-indigo-500" }) => (
  <Card className="relative overflow-hidden border-0 shadow-sm hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-white to-gray-50">
    <div
      className={`absolute top-0 right-0 w-32 h-32 ${color} opacity-5 rounded-full -mr-16 -mt-16`}
    ></div>
    <CardContent>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-3">{title}</p>
          <div className="text-3xl font-bold text-gray-900 mb-1">{value}</div>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          {trend && (
            <p className="text-xs text-green-600 font-medium mt-2 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {trend}
            </p>
          )}
        </div>
        <div className={`${color} bg-opacity-10 p-3 rounded-lg`}>{icon}</div>
      </div>
    </CardContent>
  </Card>
);

const EnergyAlignmentChart: React.FC<{
  data: DashboardSummary["energyAlignment"];
}> = ({ data }) => {
  const chartData = [
    { name: "Low Focus", value: data.lowFocus, color: COLORS.success },
    { name: "Medium Focus", value: data.mediumFocus, color: COLORS.warning },
    { name: "High Focus", value: data.highFocus, color: COLORS.danger },
  ].filter((item) => item.value > 0);

  const totalMinutes = data.highFocus + data.mediumFocus + data.lowFocus;

  if (totalMinutes === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400">
        <p>No focus data scheduled</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => `${value} min`} />
        </PieChart>
      </ResponsiveContainer>

      <div className="space-y-3">
        {chartData.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: item.color }}
              ></div>
              <span className="text-sm text-gray-700">{item.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">
                {formatMinutes(item.value)}
              </span>
              <span className="text-xs text-gray-500">
                ({Math.round((item.value / totalMinutes) * 100)}%)
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const Dashboard: React.FC<Props> = ({ data }) => {
  const utilizationValue = Math.round(data.utilization * 100);
  const dailyLoadProgress =
    (data.dailyLoad.scheduled / data.dailyLoad.maxLoad) * 100;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">
          Productivity Dashboard
        </h1>
        <p className="text-gray-600">Your daily workflow at a glance</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Scheduled"
          value={formatMinutes(data.totalScheduledTime)}
          subtitle="Today's dedicated time"
          icon={<Clock className="h-6 w-6 text-indigo-500" />}
          color="text-indigo-500"
        />

        <StatCard
          title="Utilization Rate"
          value={`${utilizationValue}%`}
          subtitle={""}
          icon={<Target className="h-6 w-6 text-purple-500" />}
          trend={utilizationValue > 70 ? "Excellent pace" : "Room to grow"}
          color="text-purple-500"
        />

        <StatCard
          title="Tasks Overview"
          value={data.tasksScheduled}
          subtitle={`${data.tasksPending} pending tasks`}
          icon={<Activity className="h-6 w-6 text-cyan-500" />}
          color="text-cyan-500"
        />

        <StatCard
          title="Context Switches"
          value={data.contextSwitches.count}
          subtitle={`Avg gap: ${formatMinutes(data.contextSwitches.avgGap)}`}
          icon={<Zap className="h-6 w-6 text-amber-500" />}
          color="text-amber-500"
        />
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Section - Charts */}
        <div className="lg:col-span-2 space-y-6">
          {/* Daily Load */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Calendar className="h-5 w-5 text-indigo-500" />
                Daily Load Capacity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">
                    {formatMinutes(data.dailyLoad.scheduled)} /{" "}
                    {formatMinutes(data.dailyLoad.maxLoad)}
                  </span>
                  <span
                    className={`text-sm font-semibold px-3 py-1 rounded-full ${
                      dailyLoadProgress > 90
                        ? "bg-red-100 text-red-700"
                        : dailyLoadProgress > 70
                          ? "bg-amber-100 text-amber-700"
                          : "bg-green-100 text-green-700"
                    }`}
                  >
                    {dailyLoadProgress.toFixed(0)}%
                  </span>
                </div>
                <Progress
                  value={Math.min(dailyLoadProgress, 100)}
                  className="h-3"
                />
                <p className="text-xs text-gray-500">
                  {dailyLoadProgress >= 100
                    ? "At full capacity - consider rescheduling"
                    : dailyLoadProgress > 90
                      ? "Near capacity - consider rescheduling"
                      : dailyLoadProgress > 70
                        ? "Well-balanced schedule"
                        : "Space for more tasks"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Category Distribution */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl">Category Distribution</CardTitle>
              <p className="text-sm text-gray-500">
                Time allocation across categories
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.categoryDistribution.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{
                          backgroundColor:
                            Object.values(COLORS)[
                              idx % Object.values(COLORS).length
                            ],
                        }}
                      ></div>
                      <span className="text-sm font-medium text-gray-700">
                        {item.name ?? item.id}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">
                      {formatMinutes(item.minutes)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Section */}

        {/* Energy Alignment */}
        <Card className="border-0 h-fit shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl">Energy Alignment</CardTitle>
            <p className="text-sm text-gray-500">
              Optimal focus zone distribution
            </p>
          </CardHeader>
          <CardContent>
            <EnergyAlignmentChart data={data.energyAlignment} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
