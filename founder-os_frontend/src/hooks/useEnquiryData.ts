'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Enquiry, Comment, Agent } from '../types';
import { INITIAL_ENQUIRIES, INITIAL_COMMENTS, INITIAL_AGENTS } from '../types';

const STORAGE_KEY = 'brindavan_enquiry_tracker_db';

function loadFromStorage() {
  if (typeof window === 'undefined') return { enquiries: INITIAL_ENQUIRIES, comments: INITIAL_COMMENTS, agents: INITIAL_AGENTS };
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed.enquiries && parsed.comments && parsed.agents) return parsed;
    }
  } catch {}
  const initial = { enquiries: INITIAL_ENQUIRIES, comments: INITIAL_COMMENTS, agents: INITIAL_AGENTS };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(initial)); } catch {}
  return initial;
}

function saveToStorage(enquiries: Enquiry[], comments: Comment[], agents: Agent[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ enquiries, comments, agents })); } catch {}
}

export function useEnquiryData() {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const data = loadFromStorage();
    setEnquiries(data.enquiries);
    setComments(data.comments);
    setAgents(data.agents);
    setLoaded(true);
  }, []);

  const syncState = useCallback((updatedEnquiries: Enquiry[], updatedComments: Comment[], updatedAgents: Agent[]) => {
    setEnquiries(updatedEnquiries);
    setComments(updatedComments);
    setAgents(updatedAgents);
    saveToStorage(updatedEnquiries, updatedComments, updatedAgents);
  }, []);

  const currentAgent = useMemo(() => {
    if (agents.length === 0) return { id: 1, name: 'Alice Vance', initials: 'AV', color: '#6366f1', status: 'active' as const };
    return agents.find(a => a.id === 1) || agents[0];
  }, [agents]);

  const selectedEnquiry = useMemo(() => null as Enquiry | null, []);

  const addEnquiry = useCallback((enquiry: Enquiry) => {
    syncState([enquiry, ...enquiries], comments, agents);
  }, [enquiries, comments, agents, syncState]);

  const updateEnquiry = useCallback((id: string, updates: Partial<Enquiry>) => {
    const updated = enquiries.map(e => e.id === id ? { ...e, ...updates } : e);
    syncState(updated, comments, agents);
  }, [enquiries, comments, agents, syncState]);

  const deleteEnquiry = useCallback((id: string) => {
    syncState(enquiries.filter(e => e.id !== id), comments.filter(c => c.enquiryId !== id), agents);
  }, [enquiries, comments, agents, syncState]);

  const addComment = useCallback((comment: Comment) => {
    syncState(enquiries, [...comments, comment], agents);
  }, [enquiries, comments, agents, syncState]);

  return {
    enquiries, setEnquiries,
    comments, setComments,
    agents,
    currentAgent,
    loaded,
    syncState,
    addEnquiry,
    updateEnquiry,
    deleteEnquiry,
    addComment,
  };
}
