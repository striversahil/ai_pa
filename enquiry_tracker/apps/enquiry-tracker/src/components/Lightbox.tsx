import React, { useState, useEffect } from "react";

interface LightboxProps {
  images?: string[];
  initialIndex?: number;
  image: string | null;
  onClose: () => void;
}

export default function Lightbox({ images, initialIndex = 0, image, onClose }: LightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  // Determine active image list
  const activeImages = images && images.length > 0 ? images : (image ? [image] : []);
  const activeImage = activeImages[currentIndex];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeImages.length <= 1) return;
      if (e.key === "ArrowRight") {
        setCurrentIndex((prev) => (prev + 1) % activeImages.length);
      } else if (e.key === "ArrowLeft") {
        setCurrentIndex((prev) => (prev - 1 + activeImages.length) % activeImages.length);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeImages.length]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  if (activeImages.length === 0 || !activeImage) return null;

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % activeImages.length);
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + activeImages.length) % activeImages.length);
  };

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 cursor-zoom-out animate-fade-in"
      onClick={onClose}
    >
      {/* Download button */}
      <a 
        href={activeImage} 
        download={`drawing-${currentIndex + 1}.png`}
        className="absolute top-4 right-16 text-white hover:text-zinc-400 p-2 cursor-pointer z-50 bg-black/45 rounded-full border border-white/10 transition-colors flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
        title="Download Image"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </a>

      {/* Close button */}
      <button 
        className="absolute top-4 right-4 text-white hover:text-zinc-400 p-2 cursor-pointer z-50 bg-black/45 rounded-full border border-white/10"
        onClick={onClose}
        type="button"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Prev button */}
      {activeImages.length > 1 && (
        <button 
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-zinc-400 p-2.5 cursor-pointer z-50 bg-black/45 rounded-full border border-white/10 transition-colors"
          onClick={handlePrev}
          type="button"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Next button */}
      {activeImages.length > 1 && (
        <button 
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-zinc-400 p-2.5 cursor-pointer z-50 bg-black/45 rounded-full border border-white/10 transition-colors"
          onClick={handleNext}
          type="button"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Main Image Container */}
      <div className="relative max-w-[95vw] max-h-[90vh] flex flex-col items-center">
        <img 
          src={activeImage} 
          alt="Preview" 
          className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl border border-white/10 cursor-default animate-scale-up"
          onClick={(e) => e.stopPropagation()} 
        />
        
        {/* Caption/Counter */}
        {activeImages.length > 1 && (
          <span className="mt-3 px-3 py-1 bg-black/50 border border-white/10 text-white text-xs font-semibold rounded-full select-none">
            {currentIndex + 1} / {activeImages.length}
          </span>
        )}
      </div>
    </div>
  );
}
