import React, { useMemo } from "react";
import { Agent, Comment } from "../mockData";

interface CommentNodeProps {
  comment: Comment & { replies: Comment[] };
  agents: Agent[];
  onReplyClick: (commentId: string) => void;
  onImageClick: (url: string) => void;
}

export default function CommentNode({ comment, agents, onReplyClick, onImageClick }: CommentNodeProps) {
  const authorAgent = useMemo<Agent>(() => {
    return agents.find(a => a.id === comment.agentId) || { id: 0, name: "Agent", initials: "A", color: "#888", status: "inactive" };
  }, [agents, comment.agentId]);

  const formatDiscordTimestamp = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (date.toDateString() === now.toDateString()) {
      return `Today at ${timeStr}`;
    }
    
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday at ${timeStr}`;
    }
    
    return `${date.toLocaleDateString([], { month: '2-digit', day: '2-digit', year: 'numeric' })} ${timeStr}`;
  };

  return (
    <div className="comment-node-container space-y-3">
      {/* Self comment card */}
      <div className="flex gap-3 hover:bg-[var(--bg-input)]/30 px-3 py-1.5 rounded-lg transition-all duration-150 z-10 relative">
        <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-xs flex-shrink-0" style={{ backgroundColor: authorAgent.color }}>
          {authorAgent.initials}
        </div>
        <div className="flex-grow space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="font-extrabold text-sm text-[var(--text-primary)] hover:underline cursor-pointer">{authorAgent.name}</span>
            <span className="text-[10px] text-[var(--text-tertiary)] font-medium">
              {formatDiscordTimestamp(comment.createdAt)}
            </span>
          </div>
          <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{comment.content}</p>
          {comment.imageUrl && (
            <div 
              className="mt-2 w-32 border border-[var(--border-card)] rounded-lg overflow-hidden cursor-zoom-in group aspect-video"
              onClick={() => onImageClick(comment.imageUrl!)}
            >
              <img 
                src={comment.imageUrl} 
                alt="Attached reference" 
                className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
              />
            </div>
          )}
          <div className="flex gap-4 pt-1">
            <button 
              className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--text-secondary)] hover:text-brand-indigo cursor-pointer transition-colors"
              onClick={() => onReplyClick(comment.id)}
              type="button"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              <span>Reply</span>
            </button>
          </div>
        </div>
      </div>

      {/* Replies list */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="replies-list-container pl-11 space-y-3">
          {comment.replies.map(reply => (
            <CommentNode 
              key={reply.id} 
              comment={reply as Comment & { replies: Comment[] }} 
              agents={agents} 
              onReplyClick={onReplyClick} 
              onImageClick={onImageClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
