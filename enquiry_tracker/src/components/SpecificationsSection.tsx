import React from "react";
import { Enquiry } from "../mockData";

interface SpecificationsSectionProps {
  selectedEnquiry: Enquiry;
  onOpenLightbox: (url: string, list?: string[], idx?: number) => void;
}

export default function SpecificationsSection({ selectedEnquiry, onOpenLightbox }: SpecificationsSectionProps) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm space-y-4">
      <div className="border-b border-[var(--border-card)] pb-3">
        <h3 className="font-heading font-extrabold text-base flex items-center gap-2 text-[var(--text-primary)]">
          <svg className="w-5 h-5 text-brand-indigo" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>Technical Requirements & Drawings</span>
        </h3>
      </div>

      <div className="space-y-4">
        <div>
          <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-1.5">Specifications & Scope</span>
          <p className="text-xs md:text-sm text-zinc-900 dark:text-white font-medium whitespace-pre-wrap leading-relaxed bg-[var(--bg-input)]/25 p-3.5 rounded-xl border border-[var(--border-card)]/50">
            {selectedEnquiry.description || "No specifications provided."}
          </p>
        </div>

        {selectedEnquiry.imageUrls && selectedEnquiry.imageUrls.length > 0 && (
          <div>
            <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Technical Drawings & Photos ({selectedEnquiry.imageUrls.length})</span>
            <div className="flex flex-wrap gap-3">
              {/* Render Image 1 */}
              <div 
                className="relative w-32 h-32 md:w-36 md:h-36 rounded-xl overflow-hidden border border-[var(--border-card)] group cursor-zoom-in bg-zinc-900/5 dark:bg-white/5 flex-shrink-0"
                onClick={() => onOpenLightbox(selectedEnquiry.imageUrls![0], selectedEnquiry.imageUrls, 0)}
              >
                <img 
                  src={selectedEnquiry.imageUrls[0]} 
                  alt="Technical drawing 1" 
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200" 
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-all duration-200">
                  <svg className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>

              {/* Render Image 2 */}
              {selectedEnquiry.imageUrls.length > 1 && (
                <div 
                  className="relative w-32 h-32 md:w-36 md:h-36 rounded-xl overflow-hidden border border-[var(--border-card)] group cursor-zoom-in bg-zinc-900/5 dark:bg-white/5 flex-shrink-0"
                  onClick={() => onOpenLightbox(selectedEnquiry.imageUrls![1], selectedEnquiry.imageUrls, 1)}
                >
                  <img 
                    src={selectedEnquiry.imageUrls[1]} 
                    alt="Technical drawing 2" 
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200" 
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-all duration-200">
                    <svg className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>
              )}

              {/* Render Image 3 (or more with overlay) */}
              {selectedEnquiry.imageUrls.length > 2 && (
                <div 
                  className="relative w-32 h-32 md:w-36 md:h-36 rounded-xl overflow-hidden border border-[var(--border-card)] group cursor-zoom-in bg-zinc-900/5 dark:bg-white/5 flex-shrink-0"
                  onClick={() => onOpenLightbox(selectedEnquiry.imageUrls![2], selectedEnquiry.imageUrls, 2)}
                >
                  <img 
                    src={selectedEnquiry.imageUrls[2]} 
                    alt="Technical drawing 3" 
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200" 
                  />
                  {selectedEnquiry.imageUrls.length > 3 ? (
                    /* Instagram-style overlay showing remaining images count */
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white transition-all duration-200 group-hover:bg-black/50 select-none">
                      <span className="text-xl font-extrabold tracking-tight">+{selectedEnquiry.imageUrls.length - 3}</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-300 mt-0.5">drawings</span>
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-all duration-200">
                      <svg className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
