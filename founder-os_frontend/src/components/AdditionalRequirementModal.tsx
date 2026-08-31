import React, { useState } from "react";

interface AdditionalRequirementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { text: string; images: string[] }) => void;
}

export default function AdditionalRequirementModal({ isOpen, onClose, onSave }: AdditionalRequirementModalProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;
    onSave({ text: trimmed, images });
    setText("");
    setImages([]);
    onClose();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    const loaded: string[] = [];
    let processed = 0;
    fileList.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) loaded.push(evt.target.result as string);
        processed++;
        if (processed === fileList.length) setImages((prev) => [...prev, ...loaded]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl shadow-xl w-full max-w-[540px] max-h-[90vh] overflow-y-auto animate-fade-in flex flex-col">
        <div className="flex justify-between items-center px-5 py-4 border-b border-[var(--border-card)]">
          <h2 className="font-heading font-extrabold text-base md:text-lg">Add Additional Requirement</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-[var(--bg-input)] transition-all cursor-pointer bg-transparent border-0"
            type="button"
          >
            <svg className="w-5 h-5 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Requirement Detail</label>
              <textarea
                rows={4}
                placeholder="e.g. Food-grade certificate required, 3-ply belt, order for 500 pcs..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm resize-y text-[var(--text-primary)]"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Attach Media (Drawings / Photos)</label>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleImageUpload}
                className="w-full text-xs text-[var(--text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-brand-indigo/10 file:text-brand-indigo file:cursor-pointer hover:file:opacity-90"
              />
              {images.length > 0 && (
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative aspect-square border border-[var(--border-card)] rounded-xl overflow-hidden group">
                      <img src={img} alt={`Attachment ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-bold transition-all duration-150 rounded-xl cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="px-5 py-4 border-t border-[var(--border-card)] flex justify-end gap-2 bg-[var(--bg-input)]/10">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex justify-center items-center px-4 py-2 border border-[var(--border-card)] hover:bg-[var(--bg-input)] font-bold text-xs rounded-lg cursor-pointer bg-transparent text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!text.trim() && images.length === 0}
              className="inline-flex justify-center items-center px-4 py-2 bg-brand-indigo hover:opacity-90 text-white font-bold text-xs rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Requirement
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}