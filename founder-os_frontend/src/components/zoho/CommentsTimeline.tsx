"use client";

import React from "react";
import type { Comment } from "./types";

interface Props {
 comments: Comment[];
 expanded: boolean;
 onToggle: () => void;
}

export default function CommentsTimeline({ comments, expanded, onToggle }: Props) {
 return (
 <div className="border-t border-[var(--border-card)] pt-4 mt-2 space-y-3">
 <div className="flex justify-between items-center">
 <h4 className="text-sm font-bold text-[var(--text-secondary)]">
 Comments Timeline ({comments.length})
 </h4>
 {comments.length > 0 && (
 <button
 onClick={onToggle}
 className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/10 text-[var(--text-secondary)] border border-black/15 dark:border-white/15 transition-colors cursor-pointer"
 >
 {expanded ? "Show Summary Note" : "Show History Table"}
 </button>
 )}
 </div>

 {expanded ? (
 <div className="overflow-x-auto border border-[var(--border-card)] rounded-xl">
 <table className="w-full text-left text-xs border-collapse bg-black/5 dark:bg-black/25">
 <thead>
 <tr className="border-b border-[var(--border-card)] text-[var(--text-tertiary)] font-semibold bg-black/5 dark:bg-black/25">
 <th className="p-3 w-32">Date</th>
 <th className="p-3 w-24">Author</th>
 <th className="p-3">Comment Content</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-[var(--border-card)]">
 {comments.map((comm) => (
 <tr key={comm.commentId} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
 <td className="p-3 font-mono whitespace-nowrap">{comm.dateFormatted || comm.dateDescription || comm.date}</td>
 <td className="p-3 font-semibold">{comm.commentedBy || 'Agent'}</td>
 <td className="p-3 whitespace-pre-wrap">{comm.description}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 ) : (
 <div className="p-3.5 bg-black/5 dark:bg-black/25 border border-[var(--border-card)] rounded-xl space-y-2">
 {comments.length > 0 ? (
 <>
 <div className="flex justify-between items-center text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-wider">
 <span>Latest Sales Remark | By: {comments[0].commentedBy || 'Sales Agent'}</span>
 <span>{comments[0].dateFormatted || comments[0].dateDescription || comments[0].date}</span>
 </div>
 <div className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
 {comments[0].description}
 </div>
 </>
 ) : (
 <em className="text-xs text-[var(--text-tertiary)] block text-center py-2">No comments logged.</em>
 )}
 </div>
 )}
 </div>
 );
}