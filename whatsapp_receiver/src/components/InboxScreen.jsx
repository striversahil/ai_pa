import React, { useState, useEffect } from 'react';
import { 
  Mail, Sparkles, AlertTriangle, User, Loader2, 
  Copy, Check, FileText, ChevronRight, MessageSquare 
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { 
  fetchClientNames, fetchEmailsForClient, 
  aiGenerateEmailSummary, isRealMode 
} from '../utils/api';

export default function InboxScreen() {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  
  // AI summary states
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  
  // Active email modal
  const [activeEmail, setActiveEmail] = useState(null);

  useEffect(() => {
    loadClients();
  }, []);

  async function loadClients() {
    try {
      const clientList = await fetchClientNames();
      setClients(clientList);
      if (clientList.length > 0) {
        setSelectedClient(clientList[0]);
      }
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (selectedClient) {
      loadEmails();
      // Reset AI summary when changing clients
      setAiSummary(null);
    }
  }, [selectedClient]);

  async function loadEmails() {
    setEmailsLoading(true);
    try {
      const data = await fetchEmailsForClient(selectedClient);
      setEmails(data);
    } catch (e) {
      console.error(e);
    } finally {
      setEmailsLoading(false);
    }
  }

  async function runAiAnalysis() {
    if (emails.length === 0) return;
    setAiLoading(true);
    try {
      const analysis = await aiGenerateEmailSummary(selectedClient, emails);
      setAiSummary(analysis);
      
      // Joyful feedback on completion
      confetti({
        particleCount: 40,
        angle: 120,
        spread: 60,
        origin: { x: 1 },
        colors: ['#a855f7', '#6366f1', '#10b981']
      });
    } catch (e) {
      console.error(e);
    } finally {
      setAiLoading(false);
    }
  }

  function handleCopyReply() {
    if (!aiSummary?.replyDraft) return;
    navigator.clipboard.writeText(aiSummary.replyDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function getSentimentColor(sentiment) {
    switch(sentiment?.toLowerCase()) {
      case 'positive': return '#10b981'; // Green
      case 'neutral': return '#3b82f6'; // Blue
      case 'urgent': return '#f59e0b'; // Amber
      case 'frustrated': return '#ef4444'; // Red
      default: return '#94a3b8';
    }
  }

  return (
    <div className="inbox-container fade-in">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Client Email summaries</h1>
          <p className="screen-subtitle">Select a client to view incoming email correspondence and generate AI executive summaries.</p>
        </div>
      </div>

      {/* Selector Area */}
      <div className="selector-panel glass-panel">
        <div className="client-select-wrapper">
          <User size={18} className="text-secondary" />
          <label className="select-label">Select Client / Party:</label>
          <select 
            className="glass-input client-dropdown"
            value={selectedClient}
            onChange={(e) => setSelectedClient(e.target.value)}
          >
            {clients.length === 0 ? (
              <option value="">No clients found...</option>
            ) : (
              clients.map(c => <option key={c} value={c}>{c}</option>)
            )}
          </select>
        </div>
        
        {selectedClient && emails.length > 0 && (
          <button 
            className="btn btn-primary"
            onClick={runAiAnalysis}
            disabled={aiLoading || emailsLoading}
          >
            {aiLoading ? (
              <>
                <Loader2 className="animate-spin" size={16} /> Generating AI Summary...
              </>
            ) : (
              <>
                <Sparkles size={16} /> Summarize with Groq AI
              </>
            )}
          </button>
        )}
      </div>

      {/* Screen Split Layout */}
      <div className="inbox-grid">
        {/* Left Side: Email List */}
        <div className="email-list-panel glass-panel">
          <div className="panel-header">
            <Mail size={16} className="text-secondary" />
            <h3 className="panel-title">Inbox Emails ({emails.length})</h3>
          </div>

          {emailsLoading ? (
            <div className="shimmer-list">
              {[1, 2, 3].map(n => (
                <div key={n} className="shimmer-item glass-panel">
                  <div className="skeleton-shimmer shimmer-sender" />
                  <div className="skeleton-shimmer shimmer-subject" />
                  <div className="skeleton-shimmer shimmer-snippet" />
                </div>
              ))}
            </div>
          ) : emails.length === 0 ? (
            <div className="empty-panel-state">
              <Mail size={40} className="text-muted" />
              <p>No email history found for this client.</p>
            </div>
          ) : (
            <div className="email-cards-container">
              {emails.map(email => (
                <div 
                  key={email.id} 
                  className="email-card glass-panel"
                  onClick={() => setActiveEmail(email)}
                >
                  <div className="email-card-header">
                    <span className="email-sender-name">{email.sender.split('<')[0].trim()}</span>
                    <span className={`badge badge-${email.category?.toLowerCase() || 'general'}`}>
                      {email.category || 'General'}
                    </span>
                  </div>
                  <h4 className="email-card-subject">{email.subject}</h4>
                  <p className="email-card-snippet">{email.snippet}</p>
                  <div className="email-card-footer">
                    <span>{new Date(email.received_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    <span className="view-more-link">Read full <ChevronRight size={14} /></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Side: AI Analyzer output */}
        <div className="ai-summary-panel glass-panel">
          <div className="panel-header">
            <Sparkles size={16} className="text-accent-secondary" />
            <h3 className="panel-title">AI Summary & Action items</h3>
            {!isRealMode() && aiSummary && (
              <span className="demo-notice">Mock Output</span>
            )}
          </div>

          {aiLoading ? (
            <div className="ai-loading-container">
              <Loader2 className="animate-spin text-accent-primary" size={42} />
              <h4>Analyzing conversation threads...</h4>
              <p>Groq AI is reviewing client requirements, sentiments, and drafting standard replies.</p>
              <div className="loading-shimmer-card">
                <div className="skeleton-shimmer shimmer-line-1" />
                <div className="skeleton-shimmer shimmer-line-2" />
                <div className="skeleton-shimmer shimmer-line-3" />
              </div>
            </div>
          ) : !aiSummary ? (
            <div className="ai-empty-state">
              <Sparkles size={48} className="text-muted pulse" />
              <h3>Awaiting AI Trigger</h3>
              <p>Select a client and click "Summarize with Groq AI" to analyze emails, generate tasks, and draft answers.</p>
            </div>
          ) : (
            <div className="ai-output-container">
              {/* Executive Summary */}
              <div className="ai-section">
                <h4 className="ai-section-title">
                  <FileText size={16} /> Executive Summary
                </h4>
                <p className="ai-summary-text">{aiSummary.executiveSummary}</p>
              </div>

              {/* Sentiment Gauge */}
              <div className="ai-section">
                <h4 className="ai-section-title">
                  <AlertTriangle size={16} /> Sentiment Analysis
                </h4>
                <div className="sentiment-display">
                  <span 
                    className="sentiment-pill"
                    style={{ 
                      backgroundColor: `${getSentimentColor(aiSummary.sentiment)}15`,
                      color: getSentimentColor(aiSummary.sentiment),
                      borderColor: `${getSentimentColor(aiSummary.sentiment)}30`
                    }}
                  >
                    {aiSummary.sentiment}
                  </span>
                  <div className="sentiment-bar-bg">
                    <div 
                      className="sentiment-bar-fill" 
                      style={{ 
                        backgroundColor: getSentimentColor(aiSummary.sentiment),
                        width: aiSummary.sentiment?.toLowerCase() === 'urgent' || aiSummary.sentiment?.toLowerCase() === 'frustrated' ? '90%' : 
                               aiSummary.sentiment?.toLowerCase() === 'positive' ? '70%' : '50%'
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Action Items Checklist */}
              <div className="ai-section">
                <h4 className="ai-section-title">
                  <Check size={16} /> Recommended Action Items
                </h4>
                <ul className="action-checklist">
                  {aiSummary.actionItems?.map((item, idx) => (
                    <li key={idx} className="checklist-item">
                      <input type="checkbox" className="custom-checkbox" id={`ai-check-${idx}`} />
                      <label htmlFor={`ai-check-${idx}`}>{item}</label>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Suggested Reply Draft */}
              <div className="ai-section reply-section">
                <div className="reply-header">
                  <h4 className="ai-section-title">
                    <MessageSquare size={16} /> Draft Reply Recommendation
                  </h4>
                  <button className="btn btn-secondary btn-copy" onClick={handleCopyReply}>
                    {copied ? (
                      <><Check size={14} className="text-status-quoted" /> Copied</>
                    ) : (
                      <><Copy size={14} /> Copy</>
                    )}
                  </button>
                </div>
                <pre className="reply-draft-box">{aiSummary.replyDraft}</pre>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Email Viewer Modal */}
      {activeEmail && (
        <div className="modal-overlay" onClick={() => setActiveEmail(null)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="email-meta-header">
                <span className={`badge badge-${activeEmail.category?.toLowerCase() || 'general'}`}>
                  {activeEmail.category}
                </span>
                <span className="email-date-stamp">
                  Received: {new Date(activeEmail.received_at).toLocaleString()}
                </span>
              </div>
              <button className="modal-close" onClick={() => setActiveEmail(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="email-modal-body">
              <h2 className="email-subject-title">{activeEmail.subject}</h2>
              <div className="email-sender-info">
                <strong>From:</strong> {activeEmail.sender}
              </div>
              <div className="email-body-content">
                {activeEmail.body.split('\n').map((para, i) => (
                  <p key={i} className="email-para">{para}</p>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setActiveEmail(null)}>
                Close Email
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Styled CSS */}
      <style>{`
        .selector-panel {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 24px;
          margin-bottom: 24px;
        }
        .client-select-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-grow: 1;
        }
        .select-label {
          font-weight: 500;
          font-size: 0.95rem;
          color: var(--text-secondary);
        }
        .client-dropdown {
          width: 320px;
        }
        
        .inbox-grid {
          display: grid;
          grid-template-columns: 4fr 5fr;
          gap: 24px;
          align-items: start;
        }
        
        /* Left Panel - Email List */
        .email-list-panel {
          padding: 20px;
          height: calc(100vh - 270px);
          display: flex;
          flex-direction: column;
        }
        .panel-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border-color);
        }
        .panel-title {
          font-size: 1.05rem;
          font-weight: 600;
          color: #fff;
          flex-grow: 1;
        }
        .demo-notice {
          font-size: 0.7rem;
          background: rgba(139, 92, 246, 0.15);
          color: #c084fc;
          border: 1px solid rgba(139, 92, 246, 0.3);
          padding: 2px 6px;
          border-radius: 4px;
        }
        
        .email-cards-container {
          overflow-y: auto;
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding-right: 4px;
        }
        .email-card {
          padding: 14px;
          background: rgba(15, 23, 42, 0.3);
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .email-card:hover {
          transform: translateY(-2px);
          background: rgba(255, 255, 255, 0.02);
          border-color: var(--accent-primary);
        }
        .email-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .email-sender-name {
          font-weight: 600;
          font-size: 0.85rem;
          color: var(--text-primary);
        }
        .email-card-subject {
          font-size: 0.95rem;
          font-weight: 500;
          color: #fff;
          margin-bottom: 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .email-card-snippet {
          font-size: 0.85rem;
          color: var(--text-secondary);
          margin-bottom: 10px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .email-card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .view-more-link {
          display: flex;
          align-items: center;
          gap: 2px;
          color: var(--accent-primary);
          font-weight: 500;
        }
        
        /* Right Panel - AI Summary output */
        .ai-summary-panel {
          padding: 20px;
          height: calc(100vh - 270px);
          overflow-y: auto;
        }
        .ai-empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 80%;
          text-align: center;
          gap: 12px;
          color: var(--text-secondary);
          padding: 20px;
        }
        .ai-empty-state h3 {
          color: #fff;
        }
        
        .ai-loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 80%;
          gap: 16px;
          text-align: center;
          color: var(--text-secondary);
          padding: 20px;
        }
        .ai-loading-container h4 {
          color: #fff;
        }
        .loading-shimmer-card {
          width: 100%;
          max-width: 340px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 14px;
        }
        .shimmer-line-1, .shimmer-line-2, .shimmer-line-3 {
          height: 12px;
          width: 100%;
        }
        .shimmer-line-2 { width: 85%; }
        .shimmer-line-3 { width: 60%; }
        
        .ai-output-container {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .ai-section {
          background: rgba(10, 15, 30, 0.4);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 16px;
        }
        .ai-section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.9rem;
          font-weight: 600;
          color: #c084fc;
          margin-bottom: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .ai-summary-text {
          font-size: 0.95rem;
          line-height: 1.6;
          color: var(--text-primary);
        }
        
        /* Sentiment bar elements */
        .sentiment-display {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .sentiment-pill {
          font-size: 0.8rem;
          font-weight: 700;
          text-transform: uppercase;
          padding: 4px 12px;
          border-radius: 9999px;
          border: 1px solid;
          letter-spacing: 0.05em;
        }
        .sentiment-bar-bg {
          flex-grow: 1;
          height: 6px;
          background: rgba(255,255,255,0.05);
          border-radius: 3px;
          overflow: hidden;
        }
        .sentiment-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.3s ease;
        }
        
        /* Action checklists */
        .action-checklist {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .checklist-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }
        .custom-checkbox {
          cursor: pointer;
          width: 16px;
          height: 16px;
          accent-color: var(--accent-primary);
          margin-top: 3px;
        }
        .checklist-item label {
          font-size: 0.9rem;
          color: var(--text-secondary);
          line-height: 1.4;
          cursor: pointer;
        }
        .custom-checkbox:checked + label {
          color: var(--text-muted);
          text-decoration: line-through;
        }
        
        /* Reply box draft styling */
        .reply-section {
          background: rgba(99, 102, 241, 0.05);
          border-color: rgba(99, 102, 241, 0.15);
        }
        .reply-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .btn-copy {
          padding: 6px 12px;
          font-size: 0.8rem;
        }
        .reply-draft-box {
          font-family: 'Courier New', Courier, monospace;
          background: rgba(10, 15, 30, 0.6);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 14px;
          font-size: 0.85rem;
          line-height: 1.5;
          color: #e2e8f0;
          white-space: pre-wrap;
          word-break: break-all;
          max-height: 200px;
          overflow-y: auto;
        }
        
        /* Shimmer effects */
        .shimmer-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .shimmer-item {
          padding: 14px;
          background: rgba(15,23,42,0.2);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .shimmer-sender {
          height: 12px;
          width: 40%;
        }
        .shimmer-subject {
          height: 14px;
          width: 75%;
        }
        .shimmer-snippet {
          height: 12px;
          width: 95%;
        }
        
        /* Email Viewer Modal overrides */
        .email-meta-header {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .email-date-stamp {
          font-size: 0.8rem;
          color: var(--text-muted);
        }
        .email-modal-body {
          margin-top: 10px;
        }
        .email-subject-title {
          font-size: 1.4rem;
          font-weight: 700;
          color: #fff;
          margin-bottom: 8px;
        }
        .email-sender-info {
          font-size: 0.9rem;
          color: var(--text-secondary);
          padding-bottom: 14px;
          border-bottom: 1px solid var(--border-color);
          margin-bottom: 16px;
        }
        .email-body-content {
          font-size: 0.95rem;
          line-height: 1.6;
          color: #e2e8f0;
          max-height: 300px;
          overflow-y: auto;
          background: rgba(0,0,0,0.15);
          padding: 16px;
          border-radius: 8px;
        }
        .email-para {
          margin-bottom: 12px;
        }
        .email-para:last-child {
          margin-bottom: 0;
        }
      `}</style>
    </div>
  );
}
