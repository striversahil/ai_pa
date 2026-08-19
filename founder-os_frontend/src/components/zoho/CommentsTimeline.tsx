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
    <div className="border-t border-zinc-800/80 pt-4 mt-2 space-y-3">
      <div className="flex justify-between items-center">
        <h4 className="text-sm font-bold text-zinc-300">
          Comments Timeline ({comments.length})
        </h4>
        {comments.length > 0 && (
          <button
            onClick={onToggle}
            className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors cursor-pointer"
          >
            {expanded ? "Show Summary Note" : "Show History Table"}
          </button>
        )}
      </div>

      {expanded ? (
        <div className="overflow-x-auto border border-zinc-800/80 rounded-xl">
          <table className="w-full text-left text-xs border-collapse bg-zinc-950/20">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 font-semibold bg-zinc-950/40">
                <th className="p-3 w-32">Date</th>
                <th className="p-3 w-24">Author</th>
                <th className="p-3">Comment Content</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/40">
              {comments.map((comm) => (
                <tr key={comm.commentId} className="text-zinc-400 hover:text-zinc-200 transition-colors">
                  <td className="p-3 font-mono whitespace-nowrap">{comm.dateFormatted || comm.dateDescription || comm.date}</td>
                  <td className="p-3 font-semibold">{comm.commentedBy || 'Agent'}</td>
                  <td className="p-3 whitespace-pre-wrap">{comm.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-3.5 bg-zinc-950/40 border border-zinc-800/60 rounded-xl space-y-2">
          {comments.length > 0 ? (
            <>
              <div className="flex justify-between items-center text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                <span>Latest Sales Remark | By: {comments[0].commentedBy || 'Sales Agent'}</span>
                <span>{comments[0].dateFormatted || comments[0].dateDescription || comments[0].date}</span>
              </div>
              <div className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {comments[0].description}
              </div>
            </>
          ) : (
            <em className="text-xs text-zinc-500 block text-center py-2">No comments logged.</em>
          )}
        </div>
      )}
    </div>
  );
}