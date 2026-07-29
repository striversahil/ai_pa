"use client";
import React from 'react';

interface Props { children: React.ReactNode; }
interface State { hasError: boolean; error?: Error; }

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(error: Error): State { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-4">{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false })} className="px-4 py-2 bg-brand-indigo text-white rounded-lg cursor-pointer">
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
