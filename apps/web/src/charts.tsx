import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type GradeRow = { name: string; value: unknown };

const tooltipContentStyle = {
  background: "var(--chart-tooltip)",
  border: "1px solid var(--chart-grid)",
  borderRadius: 12,
  color: "var(--ink)",
};

export function GradeBarChart({ data }: { data: GradeRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 14, right: 12, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--chart-text)" }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--chart-text)" }} />
        <Tooltip contentStyle={tooltipContentStyle} labelStyle={{ color: "var(--ink)" }} itemStyle={{ color: "var(--ink-soft)" }} />
        <Bar dataKey="value" name="Работ" fill="var(--chart-1)" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GradePieChart({ data }: { data: GradeRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={4}>
          <Cell fill="var(--chart-1)" />
          <Cell fill="var(--chart-2)" />
          <Cell fill="var(--chart-3)" />
          <Cell fill="var(--chart-4)" />
        </Pie>
        <Tooltip contentStyle={tooltipContentStyle} labelStyle={{ color: "var(--ink)" }} itemStyle={{ color: "var(--ink-soft)" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
