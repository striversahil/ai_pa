import React from "react";

interface Toast {
  id: number;
  text: string;
  type: string;
}

interface ToastContainerProps {
  toasts: Toast[];
}

export default function ToastContainer({ toasts }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 right-6 z-50 space-y-2 max-w-sm pointer-events-none">
      {toasts.map(t => (
        <div 
          key={t.id} 
          className="p-4 bg-[var(--bg-sidebar)] border-l-4 text-white text-xs md:text-sm font-semibold rounded-xl shadow-lg flex items-center gap-2 animate-fade-in pointer-events-auto"
          style={{ borderLeftColor: t.type === "success" ? "#10b981" : t.type === "danger" ? "#f43f5e" : "#6366f1" }}
        >
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
