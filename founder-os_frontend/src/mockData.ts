import type { Agent, Activity, Comment, Enquiry, StoredData } from './types';
import { INITIAL_AGENTS, INITIAL_ENQUIRIES, INITIAL_COMMENTS } from './types';
export type { Agent, Activity, Enquiry, Comment, StoredData } from './types';
export { INITIAL_AGENTS, INITIAL_ENQUIRIES, INITIAL_COMMENTS } from './types';

export function getStoredData(): StoredData {
  if (typeof window === "undefined") {
    return { enquiries: INITIAL_ENQUIRIES, comments: INITIAL_COMMENTS, agents: INITIAL_AGENTS };
  }
  try {
    const data = localStorage.getItem("brindavan_enquiry_tracker_db");
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed.enquiries && parsed.comments && parsed.agents) return parsed;
    }
  } catch (error) {
    console.error("Failed to load data from localStorage", error);
  }
  const initialData = { enquiries: INITIAL_ENQUIRIES, comments: INITIAL_COMMENTS, agents: INITIAL_AGENTS };
  saveToStorage(initialData.enquiries, initialData.comments, initialData.agents);
  return initialData;
}

export function saveToStorage(enquiries: Enquiry[], comments: Comment[], agents: Agent[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("brindavan_enquiry_tracker_db", JSON.stringify({ enquiries, comments, agents }));
  } catch (error) {
    console.error("Failed to save data to localStorage", error);
  }
}