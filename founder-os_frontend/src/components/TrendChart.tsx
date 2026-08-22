import React, { useEffect, useRef } from "react";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

interface ChartPoint {
  label: string;
  value: number;
  count: number;
}

interface TrendChartProps {
  chartPoints: ChartPoint[];
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function TrendChart({ chartPoints }: TrendChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const brand = cssVar("--color-brand-indigo", "#5b5ef0");
    const tick = cssVar("--text-tertiary", "#8b92a1");
    const grid = cssVar("--border-card", "#e7e9ee");
    const tooltipBg = cssVar("--bg-card", "#ffffff");
    const tooltipTitle = cssVar("--text-primary", "#13151c");
    const tooltipBody = cssVar("--text-secondary", "#565d6b");
    const tooltipBorder = cssVar("--border-card", "#e7e9ee");

    const labels = chartPoints.map((p) => p.label);
    const dataValues = chartPoints.map((p) => p.value);

    const gradient = ctx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, brand + "40");
    gradient.addColorStop(1, brand + "00");

    chartInstanceRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Pipeline Value (INR)",
            data: dataValues,
            borderColor: brand,
            borderWidth: 2.5,
            backgroundColor: gradient,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: tooltipBg,
            pointBorderColor: brand,
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: tooltipTitle,
            bodyColor: tooltipBody,
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function (context) {
                let label = context.dataset.label || "";
                if (label) label += ": ";
                if (context.parsed.y !== null) {
                  label += new Intl.NumberFormat("en-IN", {
                    style: "currency",
                    currency: "INR",
                    maximumFractionDigits: 0,
                  }).format(context.parsed.y);
                }
                return label;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: tick, font: { size: 10, weight: "bold" as const } },
          },
          y: {
            grid: { color: grid + "55" },
            ticks: {
              color: tick,
              font: { size: 9, weight: "bold" as const },
              callback: function (value) {
                if (Number(value) >= 1000) return "₹" + Math.round(Number(value) / 1000) + "k";
                return "₹" + value;
              },
            },
          },
        },
      },
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
      }
    };
  }, [chartPoints]);

  return <canvas ref={canvasRef} />;
}
