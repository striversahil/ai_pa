document.addEventListener('DOMContentLoaded', () => {
  // --- Navigation & Tab Logic ---
  const navButtons = document.querySelectorAll('.nav-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all buttons
      navButtons.forEach(b => b.classList.remove('active'));
      // Add active class to clicked button
      btn.classList.add('active');

      // Hide all tab panels
      tabPanels.forEach(panel => panel.classList.remove('active'));
      // Show corresponding tab panel
      const targetTab = btn.getAttribute('data-tab');
      document.getElementById(targetTab).classList.add('active');
    });
  });

  // --- Current Date ---
  const dateEl = document.getElementById('current-date');
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  dateEl.textContent = new Date().toLocaleDateString('en-US', options);

  // --- Markdown Parser Helper ---
  function parseMarkdown(md) {
    if (!md) return '';
    return md
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^\- (.*$)/gim, '<li>$1</li>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[x\] (.*?)(?:<br>|$)/gim, '<span class="badge success" style="margin-right:8px;">✔</span> $1<br>')
      .replace(/\[ \] (.*?)(?:<br>|$)/gim, '<span class="badge warning" style="margin-right:8px;">⏱</span> $1<br>')
      .replace(/\n/g, '<br>');
  }

  // --- API Fetch & Populate Operations ---

  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      
      const dbStatusBadge = document.getElementById('db-status-badge');
      const aiStatusBadge = document.getElementById('ai-status-badge');
      
      if (data.useInMemoryDb) {
        dbStatusBadge.textContent = 'In-Memory';
        dbStatusBadge.className = 'badge warning';
      } else {
        dbStatusBadge.textContent = 'PostgreSQL';
        dbStatusBadge.className = 'badge success';
      }

      if (data.isMockLLM) {
        aiStatusBadge.textContent = 'Simulation';
        aiStatusBadge.className = 'badge warning';
      } else {
        aiStatusBadge.textContent = 'Active API';
        aiStatusBadge.className = 'badge success';
      }
    } catch (e) {
      console.error('Error fetching server status:', e);
    }
  }

  async function fetchBriefing() {
    const container = document.getElementById('briefing-container');
    try {
      const res = await fetch('/api/brief/latest');
      if (res.status === 404) {
        container.innerHTML = `
          <div style="text-align: center; padding: 20px; color: var(--text-secondary);">
            <p>No briefings generated yet.</p>
            <button id="btn-create-initial-brief" class="btn btn-primary" style="margin: 15px auto 0;">Generate Briefing</button>
          </div>
        `;
        document.getElementById('btn-create-initial-brief').addEventListener('click', triggerBriefingRegen);
        return;
      }
      const data = await res.json();
      container.innerHTML = parseMarkdown(data.content);
    } catch (e) {
      container.innerHTML = `<div class="loading-state" style="color: var(--priority-urgent)">Error loading briefing logs.</div>`;
    }
  }

  async function fetchTasks() {
    const dashboardList = document.getElementById('dashboard-task-list');
    const detailedTable = document.getElementById('detailed-tasks-table');
    
    try {
      const res = await fetch('/api/tasks');
      const tasks = await res.json();

      if (tasks.length === 0) {
        dashboardList.innerHTML = '<div class="loading-state">No pending tasks found.</div>';
        detailedTable.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">No tasks in backlog.</td></tr>';
        return;
      }

      // Populate dashboard checklist (first 5 tasks)
      dashboardList.innerHTML = tasks.slice(0, 5).map(task => `
        <div class="task-item ${task.status === 'COMPLETED' ? 'completed' : ''}">
          <input type="checkbox" ${task.status === 'COMPLETED' ? 'checked' : ''} disabled>
          <div class="task-details">
            <span class="task-title">${task.title}</span>
            <div class="task-meta">
              <span>Assignee: <strong>${task.owner}</strong></span>
              <span>Source: <span class="source-badge">${task.source}</span></span>
              ${task.deadline ? `<span>Due: ${new Date(task.deadline).toLocaleDateString()}</span>` : ''}
            </div>
          </div>
        </div>
      `).join('');

      // Populate detailed tasks view
      detailedTable.innerHTML = tasks.map(task => `
        <tr>
          <td><strong>${task.title}</strong></td>
          <td>${task.owner}</td>
          <td><span class="digest-tag">${task.source}</span></td>
          <td>${task.deadline ? new Date(task.deadline).toLocaleDateString() : 'N/A'}</td>
          <td>
            <span class="badge ${task.status === 'COMPLETED' ? 'success' : task.status === 'PENDING' ? 'warning' : 'info'}">
              ${task.status}
            </span>
          </td>
        </tr>
      `).join('');

    } catch (e) {
      console.error(e);
      dashboardList.innerHTML = '<div class="loading-state" style="color: var(--priority-urgent)">Error loading tasks.</div>';
    }
  }

  async function fetchDigests() {
    const dashboardList = document.getElementById('dashboard-digests-list');
    const detailedList = document.getElementById('detailed-digests-list');

    try {
      const res = await fetch('/api/digests');
      const digests = await res.json();

      if (digests.length === 0) {
        dashboardList.innerHTML = '<div class="loading-state">No conversation digests available yet. Run the digest job above!</div>';
        detailedList.innerHTML = '<div class="loading-state">No digests found.</div>';
        return;
      }

      // Helper for priority badges
      const getPriorityBadgeClass = (p) => {
        p = p.toLowerCase();
        if (p === 'urgent') return 'badge warning';
        if (p === 'high') return 'badge warning';
        if (p === 'medium') return 'badge info';
        return 'badge success';
      };

      // Populate Dashboard Grid (first 3 digests)
      dashboardList.innerHTML = digests.slice(0, 3).map(d => `
        <div class="digest-card">
          <div class="digest-top">
            <span class="digest-name">${d.chatName}</span>
            <span class="${getPriorityBadgeClass(d.priority)}">${d.priority}</span>
          </div>
          <p class="digest-summary">${d.summary}</p>
          <div class="digest-meta-row">
            <span class="digest-tag">Category: ${d.category}</span>
            <span class="digest-tag">Sentiment: ${d.sentiment}</span>
            ${d.requiresFounder ? '<span class="badge warning">Founder Required</span>' : ''}
          </div>
          ${d.suggestedReply ? `
            <div class="digest-reply-box">
              <strong>Suggested Reply:</strong>
              "${d.suggestedReply}"
            </div>
          ` : ''}
        </div>
      `).join('');

      // Populate Detailed list in digests tab
      detailedList.innerHTML = digests.map(d => `
        <div class="digest-card" style="margin-bottom: 20px;">
          <div class="digest-top">
            <span class="digest-name" style="font-size:18px;">${d.chatName}</span>
            <div>
              <span class="${getPriorityBadgeClass(d.priority)}" style="margin-right:8px;">${d.priority}</span>
              ${d.requiresFounder ? '<span class="badge warning">Requires Founder Action</span>' : ''}
            </div>
          </div>
          <p class="digest-summary" style="font-size:14px; margin-top:8px;">${d.summary}</p>
          <div class="digest-meta-row" style="margin-top:12px;">
            <span class="digest-tag">Chat ID: ${d.chatId}</span>
            <span class="digest-tag">Category: ${d.category}</span>
            <span class="digest-tag">Sentiment: ${d.sentiment}</span>
            <span class="digest-tag">Synced: ${new Date(d.createdAt).toLocaleString()}</span>
          </div>
          ${d.suggestedReply ? `
            <div class="digest-reply-box" style="margin-top:14px; font-size:13px;">
              <strong>Draft Suggested Reply:</strong>
              "${d.suggestedReply}"
            </div>
          ` : ''}
        </div>
      `).join('');

    } catch (e) {
      console.error(e);
      dashboardList.innerHTML = '<div class="loading-state" style="color: var(--priority-urgent)">Error loading digests.</div>';
    }
  }

  // --- Manual Actions Trigger handlers ---

  async function triggerBriefingRegen() {
    const container = document.getElementById('briefing-container');
    container.innerHTML = `<div class="loading-state">Regenerating briefing using AI context...</div>`;
    try {
      const res = await fetch('/api/trigger/briefing', { method: 'POST' });
      const data = await res.json();
      alert('Morning briefing regenerated successfully!');
      fetchBriefing();
      fetchTasks();
      fetchDigests();
    } catch (e) {
      alert('Error triggering brief generation');
    }
  }

  document.getElementById('btn-trigger-brief').addEventListener('click', triggerBriefingRegen);

  document.getElementById('btn-sync-emails').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/trigger/email-sync', { method: 'POST' });
      const data = await res.json();
      alert(`Email sync complete. Synced ${data.emailsSynced} new messages.`);
      fetchTasks();
      fetchBriefing();
    } catch (e) {
      alert('Failed to trigger email sync');
    }
  });

  document.getElementById('btn-run-digest').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/trigger/digest', { method: 'POST' });
      const data = await res.json();
      const p = data.result.processedChatsCount;
      const f = data.result.failedChatsCount;
      const t = data.result.tasksCreatedCount;
      alert(`Digest process complete.\nChats Summarized: ${p}\nFailed: ${f}\nTasks Created: ${t}`);
      fetchDigests();
      fetchTasks();
      fetchBriefing();
    } catch (e) {
      alert('Failed to trigger digest process');
    }
  });

  // --- AI Chatbot Form Submit Handler ---
  const chatForm = document.getElementById('chat-form');
  const chatInputField = document.getElementById('chat-input-field');
  const chatMessagesContainer = document.getElementById('chat-messages-container');

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = chatInputField.value.trim();
    if (!question) return;

    // Append user message
    const userMsgEl = document.createElement('div');
    userMsgEl.className = 'message user';
    userMsgEl.innerHTML = `<div class="msg-bubble">${question}</div>`;
    chatMessagesContainer.appendChild(userMsgEl);
    
    // Clear input & scroll
    chatInputField.value = '';
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;

    // Append loader for assistant
    const loaderMsgEl = document.createElement('div');
    loaderMsgEl.className = 'message assistant';
    loaderMsgEl.innerHTML = `<div class="msg-bubble">Thinking...</div>`;
    chatMessagesContainer.appendChild(loaderMsgEl);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;

    try {
      const res = await fetch('/api/ask-founder-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      });
      const data = await res.json();
      
      // Replace loader with actual answer
      loaderMsgEl.innerHTML = `<div class="msg-bubble">${data.answer}</div>`;
    } catch (err) {
      loaderMsgEl.innerHTML = `<div class="msg-bubble" style="color: var(--priority-urgent)">Failed to connect to the assistant server.</div>`;
    }

    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
  });

  // --- Initial Load ---
  fetchStatus();
  fetchBriefing();
  fetchTasks();
  fetchDigests();
});
