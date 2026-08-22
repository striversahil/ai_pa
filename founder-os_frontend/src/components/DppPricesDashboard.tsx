"use client";

import React, { useState, useEffect } from "react";

type QuoteItem = {
  itemName: string;
  timesQuoted: number;
  avgPrice: number | null;
};

type DppData = {
  totalQuotes: number;
  distinctItems: number;
  latestQuoteAt: string | null;
  lastQuote: { item: string; price: number; currency: string } | null;
  items: QuoteItem[];
};

export default function DppPricesDashboard() {
  const [data, setData] = useState<DppData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/automations/dpp-prices-dashboard/data");
      if (!res.ok) {
        setError(`Dashboard not available (HTTP ${res.status}). DPP chat config may be empty.`);
        setData(null);
        return;
      }
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/automations/dpp-prices-dashboard/data");
        if (!res.ok) {
          if (!cancelled) {
            setError(`Dashboard not available (HTTP ${res.status}). DPP chat config may be empty.`);
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
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div className="flex items-start gap-3">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 shadow-lg shadow-emerald-500/10">
            <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-emerald300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div>
            <h1 className="text-3xl font-bold font-heading tracking-tight">
              <span className="bg-gradient-to-r from-white via-emerald-100 to-emerald-400 bg-clip-text text-transparent">DPP Price Dashboard</span>
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">Price quotes parsed from DPP WhatsApp messages</p>
          </div>
        </div>
        <button
          onClick={fetchData}
          className="text-white flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium text-sm transition-all duration-200 cursor-pointer shadow-lg shadow-emerald-600/25 border-0"
        >
          <span>🔄</span> Refresh
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-zinc-500 dark:text-zinc-400">
          <span className="animate-pulse">Loading price quotes...</span>
        </div>
      )}

      {error && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-5 text-sm text-amber-600 dark:text-amber-amber300">
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-5">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Total Quotes Parsed</span>
              <span className="text-2xl font-bold text-zinc-900 dark:text-white block">{data.totalQuotes}</span>
            </div>
            <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-5">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Distinct Items</span>
              <span className="text-2xl font-bold text-zinc-900 dark:text-white block">{data.distinctItems}</span>
            </div>
            <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-5">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Latest Quote</span>
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-emerald400 block">
                {data.lastQuote ? `₹${data.lastQuote.price.toLocaleString()}` : "—"}
              </span>
              {data.lastQuote && <span className="text-xs text-zinc-600 dark:text-zinc-500 block mt-1">{data.lastQuote.item}</span>}
            </div>
            <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-5">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Last Updated</span>
              <span className="text-sm font-bold text-zinc-900 dark:text-white block mt-1.5">
                {data.latestQuoteAt ? new Date(data.latestQuoteAt).toLocaleString() : "—"}
              </span>
            </div>
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            <div className="border-b border-zinc-200 dark:border-zinc-800 px-5 py-4">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-white">Item Price Tracker</h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-500 mt-0.5">Latest average unit price per item</p>
            </div>
            {data.items.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-zinc-600 dark:text-zinc-500 italic">
                No quotes yet. When DPP sends <code>item — price</code> messages, they appear here automatically.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-600 dark:text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
                    <th className="px-5 py-3 font-bold">Item</th>
                    <th className="px-5 py-3 font-bold">Times Quoted</th>
                    <th className="px-5 py-3 font-bold text-right">Avg Unit Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                  {data.items.map((item) => (
                    <tr key={item.itemName} className="hover:bg-zinc-100/30 dark:hover:bg-zinc-800/30 transition-colors">
                      <td className="px-5 py-3 font-semibold text-zinc-800 dark:text-zinc-200">{item.itemName}</td>
                      <td className="px-5 py-3 text-zinc-500 dark:text-zinc-400">{item.timesQuoted}</td>
                      <td className="px-5 py-3 text-right font-mono text-emerald-600 dark:text-emerald-emerald400">
                        ₹{item.avgPrice ? item.avgPrice.toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
