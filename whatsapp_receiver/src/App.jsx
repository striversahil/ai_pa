import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Mail, FileText, Settings, 
  Sparkles, Check, Database, Copy, Key, ShieldAlert, X
} from 'lucide-react';
import DashboardScreen from './components/DashboardScreen';
import InboxScreen from './components/InboxScreen';
import NotesScreen from './components/NotesScreen';
import { getCredentials, saveCredentials, isRealMode } from './utils/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [creds, setCreds] = useState({ supabaseUrl: '', supabaseKey: '', groqKey: '' });
  const [saveFeedback, setSaveFeedback] = useState(false);
  const [copiedSql, setCopiedSql] = useState('');

  useEffect(() => {
    // Load credentials on mount
    setCreds(getCredentials());
  }, []);

  const handleSave = (e) => {
    e.preventDefault();
    saveCredentials(creds.supabaseUrl, creds.supabaseKey, creds.groqKey);
    setSaveFeedback(true);
    setTimeout(() => {
      setSaveFeedback(false);
      // Automatically redirect to Dashboard after saving
      setActiveTab('dashboard');
    }, 1200);
  };

  const handleClear = () => {
    if (window.confirm('Reset all keys and return to Local Storage offline mode?')) {
      saveCredentials('', '', '');
      setCreds({ supabaseUrl: '', supabaseKey: '', groqKey: '' });
      setActiveTab('dashboard');
    }
  };

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedSql(key);
    setTimeout(() => setCopiedSql(''), 2000);
  };

  // SQL schema templates
  const enquiriesSql = `CREATE TABLE enquiries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  enquiry text NOT NULL,
  party_name text NOT NULL,
  product_quoted text,
  image_url text,
  action_status text DEFAULT 'Pending',
  estimate_name text,
  estimate_comment text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS and add public access policies
ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON enquiries FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON enquiries FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON enquiries FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete" ON enquiries FOR DELETE USING (true);`;

  const emailsSql = `CREATE TABLE emails (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_name text NOT NULL,
  sender text NOT NULL,
  subject text NOT NULL,
  snippet text,
  body text NOT NULL,
  category text DEFAULT 'General',
  received_at timestamptz DEFAULT now()
);

ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON emails FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON emails FOR INSERT WITH CHECK (true);`;

  const notesSql = `CREATE TABLE notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text,
  content text NOT NULL,
  tags text[] DEFAULT '{}'::text[],
  checklist jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON notes FOR SELECT USING (true);
CREATE POLICY "Allow public write" ON notes FOR ALL USING (true);`;

  return (
    <div className="app-container">
      {/* Sidebar Layout */}
      <aside className="app-sidebar glass-panel">
        <div className="sidebar-header">
          <div className="logo-icon">
            <Sparkles size={20} className="logo-sparkle" />
          </div>
          <div>
            <h2 className="logo-title">Antigravity PA</h2>
            <span className="logo-subtitle">Personal Assistant v1.0</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button 
            className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutDashboard size={18} />
            <span>PA Dashboard</span>
          </button>
          
          <button 
            className={`nav-link ${activeTab === 'inbox' ? 'active' : ''}`}
            onClick={() => setActiveTab('inbox')}
          >
            <Mail size={18} />
            <span>Email Summaries</span>
          </button>

          <button 
            className={`nav-link ${activeTab === 'notes' ? 'active' : ''}`}
            onClick={() => setActiveTab('notes')}
          >
            <FileText size={18} />
            <span>Quick Notes</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          {/* Status Indicator */}
          <div className={`status-pill ${isRealMode() ? 'active' : 'inactive'}`}>
            <span className="status-dot"></span>
            <span>{isRealMode() ? 'Supabase Online' : 'Mock/Offline Mode'}</span>
          </div>

          <button 
            className={`nav-link settings-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={18} />
            <span>Connection Settings</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-viewport">
        {activeTab === 'dashboard' && <DashboardScreen />}
        {activeTab === 'inbox' && <InboxScreen />}
        {activeTab === 'notes' && <NotesScreen />}
        
        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="settings-container fade-in">
            <div className="screen-header">
              <div>
                <h1 className="screen-title">System Integration Settings</h1>
                <p className="screen-subtitle">Connect your personal assistant dashboard directly to Supabase and Groq AI Cloud APIs.</p>
              </div>
            </div>

            <div className="settings-grid">
              {/* Form card */}
              <div className="settings-card glass-panel">
                <div className="card-header">
                  <Database size={18} className="text-accent-primary" />
                  <h3 className="card-title">API Key Configurations</h3>
                </div>

                <form onSubmit={handleSave} className="settings-form">
                  <div className="form-group">
                    <label className="form-label">Supabase Project URL</label>
                    <input 
                      type="url" 
                      className="glass-input" 
                      placeholder="https://your-project-id.supabase.co"
                      value={creds.supabaseUrl}
                      onChange={(e) => setCreds(prev => ({ ...prev, supabaseUrl: e.target.value }))}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Supabase Anon Public API Key</label>
                    <div className="input-key-wrapper">
                      <Key size={14} className="text-muted" />
                      <input 
                        type="password" 
                        className="key-sub-input" 
                        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                        value={creds.supabaseKey}
                        onChange={(e) => setCreds(prev => ({ ...prev, supabaseKey: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Groq Cloud API Key</label>
                    <div className="input-key-wrapper">
                      <Key size={14} className="text-muted" />
                      <input 
                        type="password" 
                        className="key-sub-input" 
                        placeholder="gsk_lV..."
                        value={creds.groqKey}
                        onChange={(e) => setCreds(prev => ({ ...prev, groqKey: e.target.value }))}
                      />
                    </div>
                    <span className="field-hint">Required to enable live email summarization and automated note tagging.</span>
                  </div>

                  <div className="settings-actions">
                    <button 
                      type="button" 
                      className="btn btn-secondary"
                      onClick={handleClear}
                      disabled={!creds.supabaseUrl && !creds.supabaseKey && !creds.groqKey}
                    >
                      Reset Credentials
                    </button>
                    
                    <button type="submit" className="btn btn-primary">
                      {saveFeedback ? (
                        <>
                          <Check size={16} /> Saved!
                        </>
                      ) : 'Save Connection Details'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Helper SQL Schema Card */}
              <div className="sql-helper-card glass-panel">
                <div className="card-header">
                  <ShieldAlert size={18} className="text-accent-secondary" />
                  <h3 className="card-title">Supabase Database Setup SQL</h3>
                </div>
                <div className="sql-scroll-container">
                  <p className="sql-hint-text">
                    Copy and run these SQL statements in your Supabase SQL Editor to initialize the target tables:
                  </p>

                  {/* Enquiry Table SQL */}
                  <div className="sql-box-wrapper">
                    <div className="sql-box-header">
                      <span>1. Enquiries Table SQL</span>
                      <button 
                        className="btn-copy-sql" 
                        onClick={() => copyToClipboard(enquiriesSql, 'enquiries')}
                      >
                        {copiedSql === 'enquiries' ? <Check size={12} /> : <Copy size={12} />}
                        {copiedSql === 'enquiries' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre className="sql-code">
                      {enquiriesSql}
                    </pre>
                  </div>

                  {/* Emails Table SQL */}
                  <div className="sql-box-wrapper">
                    <div className="sql-box-header">
                      <span>2. Client Emails Table SQL</span>
                      <button 
                        className="btn-copy-sql" 
                        onClick={() => copyToClipboard(emailsSql, 'emails')}
                      >
                        {copiedSql === 'emails' ? <Check size={12} /> : <Copy size={12} />}
                        {copiedSql === 'emails' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre className="sql-code">
                      {emailsSql}
                    </pre>
                  </div>

                  {/* Notes Table SQL */}
                  <div className="sql-box-wrapper">
                    <div className="sql-box-header">
                      <span>3. Quick Notes Table SQL</span>
                      <button 
                        className="btn-copy-sql" 
                        onClick={() => copyToClipboard(notesSql, 'notes')}
                      >
                        {copiedSql === 'notes' ? <Check size={12} /> : <Copy size={12} />}
                        {copiedSql === 'notes' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre className="sql-code">
                      {notesSql}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Styled CSS for Main structure */}
      <style>{`
        .app-sidebar {
          width: var(--sidebar-width);
          min-height: 100vh;
          border-radius: 0;
          border-left: none;
          border-top: none;
          border-bottom: none;
          padding: 24px 16px;
          display: flex;
          flex-direction: column;
          background: rgba(10, 15, 30, 0.7);
          flex-shrink: 0;
          z-index: 50;
        }
        
        .sidebar-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 36px;
        }
        .logo-icon {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: var(--accent-gradient);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
        }
        .logo-sparkle {
          color: #fff;
          animation: pulse 2s infinite ease-in-out;
        }
        .logo-title {
          font-size: 1.15rem;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.02em;
        }
        .logo-subtitle {
          font-size: 0.75rem;
          color: var(--text-muted);
          display: block;
        }
        
        .sidebar-nav {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex-grow: 1;
        }
        .nav-link {
          display: flex;
          align-items: center;
          gap: 12px;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          padding: 12px 16px;
          border-radius: 10px;
          cursor: pointer;
          font-family: var(--font-sans);
          font-weight: 500;
          font-size: 0.95rem;
          text-align: left;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .nav-link:hover {
          color: #fff;
          background: rgba(255, 255, 255, 0.04);
        }
        .nav-link.active {
          color: #fff;
          background: var(--accent-gradient);
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
        }
        
        .sidebar-footer {
          margin-top: auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding-top: 16px;
          border-top: 1px solid var(--border-color);
        }
        
        .status-pill {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.8rem;
          font-weight: 500;
          color: var(--text-secondary);
          padding: 6px 12px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 8px;
          border: 1px solid var(--border-color);
          width: fit-content;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .status-pill.active .status-dot {
          background-color: #10b981;
          box-shadow: 0 0 8px #10b981;
        }
        .status-pill.inactive .status-dot {
          background-color: var(--accent-primary);
          box-shadow: 0 0 8px var(--accent-primary);
        }
        
        .settings-btn {
          width: 100%;
        }
        
        .main-viewport {
          flex-grow: 1;
          padding: 30px;
          max-height: 100vh;
          overflow-y: auto;
          position: relative;
        }
        
        /* Settings View Page classes */
        .settings-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          align-items: start;
        }
        .settings-card, .sql-helper-card {
          padding: 24px;
        }
        .card-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 20px;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 12px;
        }
        .card-title {
          font-size: 1.1rem;
          font-weight: 600;
          color: #fff;
        }
        
        .settings-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .input-key-wrapper {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(15, 22, 38, 0.6);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 10px 14px;
        }
        .key-sub-input {
          border: none;
          background: transparent;
          color: var(--text-primary);
          outline: none;
          font-family: var(--font-sans);
          font-size: 0.95rem;
          flex-grow: 1;
        }
        .field-hint {
          font-size: 0.8rem;
          color: var(--text-muted);
          margin-top: -4px;
        }
        .settings-actions {
          display: flex;
          justify-content: space-between;
          margin-top: 10px;
        }
        
        /* SQL layout */
        .sql-scroll-container {
          max-height: calc(100vh - 250px);
          overflow-y: auto;
          padding-right: 6px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .sql-hint-text {
          font-size: 0.9rem;
          color: var(--text-secondary);
          line-height: 1.5;
        }
        .sql-box-wrapper {
          background: rgba(10, 15, 30, 0.5);
          border: 1px solid var(--border-color);
          border-radius: 10px;
          overflow: hidden;
        }
        .sql-box-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(0, 0, 0, 0.2);
          padding: 10px 16px;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border-color);
        }
        .btn-copy-sql {
          background: transparent;
          border: none;
          color: var(--accent-primary);
          cursor: pointer;
          font-weight: 500;
          font-size: 0.8rem;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .btn-copy-sql:hover {
          color: #fff;
        }
        .sql-code {
          font-family: 'Courier New', Courier, monospace;
          font-size: 0.8rem;
          padding: 14px;
          color: #cbd5e1;
          white-space: pre-wrap;
          overflow-x: auto;
          max-height: 160px;
        }
      `}</style>
    </div>
  );
}
