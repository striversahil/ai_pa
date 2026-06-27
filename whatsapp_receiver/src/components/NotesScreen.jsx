import React, { useState, useEffect } from 'react';
import { 
  Search, Plus, Tag, Trash2, Sparkles, CheckSquare, 
  Square, Calendar, Loader2, Copy, Check, Eye 
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { 
  fetchNotes, createNote, updateNote, 
  deleteNote, aiEnhanceNote, isRealMode 
} from '../utils/api';

export default function NotesScreen() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Note Form state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  
  // AI assist state
  const [aiEnhancing, setAiEnhancing] = useState(false);
  const [aiEnhancedResult, setAiEnhancedResult] = useState(null); // { suggestedTitle, tags, checklist }
  
  // Feedback copy
  const [copiedId, setCopiedId] = useState(null);
  // Detailed note viewer modal
  const [viewingNote, setViewingNote] = useState(null);

  useEffect(() => {
    loadNotes();
  }, []);

  async function loadNotes() {
    setLoading(true);
    try {
      const data = await fetchNotes();
      setNotes(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  // Handle note submission
  async function handleAddNote(e) {
    if (e) e.preventDefault();
    if (!content.trim()) {
      alert('Note content cannot be empty.');
      return;
    }

    const tagsArray = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const notePayload = {
      title: title.trim() || 'Untitled Note',
      content: content.trim(),
      tags: tagsArray,
      checklist: [] // Default empty checklist
    };

    try {
      const created = await createNote(notePayload);
      setNotes(prev => [created, ...prev]);
      
      // Reset inputs
      setTitle('');
      setContent('');
      setTagsInput('');
      setAiEnhancedResult(null);

      confetti({
        particleCount: 35,
        spread: 50,
        origin: { y: 0.85 },
        colors: ['#6366f1', '#10b981']
      });
    } catch (e) {
      console.error(e);
    }
  }

  // Enhance note with Groq AI
  async function triggerAiEnhance() {
    if (!content.trim()) {
      alert('Please write some content first so the AI can analyze it.');
      return;
    }
    setAiEnhancing(true);
    setAiEnhancedResult(null);
    try {
      const enhanced = await aiEnhanceNote(title, content);
      setAiEnhancedResult(enhanced);
      
      confetti({
        particleCount: 20,
        spread: 40,
        colors: ['#c084fc', '#8b5cf6']
      });
    } catch (e) {
      console.error(e);
    } finally {
      setAiEnhancing(false);
    }
  }

  // Apply AI enhancements to form
  function applyAiEnhancement() {
    if (!aiEnhancedResult) return;
    if (aiEnhancedResult.suggestedTitle) {
      setTitle(aiEnhancedResult.suggestedTitle);
    }
    if (aiEnhancedResult.tags && aiEnhancedResult.tags.length > 0) {
      setTagsInput(aiEnhancedResult.tags.join(', '));
    }
    
    // Auto-submit note with the AI check-list appended or embedded
    const notePayload = {
      title: aiEnhancedResult.suggestedTitle || title || 'AI-Enhanced Quick Note',
      content: content.trim(),
      tags: aiEnhancedResult.tags || [],
      checklist: aiEnhancedResult.checklist || []
    };

    saveNoteDirectly(notePayload);
  }

  async function saveNoteDirectly(payload) {
    try {
      const created = await createNote(payload);
      setNotes(prev => [created, ...prev]);
      setTitle('');
      setContent('');
      setTagsInput('');
      setAiEnhancedResult(null);
      
      confetti({
        particleCount: 50,
        spread: 80,
        colors: ['#8b5cf6', '#10b981']
      });
    } catch (e) {
      console.error(e);
    }
  }

  // Delete note
  async function handleDeleteNote(id, e) {
    e.stopPropagation();
    if (window.confirm('Delete this note?')) {
      await deleteNote(id);
      setNotes(prev => prev.filter(note => note.id !== id));
    }
  }

  // Toggle checklist item within a note card
  async function toggleChecklistItem(note, itemIndex) {
    const updatedChecklist = [...(note.checklist || [])];
    const item = updatedChecklist[itemIndex];
    
    // Toggle structure (either string or object with checked flag)
    if (typeof item === 'string') {
      updatedChecklist[itemIndex] = { text: item, checked: true };
    } else {
      updatedChecklist[itemIndex] = { ...item, checked: !item.checked };
    }

    try {
      const updated = await updateNote(note.id, { checklist: updatedChecklist });
      if (updated) {
        setNotes(prev => prev.map(n => n.id === note.id ? updated : n));
      } else {
        setNotes(prev => prev.map(n => n.id === note.id ? { ...n, checklist: updatedChecklist } : n));
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Copy Note text to clipboard
  function handleCopyNoteText(note, e) {
    e.stopPropagation();
    const textToCopy = `${note.title}\n\n${note.content}${
      note.checklist && note.checklist.length > 0 
        ? '\n\nChecklist:\n' + note.checklist.map((c, i) => `${c.checked ? '[x]' : '[ ]'} ${typeof c === 'string' ? c : c.text}`).join('\n')
        : ''
    }`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(note.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // Filter notes based on search query
  const filteredNotes = notes.filter(note => {
    const query = searchQuery.toLowerCase();
    const matchesTitle = note.title?.toLowerCase().includes(query);
    const matchesContent = note.content?.toLowerCase().includes(query);
    const matchesTags = note.tags?.some(tag => tag.toLowerCase().includes(query));
    return matchesTitle || matchesContent || matchesTags;
  });

  return (
    <div className="notes-container fade-in">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Quick Notes Snippets</h1>
          <p className="screen-subtitle">Create and organize reference snippets, thoughts, and tasks with smart AI enhancements.</p>
        </div>
      </div>

      <div className="notes-layout">
        {/* Left Side: Create Note Form */}
        <div className="create-note-panel glass-panel">
          <div className="panel-header">
            <Plus size={16} className="text-secondary" />
            <h3 className="panel-title">New Note</h3>
          </div>

          <form onSubmit={handleAddNote} className="note-form">
            <div className="form-group">
              <input 
                type="text" 
                className="glass-input note-title-input" 
                placeholder="Note Title (Optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="form-group">
              <textarea 
                className="glass-input note-content-input" 
                rows="6" 
                placeholder="Write note contents or tasks here..."
                required
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>

            <div className="form-group">
              <div className="tags-input-wrapper">
                <Tag size={14} className="text-muted" />
                <input 
                  type="text" 
                  className="tags-sub-input" 
                  placeholder="Tags (comma separated, e.g. Billing, FollowUp)"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                />
              </div>
            </div>

            {/* AI Assistant Output Card in Form */}
            {aiEnhancedResult && (
              <div className="ai-preview-card glass-panel fade-in">
                <div className="ai-preview-header">
                  <Sparkles size={14} className="text-accent-secondary animate-pulse" />
                  <span className="ai-preview-title">Groq AI Enhancements</span>
                </div>
                <div className="ai-preview-body">
                  <p className="ai-preview-meta">
                    <strong>Suggested Title:</strong> {aiEnhancedResult.suggestedTitle}
                  </p>
                  <p className="ai-preview-meta">
                    <strong>Suggested Tags:</strong> {aiEnhancedResult.tags?.map(t => `#${t}`).join(', ') || 'None'}
                  </p>
                  {aiEnhancedResult.checklist && aiEnhancedResult.checklist.length > 0 && (
                    <div className="ai-preview-checklist">
                      <strong>Extracted Tasks:</strong>
                      <ul>
                        {aiEnhancedResult.checklist.map((chk, idx) => (
                          <li key={idx}>- {typeof chk === 'string' ? chk : chk.text}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <button 
                  type="button" 
                  className="btn btn-primary btn-apply-ai"
                  onClick={applyAiEnhancement}
                >
                  Apply & Save Note
                </button>
              </div>
            )}

            <div className="form-buttons">
              <button 
                type="button" 
                className={`btn btn-secondary ${aiEnhancing ? 'pulse' : ''}`}
                onClick={triggerAiEnhance}
                disabled={aiEnhancing}
                title="Use Groq to generate title, tags & action items"
              >
                {aiEnhancing ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Sparkles size={16} className="text-accent-secondary" />
                )}
                AI Auto-Tag
              </button>
              <button type="submit" className="btn btn-primary">
                Save Note
              </button>
            </div>
          </form>
        </div>

        {/* Right Side: Notes List and Search */}
        <div className="notes-list-panel">
          {/* Search bar */}
          <div className="search-bar-wrapper glass-panel">
            <Search size={18} className="text-secondary" />
            <input 
              type="text" 
              className="search-input" 
              placeholder="Search notes by title, content, or tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear-btn" onClick={() => setSearchQuery('')}>
                <X size={16} />
              </button>
            )}
          </div>

          {/* Notes Grid */}
          {loading ? (
            <div className="notes-loader">
              <Loader2 className="animate-spin text-accent-secondary" size={32} />
              <p>Loading quick notes...</p>
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="notes-empty-state glass-panel">
              <Search size={40} className="text-muted" />
              <h4>No notes found</h4>
              <p>{searchQuery ? 'Try matching a different keyword.' : 'Write a note on the left to start your snippet library.'}</p>
            </div>
          ) : (
            <div className="notes-grid">
              {filteredNotes.map(note => (
                <div 
                  key={note.id} 
                  className="note-card glass-panel"
                  onClick={() => setViewingNote(note)}
                >
                  <div className="note-card-header">
                    <h4 className="note-card-title">{note.title}</h4>
                    <div className="note-actions">
                      <button 
                        className="note-action-btn" 
                        onClick={(e) => handleCopyNoteText(note, e)}
                        title="Copy note content"
                      >
                        {copiedId === note.id ? <Check size={14} className="text-status-quoted" /> : <Copy size={14} />}
                      </button>
                      <button 
                        className="note-action-btn delete" 
                        onClick={(e) => handleDeleteNote(note.id, e)}
                        title="Delete note"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  
                  <p className="note-card-content">{note.content}</p>
                  
                  {/* Checklist render */}
                  {note.checklist && note.checklist.length > 0 && (
                    <div className="note-checklist-section" onClick={e => e.stopPropagation()}>
                      <div className="note-checklist-header">
                        <CheckSquare size={12} />
                        <span>Tasks</span>
                      </div>
                      <div className="note-checklist-items">
                        {note.checklist.map((item, index) => {
                          const isChecked = typeof item === 'string' ? false : !!item.checked;
                          const text = typeof item === 'string' ? item : item.text;
                          return (
                            <div 
                              key={index} 
                              className={`note-checklist-row ${isChecked ? 'completed' : ''}`}
                              onClick={() => toggleChecklistItem(note, index)}
                            >
                              {isChecked ? (
                                <CheckSquare size={13} className="text-accent-primary" />
                              ) : (
                                <Square size={13} />
                              )}
                              <span className="checklist-item-text">{text}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="note-card-footer">
                    <div className="note-tags">
                      {note.tags?.map((tag, idx) => (
                        <span key={idx} className="note-tag-pill">#{tag}</span>
                      ))}
                    </div>
                    <span className="note-date">
                      {new Date(note.created_at).toLocaleDateString([], {month: 'short', day: 'numeric'})}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Note Detail Modal */}
      {viewingNote && (
        <div className="modal-overlay" onClick={() => setViewingNote(null)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title font-semibold">{viewingNote.title}</h2>
              <button className="modal-close" onClick={() => setViewingNote(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="note-modal-body">
              <div className="note-modal-scroll">
                <p className="note-modal-content-text">{viewingNote.content}</p>
                
                {viewingNote.checklist && viewingNote.checklist.length > 0 && (
                  <div className="note-modal-checklist-wrapper">
                    <h4 className="note-modal-subheading">Action Checklist</h4>
                    <div className="note-modal-checklist-list">
                      {viewingNote.checklist.map((item, index) => {
                        const isChecked = typeof item === 'string' ? false : !!item.checked;
                        const text = typeof item === 'string' ? item : item.text;
                        return (
                          <div 
                            key={index} 
                            className={`note-modal-checklist-row ${isChecked ? 'completed' : ''}`}
                            onClick={() => toggleChecklistItem(viewingNote, index)}
                          >
                            {isChecked ? (
                              <CheckSquare size={16} className="text-accent-primary" />
                            ) : (
                              <Square size={16} />
                            )}
                            <span>{text}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer note-modal-footer">
              <div className="note-modal-tags">
                {viewingNote.tags?.map((tag, idx) => (
                  <span key={idx} className="note-tag-pill">#{tag}</span>
                ))}
              </div>
              <button className="btn btn-secondary" onClick={() => setViewingNote(null)}>
                Close Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Embedded CSS */}
      <style>{`
        .notes-layout {
          display: grid;
          grid-template-columns: 2fr 3fr;
          gap: 24px;
          align-items: start;
        }
        
        /* Left: Create Note Form */
        .create-note-panel {
          padding: 20px;
        }
        .note-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .note-title-input {
          font-weight: 600;
          font-size: 1rem;
        }
        .note-content-input {
          resize: vertical;
          min-height: 120px;
          font-size: 0.95rem;
          line-height: 1.5;
        }
        .tags-input-wrapper {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(15, 22, 38, 0.6);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 10px 14px;
        }
        .tags-sub-input {
          border: none;
          background: transparent;
          color: var(--text-primary);
          outline: none;
          font-family: var(--font-sans);
          font-size: 0.9rem;
          flex-grow: 1;
        }
        
        .form-buttons {
          display: flex;
          justify-content: space-between;
          gap: 12px;
        }
        .form-buttons button {
          flex: 1;
        }
        
        /* AI Assistant Preview Panel */
        .ai-preview-card {
          padding: 14px;
          background: rgba(139, 92, 246, 0.04);
          border-color: rgba(139, 92, 246, 0.2);
        }
        .ai-preview-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
        }
        .ai-preview-title {
          font-size: 0.8rem;
          font-weight: 600;
          color: #c084fc;
          text-transform: uppercase;
        }
        .ai-preview-body {
          font-size: 0.85rem;
          color: var(--text-secondary);
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 12px;
        }
        .ai-preview-meta strong {
          color: var(--text-primary);
        }
        .ai-preview-checklist {
          margin-top: 4px;
        }
        .ai-preview-checklist ul {
          margin-left: 14px;
          list-style: none;
          margin-top: 2px;
          color: var(--text-muted);
        }
        .btn-apply-ai {
          width: 100%;
          padding: 6px 12px;
          font-size: 0.8rem;
        }
        
        /* Right: Search and Notes Grid */
        .notes-list-panel {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .search-bar-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 18px;
        }
        .search-input {
          border: none;
          background: transparent;
          color: var(--text-primary);
          outline: none;
          font-family: var(--font-sans);
          font-size: 0.95rem;
          flex-grow: 1;
        }
        .search-clear-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
        }
        
        .notes-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          max-height: calc(100vh - 230px);
          overflow-y: auto;
          padding-right: 4px;
        }
        
        .notes-empty-state, .notes-loader {
          padding: 50px 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 12px;
          color: var(--text-secondary);
        }
        .notes-empty-state h4 {
          color: #fff;
        }
        
        /* Note Card styling */
        .note-card {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          cursor: pointer;
          min-height: 180px;
          max-height: 280px;
          overflow: hidden;
        }
        .note-card:hover {
          transform: translateY(-2px);
          border-color: var(--accent-primary);
        }
        .note-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
        }
        .note-card-title {
          font-size: 1rem;
          font-weight: 600;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .note-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .note-action-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          transition: color 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .note-action-btn:hover {
          color: #fff;
        }
        .note-action-btn.delete:hover {
          color: #ef4444;
        }
        .note-card-content {
          font-size: 0.88rem;
          color: var(--text-secondary);
          line-height: 1.5;
          display: -webkit-box;
          -webkit-line-clamp: 4;
          -webkit-box-orient: vertical;
          overflow: hidden;
          flex-grow: 1;
        }
        
        /* Notes checklist box inside card */
        .note-checklist-section {
          background: rgba(10, 15, 30, 0.4);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 8px 10px;
          margin-top: 4px;
        }
        .note-checklist-header {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .note-checklist-items {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 80px;
          overflow-y: auto;
        }
        .note-checklist-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.8rem;
          color: var(--text-secondary);
          cursor: pointer;
        }
        .note-checklist-row.completed {
          color: var(--text-muted);
          text-decoration: line-through;
        }
        .checklist-item-text {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .note-card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.75rem;
          color: var(--text-muted);
          border-top: 1px solid var(--border-color);
          padding-top: 10px;
          margin-top: auto;
        }
        .note-tags {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          max-width: 70%;
        }
        .note-tag-pill {
          background: rgba(99, 102, 241, 0.08);
          color: #a5b4fc;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.7rem;
        }
        
        /* Note view modal */
        .note-modal-body {
          margin-top: 10px;
        }
        .note-modal-scroll {
          max-height: 350px;
          overflow-y: auto;
          padding-right: 6px;
        }
        .note-modal-content-text {
          font-size: 1rem;
          line-height: 1.6;
          color: #e2e8f0;
          white-space: pre-wrap;
          word-break: break-word;
        }
        
        .note-modal-checklist-wrapper {
          margin-top: 20px;
          border-top: 1px solid var(--border-color);
          padding-top: 16px;
        }
        .note-modal-subheading {
          font-size: 0.9rem;
          font-weight: 600;
          color: #c084fc;
          margin-bottom: 12px;
          text-transform: uppercase;
        }
        .note-modal-checklist-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .note-modal-checklist-row {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 0.95rem;
          color: var(--text-primary);
          cursor: pointer;
        }
        .note-modal-checklist-row.completed {
          color: var(--text-muted);
          text-decoration: line-through;
        }
        .note-modal-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .note-modal-tags {
          display: flex;
          gap: 8px;
        }
      `}</style>
    </div>
  );
}
