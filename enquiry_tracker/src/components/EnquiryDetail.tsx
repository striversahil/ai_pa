import React, { useState, useMemo } from "react";
import { Agent, Enquiry, Comment } from "../mockData";
import CommentNode from "./CommentNode";

interface EnquiryDetailProps {
  selectedEnquiry: Enquiry;
  agents: Agent[];
  currentAgent: Agent;
  comments: Comment[];
  onUpdateStatus: (id: string, newStatus: Enquiry["status"]) => void;
  onUpdateAgent: (id: string, newAgentId: string) => void;
  onAddComment: (comment: Comment) => void;
  onDeleteEnquiry: (id: string) => void;
  onOpenEdit: (enq: Enquiry) => void;
  onBack: () => void;
  onOpenLightbox: (url: string, list?: string[], idx?: number) => void;
}

export default function EnquiryDetail({
  selectedEnquiry,
  agents,
  currentAgent,
  comments,
  onUpdateStatus,
  onUpdateAgent,
  onAddComment,
  onDeleteEnquiry,
  onOpenEdit,
  onBack,
  onOpenLightbox
}: EnquiryDetailProps) {
  // Localized view states
  const [activeDetailTab, setActiveDetailTab] = useState<"comments" | "activity">("comments");
  const [unmaskedPII, setUnmaskedPII] = useState<Record<string, boolean>>({});
  
  // Comment posting states
  const [commentInput, setCommentInput] = useState("");
  const [replyToCommentId, setReplyToCommentId] = useState<string | null>(null);
  const [commentImage, setCommentImage] = useState<string | null>(null);

  // PII masking toggles
  const togglePII = (enqId: string) => {
    setUnmaskedPII(prev => ({
      ...prev,
      [enqId]: !prev[enqId]
    }));
  };

  const maskEmail = (email: string) => {
    if (!email) return "";
    const parts = email.split("@");
    if (parts.length < 2) return email;
    const [name, domain] = parts;
    if (name.length <= 2) return `${name[0]}***@${domain}`;
    return `${name.slice(0, 2)}***@${domain}`;
  };

  const maskPhone = (phone: string) => {
    if (!phone) return "";
    if (phone.length <= 6) return "***-***";
    return `${phone.slice(0, 4)} ***-*** ${phone.slice(-3)}`;
  };

  // Nested comment trees calculations
  const nestedComments = useMemo(() => {
    const enquiryComments = comments.filter(c => c.enquiryId === selectedEnquiry.id);
    const sorted = [...enquiryComments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const commentMap: Record<string, Comment & { replies: Comment[] }> = {};
    const rootComments: (Comment & { replies: Comment[] })[] = [];

    sorted.forEach(c => {
      commentMap[c.id] = { ...c, replies: [] };
    });

    sorted.forEach(c => {
      const mapped = commentMap[c.id];
      if (c.parentId && commentMap[c.parentId]) {
        commentMap[c.parentId].replies.push(mapped);
      } else {
        rootComments.push(mapped);
      }
    });

    // Sort root comments by newest first so the latest parent thread is at the top
    rootComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return rootComments;
  }, [comments, selectedEnquiry.id]);

  // Post Comment / Reply inside thread
  const handlePostComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentInput.trim()) return;

    const newComment: Comment = {
      id: `com-${Date.now()}`,
      enquiryId: selectedEnquiry.id,
      agentId: currentAgent.id,
      content: commentInput.trim(),
      createdAt: new Date().toISOString(),
      parentId: replyToCommentId,
      imageUrl: commentImage || undefined
    };

    onAddComment(newComment);
    setCommentInput("");
    setReplyToCommentId(null);
    setCommentImage(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header / Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-[var(--border-card)]">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-2 bg-[var(--bg-card)] border border-[var(--border-card)] hover:bg-[var(--bg-input)] rounded-xl transition-all duration-200 cursor-pointer"
            type="button"
          >
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl md:text-2xl font-extrabold font-heading tracking-tight">{selectedEnquiry.title}</h1>
            <span className="text-xs text-[var(--text-secondary)]">Logged {new Date(selectedEnquiry.createdAt).toLocaleString()}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => onOpenEdit(selectedEnquiry)} 
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[var(--bg-card)] border border-[var(--border-card)] hover:bg-[var(--bg-input)] font-bold text-xs rounded-xl transition-all duration-200 cursor-pointer"
            type="button"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            <span>Edit Details</span>
          </button>

          <button 
            onClick={() => onDeleteEnquiry(selectedEnquiry.id)} 
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-brand-rose/10 border border-brand-rose/25 text-brand-rose hover:bg-brand-rose hover:text-white font-bold text-xs rounded-xl transition-all duration-200 cursor-pointer"
            type="button"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Delete</span>
          </button>
        </div>
      </div>

      {/* Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
        
        {/* Left Column Profile panel */}
        <div className="space-y-6">
          
          {/* B2B Status card */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm space-y-4">
            <h3 className="font-heading font-extrabold text-base border-b border-[var(--border-card)] pb-3">Enquiry Overview</h3>
            
            <div className="space-y-3.5">
              <div>
                <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Client Company</span>
                <span className="font-bold text-base mt-0.5 block">{selectedEnquiry.clientCompany}</span>
              </div>

              <div>
                <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Pipeline Value</span>
                <span className="font-heading font-extrabold text-xl text-brand-indigo block mt-0.5">₹{selectedEnquiry.estimatedValue.toLocaleString()}</span>
              </div>

              <div>
                <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-1">Sales Stage</span>
                <select 
                  value={selectedEnquiry.status}
                  onChange={(e) => onUpdateStatus(selectedEnquiry.id, e.target.value as Enquiry["status"])}
                  className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm font-semibold cursor-pointer"
                >
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="qualified">Qualified</option>
                  <option value="proposal">Proposal</option>
                  <option value="negotiation">Negotiation</option>
                  <option value="won">Closed Won</option>
                  <option value="lost">Closed Lost</option>
                </select>
              </div>

              <div>
                <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-1">Assigned Agent</span>
                <select 
                  value={selectedEnquiry.assignedAgentId}
                  onChange={(e) => onUpdateAgent(selectedEnquiry.id, e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm font-semibold cursor-pointer"
                >
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* B2B Contacts with masking */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm space-y-4">
            <h3 className="font-heading font-extrabold text-base border-b border-[var(--border-card)] pb-3">Client Contact PII</h3>
            
            <div className="space-y-3.5">
              <div>
                <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Contact Person</span>
                <span className="font-semibold text-sm mt-0.5 block">{selectedEnquiry.contactName}</span>
              </div>

              <div>
                <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Email Address</span>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-sm font-semibold truncate">
                    {unmaskedPII[selectedEnquiry.id] ? (
                      selectedEnquiry.contactEmail
                    ) : (
                      <span className="font-mono tracking-wider bg-[var(--bg-input)] px-2 py-0.5 rounded text-xs">{maskEmail(selectedEnquiry.contactEmail)}</span>
                    )}
                  </span>
                  <button onClick={() => togglePII(selectedEnquiry.id)} className="text-xs font-bold text-brand-indigo hover:underline flex-shrink-0 cursor-pointer bg-transparent border-0">
                    {unmaskedPII[selectedEnquiry.id] ? "Hide" : "Reveal"}
                  </button>
                </div>
              </div>

              <div>
                <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Phone Number</span>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-sm font-semibold">
                    {unmaskedPII[selectedEnquiry.id] ? (
                      selectedEnquiry.contactPhone || "Not provided"
                    ) : (
                      <span className="font-mono tracking-wider bg-[var(--bg-input)] px-2 py-0.5 rounded text-xs">{maskPhone(selectedEnquiry.contactPhone)}</span>
                    )}
                  </span>
                  <button onClick={() => togglePII(selectedEnquiry.id)} className="text-xs font-bold text-brand-indigo hover:underline flex-shrink-0 cursor-pointer bg-transparent border-0">
                    {unmaskedPII[selectedEnquiry.id] ? "Hide" : "Reveal"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column with Requirements & discussion thread */}
        <div className="space-y-6">
          {/* Technical Requirements & drawings block */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm space-y-4">
            <div className="border-b border-[var(--border-card)] pb-3">
              <h3 className="font-heading font-extrabold text-base flex items-center gap-2">
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

          {/* Right Column Twitter threads & audit log */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm flex flex-col min-h-[500px]">
            <div className="flex items-center justify-between border-b border-[var(--border-card)] pb-4 mb-4">
              <span className="font-heading font-extrabold text-base md:text-lg">Activity Discussion</span>
              
              <div className="flex bg-[var(--bg-input)] p-1 rounded-xl">
                <button 
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${activeDetailTab === "comments" ? "bg-[var(--bg-card)] shadow-sm text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
                  onClick={() => setActiveDetailTab("comments")}
                  type="button"
                >
                  Twitter Thread
                </button>
                <button 
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${activeDetailTab === "activity" ? "bg-[var(--bg-card)] shadow-sm text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
                  onClick={() => setActiveDetailTab("activity")}
                  type="button"
                >
                  Audit Log
                </button>
              </div>
            </div>

            {/* TAB 1: Twitter-like Thread comments */}
            {activeDetailTab === "comments" && (
              <div className="flex flex-col flex-1 gap-6">
                
                {/* Comment Input at the Top */}
                <div className="pb-4 border-b border-[var(--border-card)]">
                  {replyToCommentId && (
                    <div className="mb-2.5 p-2 bg-indigo-500/10 text-brand-indigo rounded-xl text-xs font-semibold flex justify-between items-center">
                      <span>
                        Replying to @{agents.find(a => a.id === comments.find(c => c.id === replyToCommentId)?.agentId)?.name || "Agent"}
                      </span>
                      <button onClick={() => setReplyToCommentId(null)} className="text-sm font-bold hover:opacity-75 cursor-pointer bg-transparent border-0" type="button">×</button>
                    </div>
                  )}

                  <form onSubmit={handlePostComment} className="flex gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-xs flex-shrink-0" style={{ backgroundColor: currentAgent.color }}>
                      {currentAgent.initials}
                    </div>
                    <div className="flex-grow flex flex-col gap-2">
                      <textarea 
                        value={commentInput}
                        onChange={(e) => setCommentInput(e.target.value)}
                        placeholder={replyToCommentId ? "Post your reply..." : "Log an update or confirmation inside this enquiry..."}
                        className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm resize-y min-h-[72px] text-[var(--text-primary)]"
                      />
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-[var(--text-tertiary)]">Posting as <strong>{currentAgent.name}</strong></span>
                          <label className="p-1.5 rounded-lg bg-[var(--bg-input)] hover:opacity-85 text-[var(--text-secondary)] hover:text-brand-indigo cursor-pointer transition-all duration-200" title="Attach photo">
                            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <input 
                              type="file" 
                              accept="image/*" 
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const reader = new FileReader();
                                  reader.onload = (evt) => {
                                    setCommentImage(evt.target?.result as string);
                                  };
                                  reader.readAsDataURL(file);
                                }
                              }}
                              className="hidden" 
                            />
                          </label>
                          {commentImage && (
                            <div className="relative w-8 h-8 border border-[var(--border-card)] rounded-lg overflow-hidden group">
                              <img src={commentImage} alt="Preview" className="w-full h-full object-cover" />
                              <button 
                                type="button" 
                                onClick={() => setCommentImage(null)}
                                className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-[8px] font-bold opacity-0 group-hover:opacity-100 transition-opacity duration-150 cursor-pointer"
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                        <button type="submit" className="bg-brand-indigo hover:opacity-90 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-sm transition-all duration-200 cursor-pointer">
                          {replyToCommentId ? "Reply" : "Comment"}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>

                {/* Comments List Underneath */}
                {nestedComments.length === 0 ? (
                  <div className="flex-grow flex flex-col items-center justify-center text-center p-8 gap-2 text-[var(--text-secondary)]">
                    <svg className="w-10 h-10 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span className="text-xs">No status confirmations recorded. Post the first update above!</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {[...nestedComments].sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(comment => (
                      <CommentNode 
                        key={comment.id} 
                        comment={comment} 
                        agents={agents} 
                        onReplyClick={(cid) => setReplyToCommentId(cid)} 
                        onImageClick={(url) => onOpenLightbox(url)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Audit Logs timeline */}
            {activeDetailTab === "activity" && (
              <div className="space-y-4">
                {[...(selectedEnquiry.activities || [])]
                  .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                  .map(act => {
                    const actAgent = agents.find(a => a.id === act.agentId);
                    return (
                      <div key={act.id} className="flex gap-3 pl-4 relative before:absolute before:left-0 before:top-2 before:bottom-0 before:w-0.5 before:bg-[var(--border-card)]">
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs md:text-sm font-medium">
                            {act.text}{" "}
                            {actAgent && <strong className="text-[var(--text-primary)]">({actAgent.name})</strong>}
                          </span>
                          <span className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                            {new Date(act.timestamp).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    );
                  })
                }
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
