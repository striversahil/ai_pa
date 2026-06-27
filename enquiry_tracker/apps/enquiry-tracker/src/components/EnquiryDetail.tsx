import React, { useState, useMemo } from "react";
import { Agent, Enquiry, Comment } from "../mockData";
import CommentNode from "./CommentNode";
import ClientProfile from "./ClientProfile";
import SpecificationsSection from "./SpecificationsSection";
import ActivityTimeline from "./ActivityTimeline";

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
  
  // Comment posting states
  const [commentInput, setCommentInput] = useState("");
  const [replyToCommentId, setReplyToCommentId] = useState<string | null>(null);
  const [commentImage, setCommentImage] = useState<string | null>(null);

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

  // Convert uploaded image file to data URI
  const handleCommentImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCommentImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
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
        <ClientProfile
          selectedEnquiry={selectedEnquiry}
          agents={agents}
          onUpdateStatus={onUpdateStatus}
          onUpdateAgent={onUpdateAgent}
        />

        {/* Right Column with Requirements & discussion thread */}
        <div className="space-y-6">
          
          <SpecificationsSection
            selectedEnquiry={selectedEnquiry}
            onOpenLightbox={onOpenLightbox}
          />

          {/* Right Column Twitter threads & audit log */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm flex flex-col min-h-[500px]">
            <div className="flex items-center justify-between border-b border-[var(--border-card)] pb-4 mb-4">
              <div className="flex gap-4">
                <button 
                  onClick={() => setActiveDetailTab("comments")}
                  className={`text-sm font-bold pb-2 relative transition-all cursor-pointer ${activeDetailTab === "comments" ? "text-brand-indigo after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-indigo" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
                  type="button"
                >
                  Confirmations Timeline
                </button>
                <button 
                  onClick={() => setActiveDetailTab("activity")}
                  className={`text-sm font-bold pb-2 relative transition-all cursor-pointer ${activeDetailTab === "activity" ? "text-brand-indigo after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-indigo" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
                  type="button"
                >
                  Activity Audit Logs
                </button>
              </div>
            </div>

            {/* TAB 1: Threaded Discussion Feed */}
            {activeDetailTab === "comments" && (
              <div className="space-y-5 flex-grow flex flex-col">
                
                {/* Input block at the top */}
                <div className="bg-[var(--bg-input)]/20 p-4 rounded-xl border border-[var(--border-card)] mb-2">
                  {replyToCommentId && (
                    <div className="flex items-center justify-between bg-brand-indigo/10 px-3 py-1.5 rounded-lg mb-2 text-xs">
                      <span className="font-semibold text-brand-indigo">Replying to comment...</span>
                      <button onClick={() => setReplyToCommentId(null)} className="text-zinc-400 hover:text-zinc-200 cursor-pointer font-bold bg-transparent border-0">&times;</button>
                    </div>
                  )}
                  
                  <form onSubmit={handlePostComment} className="space-y-3">
                    <textarea 
                      value={commentInput}
                      onChange={(e) => setCommentInput(e.target.value)}
                      placeholder={replyToCommentId ? "Write a threaded reply..." : "Type your update or status confirmation..."}
                      className="w-full bg-transparent border-0 text-sm outline-none resize-none placeholder-[var(--text-tertiary)] text-[var(--text-primary)] min-h-[60px]"
                    />

                    {commentImage && (
                      <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--border-card)]">
                        <img src={commentImage} alt="Attachment preview" className="w-full h-full object-cover" />
                        <button type="button" onClick={() => setCommentImage(null)} className="absolute top-1 right-1 bg-black/75 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs cursor-pointer font-bold border-0">&times;</button>
                      </div>
                    )}

                    <div className="flex justify-between items-center pt-2 border-t border-[var(--border-card)]/50">
                      <div className="flex gap-2">
                        <label className="p-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer rounded-lg bg-[var(--bg-input)]/50 hover:bg-[var(--bg-input)] transition-all">
                          <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <input type="file" onChange={handleCommentImageUpload} accept="image/*" className="hidden" />
                        </label>
                      </div>

                      <button type="submit" className="bg-brand-indigo hover:opacity-90 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-sm transition-all duration-200 cursor-pointer">
                        {replyToCommentId ? "Reply" : "Comment"}
                      </button>
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
                    {nestedComments.map(comment => (
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
              <ActivityTimeline
                activities={selectedEnquiry.activities}
                agents={agents}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
