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

    const labels = chartPoints.map(p => p.label);
    const dataValues = chartPoints.map(p => p.value);

    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, "rgba(88, 101, 242, 0.25)");
    gradient.addColorStop(1, "rgba(88, 101, 242, 0.0)");

    chartInstanceRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Pipeline Value (INR)",
            data: dataValues,
            borderColor: "#5865f2",
            borderWidth: 2.5,
            backgroundColor: gradient,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: "#ffffff",
            pointBorderColor: "#5865f2",
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: "#2b2d31",
            titleColor: "#f2f3f5",
            bodyColor: "#dbdee1",
            borderColor: "#3f4248",
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || "";
                if (label) {
                  label += ": ";
                }
                if (context.parsed.y !== null) {
                  label += new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(context.parsed.y);
                }
                return label;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              color: "#949ba4",
              font: {
                size: 10,
                weight: "bold"
              }
            }
          },
          y: {
            grid: {
              color: "rgba(148, 155, 164, 0.08)",
            },
            ticks: {
              color: "#949ba4",
              font: {
                size: 9,
                weight: "bold"
              },
              callback: function(value) {
                if (Number(value) >= 1000) {
                  return "₹" + Math.round(Number(value) / 1000) + "k";
                }
                return "₹" + value;
              }
            }
          }
        }
      }
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
      }
    };
  }, [chartPoints]);

  return <canvas ref={canvasRef} />;
}
