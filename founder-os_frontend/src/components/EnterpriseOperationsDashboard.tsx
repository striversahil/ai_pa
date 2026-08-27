"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLiveRefresh } from "@/hooks/useLiveEvents";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

type SchemaData = any;

const formatINR = (val: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(val);

export default function EnterpriseOperationsDashboard() {
    const [data, setData] = useState<SchemaData | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [riskFilter, setRiskFilter] = useState("all");
    const [isDark, setIsDark] = useState(false);
    const [jsonInput, setJsonInput] = useState("");
    const [jsonError, setJsonError] = useState<string | null>(null);
    const [showJsonEditor, setShowJsonEditor] = useState(false);
    const [isCustomData, setIsCustomData] = useState(false);
    const customDataRef = useRef(false);

    const chartRefs = useRef<Record<string, Chart | null>>({});

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/automations/enterprise-operations-analytics/data");
            if (!res.ok) {
                setError(`Dashboard not available (HTTP ${res.status}).`);
                setData(null);
                return;
            }
            setData(await res.json());
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            if (customDataRef.current) return;
            setLoading(true);
            setError(null);
            try {
                const res = await fetch("/api/automations/enterprise-operations-analytics/data");
                if (!res.ok) {
                    if (!cancelled) {
                        setError(`Dashboard not available (HTTP ${res.status}).`);
                        setData(null);
                    }
                    return;
                }
                if (!cancelled) setData(await res.json());
            } catch (e: unknown) {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        const timer = setInterval(load, 120_000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, []);

    useLiveRefresh(
        (event) => event.type === "automation" && event.slug === "enterprise-operations-analytics" && !customDataRef.current,
        fetchData,
    );

    // Theme detection
    useEffect(() => {
        const checkTheme = () => setIsDark(document.documentElement.classList.contains("dark"));
        checkTheme();
        const observer = new MutationObserver(checkTheme);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);

    // Paste-JSON data editor: lets the user fill the dashboard with their own
    // JSON instead of the API payload. Disables the 2-min auto-refresh while active.
    const applyCustomJson = () => {
        setJsonError(null);
        let parsed: any;
        try {
            parsed = JSON.parse(jsonInput);
        } catch (e: unknown) {
            setJsonError(e instanceof Error ? `Invalid JSON: ${e.message}` : "Invalid JSON");
            return;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            setJsonError('JSON must be a single object, e.g. { "summary": {...}, "dashboard": {...} }');
            return;
        }
        if (!parsed.summary) {
            setJsonError('JSON must contain a "summary" object.');
            return;
        }
        customDataRef.current = true;
        setIsCustomData(true);
        setData(parsed);
        setShowJsonEditor(false);
        setJsonInput("");
    };

    const resetToApiData = () => {
        customDataRef.current = false;
        setIsCustomData(false);
        fetchData();
    };

    // Render charts when data is loaded
    useEffect(() => {
        if (!data) return;
        renderCharts();
        return () => {
            Object.values(chartRefs.current).forEach((c) => c?.destroy());
            chartRefs.current = {};
        };
    }, [data, isDark]);

    const renderCharts = () => {
        if (!data) return;
        const textColor = isDark ? "#cbd5e1" : "#475569";
        const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";

        Object.values(chartRefs.current).forEach((c) => c?.destroy());
        chartRefs.current = {};

        const makeChart = (id: string, config: any) => {
            const el = document.getElementById(id) as HTMLCanvasElement | null;
            if (!el) return;
            chartRefs.current[id] = new Chart(el.getContext("2d")!, config);
        };

        // 2.1 Stage Distribution
        makeChart("chartStage", {
            type: "doughnut",
            data: {
                labels: data.dashboard.stage_distribution.map((d: any) => d.stage),
                datasets: [{
                    data: data.dashboard.stage_distribution.map((d: any) => d.count),
                    backgroundColor: ["#f43f5e", "#fbbf24", "#3b82f6", "#10b981", "#8b5cf6"],
                    borderWidth: 0,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom", labels: { color: textColor, font: { size: 10 } } } },
            },
        });

        // 2.2 Stock Distribution
        makeChart("chartStock", {
            type: "pie",
            data: {
                labels: data.dashboard.stock_distribution.map((d: any) => d.status),
                datasets: [{
                    data: data.dashboard.stock_distribution.map((d: any) => d.count),
                    backgroundColor: ["#10b981", "#f59e0b", "#ef4444"],
                    borderWidth: 0,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom", labels: { color: textColor, font: { size: 10 } } } },
            },
        });

        // 2.3 Payment Distribution
        makeChart("chartPayment", {
            type: "doughnut",
            data: {
                labels: data.dashboard.payment_distribution.map((d: any) => d.status),
                datasets: [{
                    data: data.dashboard.payment_distribution.map((d: any) => d.count),
                    backgroundColor: ["#10b981", "#3b82f6", "#f43f5e"],
                    borderWidth: 0,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom", labels: { color: textColor, font: { size: 10 } } } },
            },
        });

        // 2.4 Dispatch Distribution
        makeChart("chartDispatch", {
            type: "bar",
            data: {
                labels: data.dashboard.dispatch_distribution.map((d: any) => d.status),
                datasets: [{
                    label: "Orders",
                    data: data.dashboard.dispatch_distribution.map((d: any) => d.count),
                    backgroundColor: "#6366f1",
                    borderRadius: 6,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: textColor, font: { size: 9 } }, grid: { display: false } },
                    y: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } },
                },
            },
        });

        // 2.5 Customer Type Distribution
        makeChart("chartCustomerType", {
            type: "bar",
            data: {
                labels: data.dashboard.customer_type_distribution.map((d: any) => d.type),
                datasets: [{
                    label: "Order Value (₹)",
                    data: data.dashboard.customer_type_distribution.map((d: any) => d.value),
                    backgroundColor: "#06b6d4",
                    borderRadius: 6,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx: any) => ` Value: ${formatINR(ctx.raw)}` } },
                },
                scales: {
                    x: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
                    y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
                },
            },
        });
    };

    const scrollToSection = (id: string) => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: "smooth" });
    };

    const exportToCSV = () => {
        if (!data) return;
        let csv = "data:text/csv;charset=utf-8,";
        csv += "SO Number,Estimate Number,Customer,Order Value,Client Type,Stage,Priority,Risk Level,Stock Status,Payment Status,Dispatch Status,Delay Days,Next Action,Owner\n";
        data.orders.forEach((o: any) => {
            csv += `"${o.so_number}","${o.estimate_number}","${o.customer.replace(/"/g, '""')}",${o.order_value},"${o.client_type}","${o.current_stage}","${o.priority}","${o.risk_level}","${o.stock_status}","${o.payment_status}","${o.dispatch_status}",${o.delay_days},"${o.next_action.replace(/"/g, '""')}","${o.recommended_owner}"\n`;
        });
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csv));
        link.setAttribute("download", `Master_Orders_Report_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const filteredOrders = useCallback(() => {
        if (!data) return [];
        const query = searchQuery.toLowerCase().trim();
        const risk = riskFilter;
        return data.orders.filter((o: any) => {
            const matchQuery =
                o.so_number.toLowerCase().includes(query) ||
                o.estimate_number.toLowerCase().includes(query) ||
                o.customer.toLowerCase().includes(query) ||
                o.delay_reason.toLowerCase().includes(query);
            const matchRisk = risk === "all" || o.risk_level === risk;
            return matchQuery && matchRisk;
        });
    }, [data, searchQuery, riskFilter]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-zinc-400">
                <span className="animate-pulse">Loading Enterprise Operations Analytics...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-5 text-sm text-rose-300">{error}</div>
        );
    }

    if (!data) return null;

    const s = data.summary;
    const orders = filteredOrders();

    return (
        <div className="space-y-10 pb-12">
            {/* Sticky Navigation Topbar */}
            <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-40 shadow-sm transition-colors -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
                <div className="max-w-[1600px] mx-auto h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-tr from-blue-700 to-indigo-600 text-white rounded-xl shadow-md shadow-blue-500/20">
                            <i className="fa-solid fa-chart-line text-lg"></i>
                        </div>
                        <div>
                            <h1 className="text-base font-bold leading-tight text-slate-900 dark:text-white flex items-center gap-2">
                                Operations & Order Analytics Dashboard
                                <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                    Schema Compliant
                                </span>
                            </h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400">18-Point Complete Enterprise Supply Chain Analysis</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3">
                        <div className="relative hidden lg:block">
                            <select
                                onChange={(e) => scrollToSection(e.target.value)}
                                defaultValue="sec-summary"
                                className="pl-3 pr-8 py-1.5 text-xs font-semibold bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="sec-summary">1. Executive Summary</option>
                                <option value="sec-dashboard">2. Visual Distribution</option>
                                <option value="sec-orders">3. Master Orders Table</option>
                                <option value="sec-critical">4. Critical Orders</option>
                                <option value="sec-procurement">5. Procurement</option>
                                <option value="sec-dispatch">6. Dispatch Control</option>
                                <option value="sec-payments">7. Payments & Risk</option>
                                <option value="sec-customer-risk">8. Customer Risk Matrix</option>
                                <option value="sec-priority-calls">9. Priority Calls</option>
                                <option value="sec-exceptions">10. System Exceptions</option>
                                <option value="sec-departments">11. Department Analysis</option>
                                <option value="sec-root-causes">12. Root Cause Analysis</option>
                                <option value="sec-predictions">13. Operations Predictions</option>
                                <option value="sec-kpis">14. Core KPIs</option>
                                <option value="sec-actions">15. Department Actions</option>
                                <option value="sec-top20">16. Top 20 Priorities</option>
                                <option value="sec-crm">17. CRM Improvements</option>
                                <option value="sec-automation">18. Automation Triggers</option>
                            </select>
                        </div>

                        <button
                            onClick={exportToCSV}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-600 rounded-xl shadow-sm transition-all"
                        >
                            <i className="fa-solid fa-file-csv text-emerald-600 dark:text-emerald-400"></i>
                            <span className="hidden sm:inline">Export Orders CSV</span>
                        </button>
                    </div>
                </div>
            </header>

            {/* Custom JSON data editor */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 gap-3">
                    <button
                        onClick={() => setShowJsonEditor(!showJsonEditor)}
                        className="flex items-center gap-2 text-left cursor-pointer border-0 bg-transparent"
                    >
                        <i className={`fa-solid ${showJsonEditor ? "fa-chevron-up" : "fa-chevron-down"} text-slate-400`}></i>
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">📋 {isCustomData ? "Custom data loaded (auto-refresh paused)" : "Paste JSON data"}</span>
                    </button>
                    {isCustomData && (
                        <button
                            onClick={resetToApiData}
                            className="px-3 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg cursor-pointer shrink-0"
                        >
                            Reset to API data
                        </button>
                    )}
                </div>
                {showJsonEditor && (
                    <div className="px-4 pb-4 space-y-3">
                        <textarea
                            rows={10}
                            value={jsonInput}
                            onChange={(e) => setJsonInput(e.target.value)}
                            placeholder='Paste the dashboard JSON here, e.g. { "summary": { "total_orders": 120, "high_value_orders": 8 }, "dashboard": {...}, "orders": [...] }'
                            className="w-full font-mono text-xs p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                        />
                        {jsonError && (
                            <div className="text-xs text-rose-600 dark:text-rose-400 font-medium">{jsonError}</div>
                        )}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={applyCustomJson}
                                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg cursor-pointer border-0"
                            >
                                Load JSON
                            </button>
                            <button
                                onClick={() => { setShowJsonEditor(false); setJsonError(null); }}
                                className="px-4 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg cursor-pointer"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* SECTION 1: SUMMARY */}
            <section id="sec-summary" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs">1</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Executive Operations Summary</h2>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                        <i className="fa-solid fa-calendar-day text-blue-500"></i>
                        <span>Analysis Date: <strong className="text-slate-700 dark:text-slate-200">{s.analysis_date}</strong></span>
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">Total Orders</div>
                        <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">{s.total_orders}</div>
                        <div className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold mt-1">Active Pipeline</div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">Total Value</div>
                        <div className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">{formatINR(s.total_order_value)}</div>
                        <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1">Gross Booking</div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">Avg Order Value</div>
                        <div className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">{formatINR(s.average_order_value)}</div>
                        <div className="text-[11px] text-slate-400 font-normal mt-1">Per Order Ticket</div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">Max / Min Value</div>
                        <div className="mt-1 flex flex-col">
                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Max: {formatINR(s.highest_order_value)}</span>
                            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Min: {formatINR(s.lowest_order_value)}</span>
                        </div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">High Value Orders</div>
                        <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">{s.high_value_orders}</div>
                        <div className="text-[11px] text-slate-400 font-medium mt-1">Value &gt; ₹1,50,000</div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">Customer Mix</div>
                        <div className="mt-1 flex items-center justify-between text-xs">
                            <span className="text-blue-600 dark:text-blue-400 font-bold">New: <strong>{s.new_customers}</strong></span>
                            <span className="text-slate-600 dark:text-slate-300 font-bold">Repeat: <strong>{s.repeat_customers}</strong></span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">Relationship split</div>
                    </div>
                </div>

                {/* Health Score & Risk Gauge Banner */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-900/10 to-teal-900/10 border border-emerald-500/20 flex items-center justify-between">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Overall System Health Score</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Composite metric based on delays, stock readiness & collections</div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{s.overall_health_score}/100</div>
                            <div className="w-12 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500" style={{ width: `${s.overall_health_score}%` }}></div>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-gradient-to-r from-rose-900/10 to-amber-900/10 border border-rose-500/20 flex items-center justify-between">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">Management Operational Risk Score</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Risk index derived from overdue dispatches & uncollected balances</div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="text-3xl font-black text-rose-600 dark:text-rose-400">{s.management_risk_score}/100</div>
                            <div className="w-12 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-rose-500" style={{ width: `${s.management_risk_score}%` }}></div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* SECTION 2: DASHBOARD Visual Distributions */}
            <section id="sec-dashboard" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs">2</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Dashboard Visual Distribution Charts</h2>
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400">5 Key Categorical Breakdowns</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex flex-col">
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-1">Stage Distribution</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Orders grouped by workflow lifecycle stage</p>
                        <div className="relative flex-1 min-h-[220px]">
                            <canvas id="chartStage"></canvas>
                        </div>
                    </div>

                    <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex flex-col">
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-1">Stock Availability Distribution</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Inventory readiness breakdown</p>
                        <div className="relative flex-1 min-h-[220px]">
                            <canvas id="chartStock"></canvas>
                        </div>
                    </div>

                    <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex flex-col">
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-1">Payment Status Breakdown</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Financial clearance levels across active orders</p>
                        <div className="relative flex-1 min-h-[220px]">
                            <canvas id="chartPayment"></canvas>
                        </div>
                    </div>

                    <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex flex-col">
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-1">Dispatch Logistics Status</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Fulfillment scheduling and blockage tracking</p>
                        <div className="relative flex-1 min-h-[220px]">
                            <canvas id="chartDispatch"></canvas>
                        </div>
                    </div>

                    <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex flex-col lg:col-span-2">
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-1">Customer Type & Exposure Distribution</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Order count & order value ratio by client tier</p>
                        <div className="relative flex-1 min-h-[220px]">
                            <canvas id="chartCustomerType"></canvas>
                        </div>
                    </div>
                </div>
            </section>

            {/* SECTION 3: ORDERS Master Table */}
            <section id="sec-orders" className="scroll-mt-20 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs">3</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Master Sales Orders Table</h2>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search SO, Estimate, Customer, Reason..."
                            className="w-full sm:w-auto px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-slate-100 sm:min-w-[240px]"
                        />
                        <select
                            value={riskFilter}
                            onChange={(e) => setRiskFilter(e.target.value)}
                            className="px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-200"
                        >
                            <option value="all">All Risk Levels</option>
                            <option value="Critical">Critical Risk</option>
                            <option value="High">High Risk</option>
                            <option value="Medium">Medium Risk</option>
                            <option value="Low">Low Risk</option>
                        </select>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                                    <th className="py-3 px-4">SO / Estimate</th>
                                    <th className="py-3 px-4">Customer</th>
                                    <th className="py-3 px-4 text-right">Order Value</th>
                                    <th className="py-3 px-4">Stage / Priority</th>
                                    <th className="py-3 px-4">Stock / Payment</th>
                                    <th className="py-3 px-4">Dispatch Status</th>
                                    <th className="py-3 px-4 text-center">Delay (Days)</th>
                                    <th className="py-3 px-4">Next Action / Owner</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 text-xs">
                                {orders.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="py-6 text-center text-slate-400">No orders match your filter criteria.</td>
                                    </tr>
                                ) : (
                                    orders.map((o: any) => (
                                        <tr key={o.so_number} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                                            <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                                                <div>{o.so_number}</div>
                                                <div className="text-[10px] font-normal text-slate-400">{o.estimate_number}</div>
                                            </td>
                                            <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">
                                                <div>{o.customer}</div>
                                                <div className="text-[10px] text-slate-400">{o.client_type}</div>
                                            </td>
                                            <td className="py-3 px-4 text-right font-semibold text-slate-900 dark:text-white">
                                                {o.order_value === 0 ? <span className="text-slate-400 italic">₹0.00 (FOC)</span> : formatINR(o.order_value)}
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 block w-max mb-1">{o.current_stage}</span>
                                                <span className="text-[10px] font-semibold text-slate-500">{o.priority}</span>
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{o.stock_status}</div>
                                                <div className="text-[10px] text-emerald-600 dark:text-emerald-400">{o.payment_status}</div>
                                            </td>
                                            <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{o.dispatch_status}</td>
                                            <td className="py-3 px-4 text-center">
                                                <span className={`px-2 py-0.5 rounded text-xs font-extrabold ${o.delay_days >= 20 ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}>
                                                    {o.delay_days} d
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 max-w-xs">
                                                <div className="truncate font-medium text-slate-800 dark:text-slate-200" title={o.next_action}>{o.next_action}</div>
                                                <div className="text-[10px] text-slate-400">{o.recommended_owner}</div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            {/* SECTION 4: CRITICAL ORDERS */}
            <section id="sec-critical" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-rose-600 text-white flex items-center justify-center font-bold text-xs">4</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Critical Orders Escalation List</h2>
                    </div>
                    <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                        Immediate Executive Action Required
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {data.critical_orders.map((item: any) => (
                        <div key={item.so_number} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border-l-4 border-l-rose-500 border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex flex-col justify-between space-y-3">
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="px-2 py-0.5 text-[10px] font-extrabold rounded bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 uppercase">{item.priority}</span>
                                    <span className="text-xs font-mono font-bold text-slate-500">{item.so_number}</span>
                                </div>
                                <h4 className="font-bold text-sm text-slate-900 dark:text-white mt-1">{item.customer}</h4>
                                <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-1 leading-relaxed"><i className="fa-solid fa-triangle-exclamation mr-1"></i>{item.issue}</p>
                            </div>

                            <div className="pt-2 border-t border-slate-100 dark:border-slate-700 space-y-1.5 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Financial Impact:</span>
                                    <span className="font-bold text-slate-900 dark:text-white">{formatINR(item.financial_impact)}</span>
                                </div>
                                <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium"><strong className="text-blue-600 dark:text-blue-400">Action:</strong> {item.recommended_action}</div>
                                <div className="flex justify-between text-[10px] text-slate-400 pt-1">
                                    <span>Owner: <strong>{item.owner}</strong></span>
                                    <span>Deadline: <strong className="text-rose-500">{item.deadline}</strong></span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* SECTION 5: PROCUREMENT */}
            <section id="sec-procurement" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs">5</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Procurement & Inventory Operations</h2>
                    </div>
                    <div className="flex gap-2">
                        <span className="px-2.5 py-1 text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 rounded-lg">
                            Waiting Stock: <span>{data.procurement.summary.waiting_stock}</span>
                        </span>
                        <span className="px-2.5 py-1 text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 rounded-lg">
                            Partial Stock: <span>{data.procurement.summary.partial_stock}</span>
                        </span>
                        <span className="px-2.5 py-1 text-xs font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 rounded-lg">
                            Vendor Pending: <span>{data.procurement.summary.vendor_pending}</span>
                        </span>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-3">
                        <h3 className="font-bold text-xs uppercase tracking-wider text-amber-600 dark:text-amber-400">Orders Waiting / Partial Stock</h3>
                        <div className="space-y-2 text-xs">
                            {data.procurement.orders_waiting_stock.map((o: any) => (
                                <div key={o.so} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-700/50 flex justify-between items-center">
                                    <div>
                                        <span className="font-bold text-slate-800 dark:text-slate-200">{o.so}</span> - <span className="text-slate-500">{o.customer}</span>
                                        <div className="text-[10px] text-amber-600 dark:text-amber-400">{o.item} (Qty: {o.qty})</div>
                                    </div>
                                    <span className="px-1.5 py-0.5 text-[9px] bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-bold rounded">Waiting</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-3">
                        <h3 className="font-bold text-xs uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Vendor Pending & Missing ETAs</h3>
                        <div className="space-y-2 text-xs">
                            {data.procurement.vendor_pending_orders.map((o: any) => (
                                <div key={o.so} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-700/50 flex justify-between items-center">
                                    <div>
                                        <span className="font-bold text-slate-800 dark:text-slate-200">{o.so}</span> - <span className="text-slate-500">{o.customer}</span>
                                        <div className="text-[10px] text-indigo-600 dark:text-indigo-400">Vendor: {o.vendor} ({o.days}d delay)</div>
                                    </div>
                                    <span className="px-1.5 py-0.5 text-[9px] bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 font-bold rounded">Vendor Slip</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-3">
                        <h3 className="font-bold text-xs uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Vendor Priority Follow-up Sheet</h3>
                        <div className="space-y-2 text-xs">
                            {data.procurement.vendor_priority_list.map((v: any) => (
                                <div key={v.vendor} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-700/50 space-y-1">
                                    <div className="flex justify-between font-bold text-slate-800 dark:text-slate-200">
                                        <span>{v.vendor}</span>
                                        <span className="text-emerald-600">{formatINR(v.total_value)}</span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 flex justify-between">
                                        <span>Pending POs: {v.pending_pos}</span>
                                        <span className="font-semibold text-slate-700 dark:text-slate-300">{v.action}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* SECTION 6: DISPATCH */}
            <section id="sec-dispatch" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-teal-600 text-white flex items-center justify-center font-bold text-xs">6</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Dispatch Logistics Command</h2>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="p-4 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl space-y-2">
                        <div className="font-bold text-xs text-emerald-800 dark:text-emerald-300 flex justify-between">
                            <span><i className="fa-solid fa-truck-ramp-box mr-1"></i> Ready Today</span>
                            <span className="px-2 py-0.5 bg-emerald-200 dark:bg-emerald-800 rounded-full text-[10px]">{data.dispatch.ready_today.length}</span>
                        </div>
                        <div className="space-y-1 text-xs">
                            {data.dispatch.ready_today.map((i: any) => (
                                <div key={i.so} className="flex justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
                                    <span>{i.so} ({i.customer})</span>
                                    <span className="text-emerald-600">{formatINR(i.val)}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-2xl space-y-2">
                        <div className="font-bold text-xs text-blue-800 dark:text-blue-300 flex justify-between">
                            <span><i className="fa-solid fa-calendar-day mr-1"></i> Scheduled Today</span>
                            <span className="px-2 py-0.5 bg-blue-200 dark:bg-blue-800 rounded-full text-[10px]">{data.dispatch.scheduled_today.length}</span>
                        </div>
                        <div className="space-y-1 text-xs">
                            {data.dispatch.scheduled_today.map((i: any) => (
                                <div key={i.so} className="flex justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
                                    <span>{i.so} ({i.customer})</span>
                                    <span className="text-blue-600">{formatINR(i.val)}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 rounded-2xl space-y-2">
                        <div className="font-bold text-xs text-rose-800 dark:text-rose-300 flex justify-between">
                            <span><i className="fa-solid fa-ban mr-1"></i> Blocked Orders</span>
                            <span className="px-2 py-0.5 bg-rose-200 dark:bg-rose-800 rounded-full text-[10px]">{data.dispatch.blocked_orders.length}</span>
                        </div>
                        <div className="space-y-1 text-xs">
                            {data.dispatch.blocked_orders.map((i: any) => (
                                <div key={i.so} className="flex justify-between text-xs font-semibold text-rose-700 dark:text-rose-400">
                                    <span>{i.so} ({i.customer})</span>
                                    <span className="text-[10px] uppercase font-bold">{i.reason}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl space-y-2">
                        <div className="font-bold text-xs text-amber-800 dark:text-amber-300 flex justify-between">
                            <span><i className="fa-solid fa-triangle-exclamation mr-1"></i> Delayed Dispatch</span>
                            <span className="px-2 py-0.5 bg-amber-200 dark:bg-amber-800 rounded-full text-[10px]">{data.dispatch.delayed_dispatch.length}</span>
                        </div>
                        <div className="space-y-1 text-xs">
                            {data.dispatch.delayed_dispatch.map((i: any) => (
                                <div key={i.so} className="flex justify-between text-xs font-semibold text-amber-700 dark:text-amber-400">
                                    <span>{i.so} ({i.customer})</span>
                                    <span className="text-[10px] uppercase font-bold">{i.delay}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 rounded-2xl space-y-2">
                        <div className="font-bold text-xs text-purple-800 dark:text-purple-300 flex justify-between">
                            <span><i className="fa-solid fa-van-shuttle mr-1"></i> Transport Pending</span>
                            <span className="px-2 py-0.5 bg-purple-200 dark:bg-purple-800 rounded-full text-[10px]">{data.dispatch.transport_pending.length}</span>
                        </div>
                        <div className="space-y-1 text-xs">
                            {data.dispatch.transport_pending.map((i: any) => (
                                <div key={i.so} className="flex justify-between text-xs font-semibold text-purple-700 dark:text-purple-400">
                                    <span>{i.so} ({i.customer})</span>
                                    <span className="text-[10px] font-bold">{i.transporter}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-cyan-50/50 dark:bg-cyan-950/20 border border-cyan-200 dark:border-cyan-800 rounded-2xl space-y-2">
                        <div className="font-bold text-xs text-cyan-800 dark:text-cyan-300 flex justify-between">
                            <span><i className="fa-solid fa-file-invoice mr-1"></i> Documentation Pending</span>
                            <span className="px-2 py-0.5 bg-cyan-200 dark:bg-cyan-800 rounded-full text-[10px]">{data.dispatch.documentation_pending.length}</span>
                        </div>
                        <div className="space-y-1 text-xs">
                            {data.dispatch.documentation_pending.map((i: any) => (
                                <div key={i.so} className="flex justify-between text-xs font-semibold text-cyan-700 dark:text-cyan-400">
                                    <span>{i.so} ({i.customer})</span>
                                    <span className="text-[10px] font-bold">{i.missing_doc}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* SECTION 7: PAYMENTS */}
            <section id="sec-payments" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">7</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Payments & Financial Risk Management</h2>
                    </div>
                    <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                        Total Outstanding Balance: <span className="text-rose-600 dark:text-rose-400 font-extrabold">{formatINR(data.payments.total_outstanding)}</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-2">
                        <h3 className="font-bold text-xs text-amber-600 dark:text-amber-400 uppercase tracking-wider">Advance Pending</h3>
                        <div className="space-y-1 text-xs">
                            {data.payments.advance_pending.map((i: any) => (
                                <div key={i.so} className="flex justify-between text-slate-800 dark:text-slate-200 font-medium"><span>{i.so} ({i.customer})</span><span className="font-bold text-amber-600">{formatINR(i.amount)}</span></div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-2">
                        <h3 className="font-bold text-xs text-rose-600 dark:text-rose-400 uppercase tracking-wider">Full Payment Pending</h3>
                        <div className="space-y-1 text-xs">
                            {data.payments.full_payment_pending.map((i: any) => (
                                <div key={i.so} className="flex justify-between text-slate-800 dark:text-slate-200 font-medium"><span>{i.so} ({i.customer})</span><span className="font-bold text-rose-600">{formatINR(i.amount)}</span></div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-2">
                        <h3 className="font-bold text-xs text-blue-600 dark:text-blue-400 uppercase tracking-wider">Against Delivery / LC</h3>
                        <div className="space-y-1 text-xs">
                            {data.payments.against_delivery.map((i: any) => (
                                <div key={i.so} className="flex justify-between text-slate-800 dark:text-slate-200 font-medium"><span>{i.so} ({i.customer})</span><span className="font-bold text-blue-600">{formatINR(i.amount)}</span></div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-2">
                        <h3 className="font-bold text-xs text-purple-600 dark:text-purple-400 uppercase tracking-wider">Payment Hold / Blocked</h3>
                        <div className="space-y-1 text-xs">
                            {data.payments.payment_hold.map((i: any) => (
                                <div key={i.so} className="flex justify-between text-slate-800 dark:text-slate-200 font-medium"><span>{i.so} ({i.customer})</span><span className="font-bold text-purple-600">{formatINR(i.amount)}</span></div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-2">
                        <h3 className="font-bold text-xs text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Received Today</h3>
                        <div className="space-y-1 text-xs">
                            {data.payments.received_today.map((i: any) => (
                                <div key={i.so} className="flex justify-between text-slate-800 dark:text-slate-200 font-medium"><span>{i.so} ({i.customer})</span><span className="font-bold text-emerald-600">{formatINR(i.amount)}</span></div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-2">
                        <h3 className="font-bold text-xs text-red-600 dark:text-red-400 uppercase tracking-wider">High Risk Exposure Accounts</h3>
                        <div className="space-y-1 text-xs">
                            {data.payments.high_risk_payments.map((i: any) => (
                                <div key={i.customer} className="flex justify-between text-slate-800 dark:text-slate-200 font-medium"><span>{i.customer} ({i.overdue_days}d overdue)</span><span className="font-bold text-red-600">{formatINR(i.exposure)}</span></div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* SECTION 8: CUSTOMER RISK MATRIX */}
            <section id="sec-customer-risk" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-orange-600 text-white flex items-center justify-center font-bold text-xs">8</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Customer Risk Assessment Matrix</h2>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {data.customer_risk.map((c: any) => (
                        <div key={c.customer} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-xs text-slate-900 dark:text-white truncate">{c.customer}</span>
                                <span className="px-2 py-0.5 text-[9px] font-bold rounded bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 uppercase">{c.risk}</span>
                            </div>
                            <p className="text-xs text-slate-500 leading-relaxed">{c.reason}</p>
                            <div className="pt-2 border-t border-slate-100 dark:border-slate-700 text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                                <strong>Rec Action:</strong> {c.recommended_action}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* SECTION 9: PRIORITY CALLS */}
            <section id="sec-priority-calls" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-purple-600 text-white flex items-center justify-center font-bold text-xs">9</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Priority Call Desk & Follow-up Script</h2>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-500 uppercase tracking-wider">
                                    <th className="py-3 px-4">Priority</th>
                                    <th className="py-3 px-4">SO Number</th>
                                    <th className="py-3 px-4">Customer</th>
                                    <th className="py-3 px-4">Trigger Reason</th>
                                    <th className="py-3 px-4">Question to Ask Customer</th>
                                    <th className="py-3 px-4">Recommended Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                {data.priority_calls.map((call: any) => (
                                    <tr key={call.so_number} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                                        <td className="py-2.5 px-4 font-bold text-purple-600 dark:text-purple-400">{call.priority}</td>
                                        <td className="py-2.5 px-4 font-mono font-semibold">{call.so_number}</td>
                                        <td className="py-2.5 px-4 font-medium text-slate-800 dark:text-slate-200">{call.customer}</td>
                                        <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{call.reason}</td>
                                        <td className="py-2.5 px-4 italic text-blue-600 dark:text-blue-400">"{call.question_to_ask}"</td>
                                        <td className="py-2.5 px-4 font-semibold text-emerald-600 dark:text-emerald-400">{call.recommended_action}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            {/* SECTION 10: EXCEPTIONS */}
            <section id="sec-exceptions" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-red-600 text-white flex items-center justify-center font-bold text-xs">10</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">System & Process Exceptions Log</h2>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {data.exceptions.map((ex: any) => (
                        <div key={ex.so_number} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-xs text-slate-900 dark:text-white">{ex.type}</span>
                                <span className={`px-2 py-0.5 text-[9px] font-bold rounded ${ex.severity === "Critical" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"} uppercase`}>{ex.severity}</span>
                            </div>
                            <div className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">{ex.so_number}</div>
                            <p className="text-xs text-slate-500">{ex.description}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* SECTION 11: DEPARTMENT ANALYSIS */}
            <section id="sec-departments" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-blue-700 text-white flex items-center justify-center font-bold text-xs">11</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Departmental Health & Issues Analysis</h2>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    {Object.keys(data.department_analysis).map((key) => {
                        const d = data.department_analysis[key];
                        return (
                            <div key={key} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-bold text-sm text-slate-900 dark:text-white capitalize">{key}</h4>
                                    <span className={`text-base font-black ${d.health_score >= 80 ? "text-emerald-600" : d.health_score >= 70 ? "text-amber-600" : "text-rose-600"}`}>{d.health_score}%</span>
                                </div>
                                <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5">
                                    <div className={`h-1.5 rounded-full ${d.health_score >= 80 ? "bg-emerald-500" : d.health_score >= 70 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${d.health_score}%` }}></div>
                                </div>
                                <div className="space-y-1 pt-1">
                                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Identified Bottlenecks:</span>
                                    <ul className="space-y-1">
                                        {d.issues.map((iss: string, idx: number) => (
                                            <li key={idx} className="text-xs text-slate-600 dark:text-slate-300 leading-tight flex items-start gap-1"><i className="fa-solid fa-angle-right text-[10px] mt-0.5 text-slate-400 shrink-0"></i>{iss}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* SECTION 12: ROOT CAUSES */}
            <section id="sec-root-causes" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-yellow-600 text-white flex items-center justify-center font-bold text-xs">12</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Root Cause & Financial Impact Analysis</h2>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {data.root_causes.map((rc: any) => (
                        <div key={rc.category} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-2">
                            <h4 className="font-bold text-xs text-slate-900 dark:text-white">{rc.category}</h4>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-500">Affected Orders: <strong className="text-slate-800 dark:text-slate-200">{rc.count}</strong></span>
                                <span className="font-extrabold text-rose-600">{formatINR(rc.affected_value)}</span>
                            </div>
                            <p className="text-[11px] text-blue-600 dark:text-blue-400 pt-1 border-t border-slate-100 dark:border-slate-700 font-medium">
                                <strong>Rec:</strong> {rc.recommendation}
                            </p>
                        </div>
                    ))}
                </div>
            </section>

            {/* SECTION 13: PREDICTIONS */}
            <section id="sec-predictions" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-indigo-700 text-white flex items-center justify-center font-bold text-xs">13</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Predictive Operations Analytics</h2>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                        <h3 className="font-bold text-xs text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">Predicted Dispatch Today</h3>
                        <div className="space-y-1.5 text-xs">
                            {data.predictions.dispatch_today.map((i: any) => (
                                <div key={i.so} className="flex justify-between font-medium text-slate-800 dark:text-slate-200"><span>{i.so} ({i.customer})</span><span className="font-bold text-emerald-600">{i.prob}</span></div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                        <h3 className="font-bold text-xs text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-2">Predicted Dispatch Tomorrow</h3>
                        <div className="space-y-1.5 text-xs">
                            {data.predictions.dispatch_tomorrow.map((i: any) => (
                                <div key={i.so} className="flex justify-between font-medium text-slate-800 dark:text-slate-200"><span>{i.so} ({i.customer})</span><span className="font-bold text-blue-600">{i.prob}</span></div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                        <h3 className="font-bold text-xs text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-2">Likely SLA Breach Alert</h3>
                        <div className="space-y-1.5 text-xs">
                            {data.predictions.likely_sla_breach.map((i: any) => (
                                <div key={i.so} className="flex justify-between font-medium text-slate-800 dark:text-slate-200"><span>{i.so}</span><span className="font-bold text-rose-600">{i.days_to_breach}</span></div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                        <h3 className="font-bold text-xs text-purple-600 dark:text-purple-400 uppercase tracking-wider mb-2">Management Attention Required</h3>
                        <div className="space-y-1.5 text-xs">
                            {data.predictions.management_attention.map((i: any) => (
                                <div key={i.area} className="text-slate-800 dark:text-slate-200"><strong className="text-purple-600">{i.area}:</strong> {i.impact}</div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* SECTION 14: KPIS */}
            <section id="sec-kpis" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-cyan-600 text-white flex items-center justify-center font-bold text-xs">14</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Core Operational KPIs & SLA Metrics</h2>
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                    {[
                        { title: "Dispatch SLA %", val: `${data.kpis.dispatch_sla_percent}%`, color: "text-emerald-600" },
                        { title: "Avg Dispatch Days", val: `${data.kpis.average_dispatch_days} d`, color: "text-blue-600" },
                        { title: "Avg Order Age", val: `${data.kpis.average_order_age} d`, color: "text-amber-600" },
                        { title: "Stock Availability", val: `${data.kpis.stock_availability_percent}%`, color: "text-teal-600" },
                        { title: "Procurement Pend %", val: `${data.kpis.procurement_pending_percent}%`, color: "text-indigo-600" },
                        { title: "Payment Collect %", val: `${data.kpis.payment_collection_percent}%`, color: "text-emerald-600" },
                        { title: "Avg Delay Days", val: `${data.kpis.average_delay_days} d`, color: "text-rose-600" },
                        { title: "High Value Pend %", val: `${data.kpis.high_value_pending_percent}%`, color: "text-purple-600" },
                    ].map((k) => (
                        <div key={k.title} className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm text-center">
                            <div className="text-[10px] text-slate-400 font-semibold uppercase truncate">{k.title}</div>
                            <div className={`text-lg font-black ${k.color} mt-1`}>{k.val}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* SECTION 15: ACTION ITEMS */}
            <section id="sec-actions" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-emerald-700 text-white flex items-center justify-center font-bold text-xs">15</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Departmental Action Items Taskboard</h2>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.keys(data.action_items).map((dept) => (
                        <div key={dept} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-2">
                            <h4 className="font-bold text-xs uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5">
                                <i className="fa-solid fa-list-check text-blue-500"></i> {dept} Action Items
                            </h4>
                            <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                                {data.action_items[dept].map((item: string, idx: number) => (
                                    <li key={idx} className="flex items-start gap-1.5">
                                        <input type="checkbox" className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </section>

            {/* SECTION 16: TOP 20 PRIORITIES */}
            <section id="sec-top20" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-rose-700 text-white flex items-center justify-center font-bold text-xs">16</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Top 20 Operational Priorities</h2>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-500 uppercase tracking-wider">
                                    <th className="py-3 px-4 text-center">Rank</th>
                                    <th className="py-3 px-4">Priority Issue</th>
                                    <th className="py-3 px-4">Customer</th>
                                    <th className="py-3 px-4">SO Number</th>
                                    <th className="py-3 px-4">Impact</th>
                                    <th className="py-3 px-4">Owner</th>
                                    <th className="py-3 px-4 text-right">Deadline</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                {data.top_20_priorities.map((p: any) => (
                                    <tr key={p.rank} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                                        <td className="py-2 px-4 text-center font-black text-rose-600">{p.rank}</td>
                                        <td className="py-2 px-4 font-bold text-slate-900 dark:text-white">{p.issue}</td>
                                        <td className="py-2 px-4 text-slate-700 dark:text-slate-300">{p.customer}</td>
                                        <td className="py-2 px-4 font-mono font-semibold text-blue-600">{p.so_number}</td>
                                        <td className="py-2 px-4 font-semibold text-amber-600">{p.impact}</td>
                                        <td className="py-2 px-4 text-slate-600 dark:text-slate-400">{p.owner}</td>
                                        <td className="py-2 px-4 text-right font-mono text-rose-500 font-semibold">{p.deadline}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            {/* SECTION 17: CRM IMPROVEMENTS */}
            <section id="sec-crm" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-slate-700 text-white flex items-center justify-center font-bold text-xs">17</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">CRM & Data Governance Audit</h2>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[
                        { title: "Missing Core Fields", list: data.crm_improvements.missing_fields, color: "text-rose-600" },
                        { title: "Unused / Redundant Fields", list: data.crm_improvements.unused_fields, color: "text-amber-600" },
                        { title: "Duplicate Data Fields", list: data.crm_improvements.duplicate_fields, color: "text-purple-600" },
                        { title: "Recommended Dropdowns", list: data.crm_improvements.recommended_dropdowns, color: "text-blue-600" },
                        { title: "Recommended Calculated Fields", list: data.crm_improvements.recommended_calculated_fields, color: "text-emerald-600" },
                        { title: "Customer Master Enhancements", list: data.crm_improvements.customer_master_fields, color: "text-indigo-600" },
                    ].map((f) => (
                        <div key={f.title} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-2">
                            <h4 className={`font-bold text-xs uppercase tracking-wider ${f.color}`}>{f.title}</h4>
                            <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                                {f.list.map((item: string, idx: number) => (
                                    <li key={idx} className="flex items-center gap-1.5"><i className="fa-solid fa-check text-[10px] text-slate-400"></i>{item}</li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </section>

            {/* SECTION 18: AUTOMATION TRIGGERS */}
            <section id="sec-automation" className="scroll-mt-20 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-blue-800 text-white flex items-center justify-center font-bold text-xs">18</span>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Workflow Automation & Alert Triggers</h2>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden mb-8">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-500 uppercase tracking-wider">
                                    <th className="py-3 px-4">Priority</th>
                                    <th className="py-3 px-4">Event Trigger</th>
                                    <th className="py-3 px-4">Condition Logic</th>
                                    <th className="py-3 px-4">Automated Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                {data.automation_triggers.map((t: any) => (
                                    <tr key={t.trigger} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                                        <td className="py-2.5 px-4">
                                            <span className={`px-2 py-0.5 text-[9px] font-bold rounded ${t.priority === "Critical" ? "bg-rose-100 text-rose-800" : t.priority === "High" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"} uppercase`}>{t.priority}</span>
                                        </td>
                                        <td className="py-2.5 px-4 font-bold text-slate-900 dark:text-white">{t.trigger}</td>
                                        <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-300">{t.condition}</td>
                                        <td className="py-2.5 px-4 font-semibold text-emerald-600 dark:text-emerald-400">{t.action}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>
        </div>
    );
}