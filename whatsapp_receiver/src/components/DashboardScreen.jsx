import React, { useState, useEffect } from 'react';
import { 
  Plus, Trash2, Sparkles, Image as ImageIcon, 
  Calendar, Check, X, Edit3, Loader2, RefreshCw, AlertCircle
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { 
  fetchEnquiries, createEnquiry, updateEnquiry, 
  deleteEnquiry, aiGenerateEstimateComment, isRealMode 
} from '../utils/api';

export default function DashboardScreen() {
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dayFilter, setDayFilter] = useState('All');
  const [editingCell, setEditingCell] = useState(null); // { rowId, field }
  const [editValue, setEditValue] = useState('');
  const [aiGeneratingId, setAiGeneratingId] = useState(null);
  
  // Modal State for New Enquiry
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEnquiry, setNewEnquiry] = useState({
    enquiry: '',
    party_name: '',
    product_quoted: '',
    image_url: '',
    action_status: 'Pending',
    estimate_name: '',
    estimate_comment: ''
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadEnquiries();
  }, [dayFilter]);

  async function loadEnquiries() {
    setLoading(true);
    try {
      const data = await fetchEnquiries(dayFilter);
      setEnquiries(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  // Handle cell edit save
  async function saveCellEdit(rowId, field, value) {
    try {
      const updated = await updateEnquiry(rowId, { [field]: value });
      if (updated) {
        setEnquiries(prev => prev.map(item => item.id === rowId ? updated : item));
        
        // If status changed to Quoted or Closed, shoot confetti!
        if (field === 'action_status' && (value === 'Quoted' || value === 'Closed')) {
          confetti({
            particleCount: 80,
            spread: 60,
            origin: { y: 0.8 },
            colors: ['#6366f1', '#8b5cf6', '#10b981']
          });
        }
      } else {
        // Fallback update in state if matching id was modified in memory
        setEnquiries(prev => prev.map(item => {
          if (item.id === rowId) {
            return { ...item, [field]: value };
          }
          return item;
        }));
      }
    } catch (e) {
      console.error('Save failed:', e);
    }
    setEditingCell(null);
  }

  // Trigger inline input selection
  function startEditing(rowId, field, currentValue) {
    setEditingCell({ rowId, field });
    setEditValue(currentValue || '');
  }

  // Handle key press on inline input
  function handleKeyDown(e, rowId, field) {
    if (e.key === 'Enter') {
      saveCellEdit(rowId, field, editValue);
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  }

  // Handle Image Upload / Paste URL
  function handleImageChange(e, rowId) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      // Base64 representation of image
      saveCellEdit(rowId, 'image_url', reader.result);
    };
    reader.readAsDataURL(file);
  }

  // AI Estimate Comment Drafting
  async function generateComment(row) {
    if (!row.party_name || !row.product_quoted) {
      alert('Please fill in Party Name and Product Quoted first to guide the AI.');
      return;
    }
    
    setAiGeneratingId(row.id);
    try {
      const generated = await aiGenerateEstimateComment(
        row.party_name,
        row.product_quoted,
        row.estimate_name || 'Project Draft'
      );
      
      await saveCellEdit(row.id, 'estimate_comment', generated);
      
      // Fun success sparkle confetti
      confetti({
        particleCount: 30,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#a855f7', '#6366f1']
      });
    } catch (e) {
      console.error(e);
    } finally {
      setAiGeneratingId(null);
    }
  }

  // Delete Action
  async function handleDelete(id) {
    if (window.confirm('Are you sure you want to delete this enquiry?')) {
      await deleteEnquiry(id);
      setEnquiries(prev => prev.filter(item => item.id !== id));
    }
  }

  // Modal Submit (Add Enquiry)
  async function handleAddSubmit(e) {
    e.preventDefault();
    if (!newEnquiry.enquiry || !newEnquiry.party_name) {
      alert('Enquiry and Party Name are required.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createEnquiry(newEnquiry);
      setEnquiries(prev => [created, ...prev]);
      setShowAddModal(false);
      setNewEnquiry({
        enquiry: '',
        party_name: '',
        product_quoted: '',
        image_url: '',
        action_status: 'Pending',
        estimate_name: '',
        estimate_comment: ''
      });
      
      confetti({
        particleCount: 50,
        spread: 80,
        colors: ['#6366f1', '#8b5cf6']
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  // Modal image helper
  function handleModalImageChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setNewEnquiry(prev => ({ ...prev, image_url: reader.result }));
    };
    reader.readAsDataURL(file);
  }

  const statusOptions = ['Pending', 'In Progress', 'Quoted', 'Closed'];

  return (
    <div className="dashboard-container fade-in">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Personal Assistant Dashboard</h1>
          <p className="screen-subtitle">Manage customer enquiries, product quotations, and estimate comment tracking.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          <Plus size={18} /> Add Enquiry
        </button>
      </div>

      {/* Filter and Mode Status Banner */}
      <div className="filter-banner glass-panel">
        <div className="filter-left">
          <Calendar size={16} className="text-secondary" />
          <span className="filter-label">Daywise Filters:</span>
          <div className="tabs-container">
            {['All', 'Today', 'Yesterday', 'Last 7 Days'].map(filter => (
              <button 
                key={filter} 
                className={`tab-btn ${dayFilter === filter ? 'active' : ''}`}
                onClick={() => setDayFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-right">
          <span className={`mode-badge ${isRealMode() ? 'real' : 'mock'}`}>
            {isRealMode() ? 'Supabase Connected' : 'Local Storage Mode'}
          </span>
          <button className="btn-icon" onClick={loadEnquiries} title="Refresh Table">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Table Section */}
      <div className="table-wrapper glass-panel">
        {loading ? (
          <div className="table-loader">
            <Loader2 className="animate-spin text-accent-secondary" size={36} />
            <p>Loading spreadsheet records...</p>
          </div>
        ) : enquiries.length === 0 ? (
          <div className="empty-state">
            <AlertCircle size={48} className="text-muted" />
            <h3>No Records Found</h3>
            <p>No enquiries match the current date filter. Add a new enquiry to get started.</p>
          </div>
        ) : (
          <table className="custom-table">
            <thead>
              <tr>
                <th style={{ width: '25%' }}>Enquiry</th>
                <th style={{ width: '15%' }}>Party Name</th>
                <th style={{ width: '15%' }}>Product Quoted</th>
                <th style={{ width: '10%' }}>Image</th>
                <th style={{ width: '12%' }}>Action Status</th>
                <th style={{ width: '12%' }}>Estimate Name</th>
                <th style={{ width: '25%' }}>Estimate Comment</th>
                <th style={{ width: '60px' }}></th>
              </tr>
            </thead>
            <tbody>
              {enquiries.map((row) => (
                <tr key={row.id} className="table-row">
                  {/* Enquiry Cell */}
                  <td onDoubleClick={() => startEditing(row.id, 'enquiry', row.enquiry)}>
                    {editingCell?.rowId === row.id && editingCell?.field === 'enquiry' ? (
                      <textarea
                        className="table-cell-input text-area"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => saveCellEdit(row.id, 'enquiry', editValue)}
                        onKeyDown={(e) => handleKeyDown(e, row.id, 'enquiry')}
                        autoFocus
                      />
                    ) : (
                      <div className="cell-editable text-wrap">{row.enquiry || <span className="cell-placeholder">Double-click to add...</span>}</div>
                    )}
                  </td>

                  {/* Party Name Cell */}
                  <td onDoubleClick={() => startEditing(row.id, 'party_name', row.party_name)}>
                    {editingCell?.rowId === row.id && editingCell?.field === 'party_name' ? (
                      <input
                        type="text"
                        className="table-cell-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => saveCellEdit(row.id, 'party_name', editValue)}
                        onKeyDown={(e) => handleKeyDown(e, row.id, 'party_name')}
                        autoFocus
                      />
                    ) : (
                      <div className="cell-editable font-medium">{row.party_name || <span className="cell-placeholder">Add Party...</span>}</div>
                    )}
                  </td>

                  {/* Product Quoted Cell */}
                  <td onDoubleClick={() => startEditing(row.id, 'product_quoted', row.product_quoted)}>
                    {editingCell?.rowId === row.id && editingCell?.field === 'product_quoted' ? (
                      <input
                        type="text"
                        className="table-cell-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => saveCellEdit(row.id, 'product_quoted', editValue)}
                        onKeyDown={(e) => handleKeyDown(e, row.id, 'product_quoted')}
                        autoFocus
                      />
                    ) : (
                      <div className="cell-editable">{row.product_quoted || <span className="cell-placeholder">Add Product...</span>}</div>
                    )}
                  </td>

                  {/* Image Cell */}
                  <td>
                    {row.image_url ? (
                      <div className="table-img-container group">
                        <img src={row.image_url} alt="Quotation preview" className="table-thumbnail" />
                        <button 
                          className="table-img-clear" 
                          onClick={() => saveCellEdit(row.id, 'image_url', '')}
                          title="Remove Image"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="image-upload-wrapper">
                        <label className="image-upload-label">
                          <ImageIcon size={16} />
                          <span>Add</span>
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden-file-input"
                            onChange={(e) => handleImageChange(e, row.id)}
                          />
                        </label>
                      </div>
                    )}
                  </td>

                  {/* Action Status Cell */}
                  <td>
                    <select
                      className={`status-selector badge badge-${row.action_status?.toLowerCase().replace(/\s/g, '')}`}
                      value={row.action_status || 'Pending'}
                      onChange={(e) => saveCellEdit(row.id, 'action_status', e.target.value)}
                    >
                      {statusOptions.map(opt => (
                        <option key={opt} value={opt} className="status-option">{opt}</option>
                      ))}
                    </select>
                  </td>

                  {/* Estimate Name Cell */}
                  <td onDoubleClick={() => startEditing(row.id, 'estimate_name', row.estimate_name)}>
                    {editingCell?.rowId === row.id && editingCell?.field === 'estimate_name' ? (
                      <input
                        type="text"
                        className="table-cell-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => saveCellEdit(row.id, 'estimate_name', editValue)}
                        onKeyDown={(e) => handleKeyDown(e, row.id, 'estimate_name')}
                        autoFocus
                      />
                    ) : (
                      <div className="cell-editable font-mono">{row.estimate_name || <span className="cell-placeholder">EST-XXXX</span>}</div>
                    )}
                  </td>

                  {/* Estimate Comment Cell + AI Action */}
                  <td className="estimate-comment-cell" onDoubleClick={() => startEditing(row.id, 'estimate_comment', row.estimate_comment)}>
                    {editingCell?.rowId === row.id && editingCell?.field === 'estimate_comment' ? (
                      <div className="inline-comment-edit">
                        <textarea
                          className="table-cell-input text-area"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => saveCellEdit(row.id, 'estimate_comment', editValue)}
                          onKeyDown={(e) => handleKeyDown(e, row.id, 'estimate_comment')}
                          autoFocus
                        />
                      </div>
                    ) : (
                      <div className="comment-render-container">
                        <div className="comment-text cell-editable text-wrap">
                          {row.estimate_comment || <span className="cell-placeholder">Double-click to draft comment...</span>}
                        </div>
                        <button 
                          className={`btn-icon ai-btn comment-ai-trigger ${aiGeneratingId === row.id ? 'pulse' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            generateComment(row);
                          }}
                          disabled={aiGeneratingId !== null}
                          title="Draft comment with Groq AI"
                        >
                          {aiGeneratingId === row.id ? (
                            <Loader2 className="animate-spin" size={14} />
                          ) : (
                            <Sparkles size={14} />
                          )}
                        </button>
                      </div>
                    )}
                  </td>

                  {/* Delete Action Cell */}
                  <td>
                    <button className="delete-row-btn" onClick={() => handleDelete(row.id)} title="Delete row">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Enquiry Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel">
            <div className="modal-header">
              <h2 className="modal-title">Log New Customer Enquiry</h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleAddSubmit} className="modal-form">
              <div className="form-group">
                <label className="form-label">Client / Party Name *</label>
                <input 
                  type="text" 
                  className="glass-input" 
                  placeholder="e.g. Apex Infotech" 
                  required
                  value={newEnquiry.party_name}
                  onChange={(e) => setNewEnquiry(prev => ({ ...prev, party_name: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Enquiry Details / Requirements *</label>
                <textarea 
                  className="glass-input" 
                  rows="3" 
                  placeholder="Describe the inquiry details..." 
                  required
                  value={newEnquiry.enquiry}
                  onChange={(e) => setNewEnquiry(prev => ({ ...prev, enquiry: e.target.value }))}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Product Quoted</label>
                  <input 
                    type="text" 
                    className="glass-input" 
                    placeholder="e.g. ErgoSoft Prime Chair" 
                    value={newEnquiry.product_quoted}
                    onChange={(e) => setNewEnquiry(prev => ({ ...prev, product_quoted: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Estimate Code</label>
                  <input 
                    type="text" 
                    className="glass-input font-mono" 
                    placeholder="e.g. EST-2026-001" 
                    value={newEnquiry.estimate_name}
                    onChange={(e) => setNewEnquiry(prev => ({ ...prev, estimate_name: e.target.value }))}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Action Status</label>
                  <select 
                    className="glass-input"
                    value={newEnquiry.action_status}
                    onChange={(e) => setNewEnquiry(prev => ({ ...prev, action_status: e.target.value }))}
                  >
                    {statusOptions.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Reference Image</label>
                  <div className="modal-image-preview-container">
                    {newEnquiry.image_url ? (
                      <div className="modal-image-preview-wrapper">
                        <img src={newEnquiry.image_url} alt="Preview" className="modal-image-preview" />
                        <button 
                          type="button" 
                          className="btn-icon modal-img-clear" 
                          onClick={() => setNewEnquiry(prev => ({ ...prev, image_url: '' }))}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <label className="modal-image-upload-btn glass-input">
                        <ImageIcon size={16} />
                        <span>Upload Reference File</span>
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden-file-input"
                          onChange={handleModalImageChange}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Initial Estimate Comment / AI Hook</label>
                <textarea 
                  className="glass-input" 
                  rows="2" 
                  placeholder="Add initial notes or estimate draft comment..." 
                  value={newEnquiry.estimate_comment}
                  onChange={(e) => setNewEnquiry(prev => ({ ...prev, estimate_comment: e.target.value }))}
                />
              </div>

              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setShowAddModal(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="animate-spin" size={16} /> Saving...
                    </>
                  ) : 'Save Enquiry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Styled JSX Styles specifically for spreadsheet aesthetics */}
      <style>{`
        .screen-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        .screen-title {
          font-size: 1.8rem;
          font-weight: 700;
          background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .screen-subtitle {
          color: var(--text-secondary);
          font-size: 0.95rem;
          margin-top: 4px;
        }
        .filter-banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 20px;
          margin-bottom: 20px;
        }
        .filter-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .filter-label {
          font-weight: 500;
          font-size: 0.9rem;
          color: var(--text-secondary);
        }
        .filter-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .mode-badge {
          font-size: 0.75rem;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
        }
        .mode-badge.real {
          background: rgba(16, 185, 129, 0.1);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }
        .mode-badge.mock {
          background: rgba(99, 102, 241, 0.1);
          color: #a5b4fc;
          border: 1px solid rgba(99, 102, 241, 0.2);
        }
        
        /* Table Layout Styling */
        .table-wrapper {
          overflow-x: auto;
          position: relative;
          min-height: 350px;
          border-radius: 16px;
          background: rgba(15, 23, 42, 0.4);
        }
        .custom-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.95rem;
        }
        .custom-table th {
          padding: 16px 20px;
          font-weight: 600;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border-color);
          background: rgba(10, 15, 30, 0.4);
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .custom-table td {
          padding: 14px 20px;
          border-bottom: 1px solid var(--border-color);
          vertical-align: middle;
        }
        .table-row {
          transition: background-color 0.2s ease;
        }
        .table-row:hover {
          background-color: rgba(255, 255, 255, 0.02);
        }
        
        .cell-editable {
          min-height: 24px;
          cursor: pointer;
          border-radius: 4px;
          padding: 2px 6px;
          margin: -2px -6px;
          transition: background-color 0.15s ease;
        }
        .cell-editable:hover {
          background: rgba(255, 255, 255, 0.05);
        }
        .cell-placeholder {
          color: var(--text-muted);
          font-style: italic;
          font-size: 0.85rem;
        }
        
        .table-cell-input {
          width: 100%;
          background: rgba(10, 15, 30, 0.9);
          border: 1px solid var(--accent-primary);
          border-radius: 6px;
          padding: 6px 10px;
          color: #fff;
          font-family: var(--font-sans);
          font-size: 0.9rem;
          outline: none;
          box-shadow: 0 0 8px var(--accent-glow);
        }
        .table-cell-input.text-area {
          resize: vertical;
          min-height: 60px;
        }
        
        /* Status Badges within dropdown */
        .status-selector {
          cursor: pointer;
          border: 1px solid rgba(255, 255, 255, 0.1);
          outline: none;
          background-color: rgba(255, 255, 255, 0.03);
          font-family: var(--font-sans);
          font-size: 0.75rem;
          border-radius: 9999px;
          padding: 4px 12px;
          color: inherit;
        }
        .status-option {
          background-color: var(--bg-secondary);
          color: var(--text-primary);
          padding: 6px;
        }
        
        /* Image Upload Styles */
        .table-img-container {
          position: relative;
          width: 50px;
          height: 50px;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid var(--border-color);
        }
        .table-thumbnail {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .table-img-clear {
          position: absolute;
          top: 2px;
          right: 2px;
          background: rgba(0, 0, 0, 0.7);
          color: #ef4444;
          border: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        .table-img-container:hover .table-img-clear {
          opacity: 1;
        }
        
        .image-upload-wrapper {
          display: inline-block;
        }
        .image-upload-label {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 0.75rem;
          color: var(--accent-primary);
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px dashed rgba(99, 102, 241, 0.4);
          background: rgba(99, 102, 241, 0.05);
          transition: all 0.2s ease;
        }
        .image-upload-label:hover {
          background: rgba(99, 102, 241, 0.15);
          border-color: var(--accent-primary);
        }
        .hidden-file-input {
          display: none;
        }
        
        /* Comment AI trigger styling */
        .comment-render-container {
          position: relative;
          padding-right: 36px;
          min-height: 24px;
          display: flex;
          align-items: center;
        }
        .comment-ai-trigger {
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%) scale(0.9);
          opacity: 0;
          transition: all 0.2s ease;
        }
        .table-row:hover .comment-ai-trigger,
        .comment-render-container:hover .comment-ai-trigger {
          opacity: 1;
          transform: translateY(-50%) scale(1);
        }
        
        .delete-row-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          transition: color 0.2s ease;
        }
        .delete-row-btn:hover {
          color: #ef4444;
        }
        
        /* Empty states and loader */
        .table-loader, .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 20px;
          text-align: center;
          gap: 12px;
          color: var(--text-secondary);
        }
        .empty-state h3 {
          font-size: 1.2rem;
          color: #fff;
        }
        
        /* Form formatting */
        .modal-form {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .form-label {
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--text-secondary);
        }
        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 10px;
        }
        
        .modal-image-preview-container {
          min-height: 42px;
          display: flex;
          align-items: center;
        }
        .modal-image-preview-wrapper {
          position: relative;
          width: 50px;
          height: 42px;
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid var(--border-color);
        }
        .modal-image-preview {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .modal-img-clear {
          position: absolute;
          top: -2px;
          right: -2px;
          background: rgba(0,0,0,0.8);
          color: #ef4444;
          width: 14px;
          height: 14px;
        }
        .modal-image-upload-btn {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: 0.85rem;
          color: var(--text-secondary);
        }
        .modal-image-upload-btn:hover {
          color: var(--text-primary);
          border-color: var(--accent-primary);
        }
        
        .text-wrap {
          white-space: normal;
          word-break: break-word;
        }
      `}</style>
    </div>
  );
}
