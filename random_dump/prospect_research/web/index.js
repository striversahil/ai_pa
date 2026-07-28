// State Variables
let prospects = [];
let verifiedMap = new Map();
let valueText = "";
let activeSlots = [null, null, null, null]; // 4 slots holding active prospect objects
let activeSlotIndex = 0; // index of currently active/selected slot (0-3)
let currentTab = "pending"; // pending, completed, all
let searchQuery = "";

// DOM Elements
const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search-btn");
const tabPending = document.getElementById("tab-pending");
const tabCompleted = document.getElementById("tab-completed");
const tabAll = document.getElementById("tab-all");
const prospectsTableBody = document.getElementById("prospects-table-body");
const workbenchesGrid = document.getElementById("workbenches-grid");

const progressText = document.getElementById("progress-text");
const progressPercent = document.getElementById("progress-percent");
const progressFill = document.getElementById("progress-fill");

const badgePending = document.getElementById("badge-pending");
const badgeCompleted = document.getElementById("badge-completed");
const badgeAll = document.getElementById("badge-all");

// Toast Notification
const toast = document.getElementById("toast");
const toastIcon = document.getElementById("toast-icon");
const toastMessage = document.getElementById("toast-message");

// Initialization
document.addEventListener("DOMContentLoaded", async () => {
    await fetchInitialData();
    setupEventListeners();
});

async function fetchInitialData() {
    try {
        // Fetch raw prospects and value proposition
        const prospectsRes = await fetch("/api/prospects");
        const prospectsData = await prospectsRes.json();
        prospects = prospectsData.prospects || [];
        valueText = prospectsData.value_text || "";

        // Fetch completed/verified prospects
        const verifiedRes = await fetch("/api/verified");
        const verifiedData = await verifiedRes.json();
        
        verifiedMap.clear();
        verifiedData.forEach(item => {
            if (item.company) {
                verifiedMap.set(item.company, item);
            }
        });

        updateProgress();
        
        // Auto-populate 4 slots with first 4 pending prospects
        let slotIdx = 0;
        for (let i = 0; i < prospects.length; i++) {
            if (slotIdx >= 4) break;
            const p = prospects[i];
            if (!verifiedMap.has(p.company)) {
                activeSlots[slotIdx] = p;
                slotIdx++;
            }
        }

        renderWorkbenches();
        renderProspectList();
    } catch (e) {
        showToast("Error loading initial data: " + e.message, false);
    }
}

function setupEventListeners() {
    // Search input handler
    searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        clearSearchBtn.style.display = searchQuery ? "block" : "none";
        renderProspectList();
    });

    // Clear search button
    clearSearchBtn.addEventListener("click", () => {
        searchInput.value = "";
        searchQuery = "";
        clearSearchBtn.style.display = "none";
        renderProspectList();
        searchInput.focus();
    });

    // Tab buttons
    [tabPending, tabCompleted, tabAll].forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(t => t.classList.remove("active"));
            btn.classList.add("active");
            currentTab = btn.dataset.tab;
            renderProspectList();
        });
    });

    // Consolidated Submit Button
    const btnSubmitAll = document.getElementById("btn-submit-all");
    btnSubmitAll.addEventListener("click", async () => {
        await submitAllFilledSlots();
    });
}

function updateProgress() {
    const total = prospects.length;
    const completed = verifiedMap.size;
    const pending = total - completed;

    // Badges update
    badgePending.textContent = pending;
    badgeCompleted.textContent = completed;
    badgeAll.textContent = total;

    // Header stats update
    progressText.textContent = `${completed} / ${total} Completed`;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    progressPercent.textContent = `${percent}%`;
    progressFill.style.width = `${percent}%`;
}

function renderProspectList() {
    prospectsTableBody.innerHTML = "";

    // Filter prospects based on active tab and search query
    const filtered = prospects.filter(p => {
        const isCompleted = verifiedMap.has(p.company);
        
        // Tab check
        if (currentTab === "pending" && isCompleted) return false;
        if (currentTab === "completed" && !isCompleted) return false;

        // Search query check
        if (searchQuery) {
            const name = (p.company || "").toLowerCase();
            const city = (p.city || "").toLowerCase();
            const state = (p.state || "").toLowerCase();
            const type = (p.type || "").toLowerCase();
            return name.includes(searchQuery) || city.includes(searchQuery) || state.includes(searchQuery) || type.includes(searchQuery);
        }

        return true;
    });

    if (filtered.length === 0) {
        prospectsTableBody.innerHTML = `
            <tr>
                <td colspan="5">
                    <div class="loading-state">
                        <i class="fa-solid fa-folder-open" style="font-size: 1.5rem; opacity:0.6;"></i>
                        <p>No prospects found in this view.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    filtered.forEach(p => {
        const isCompleted = verifiedMap.has(p.company);
        const row = document.createElement("tr");
        
        // Determine if loaded in any active slot
        const slotIdx = activeSlots.findIndex(slot => slot && slot.company === p.company);
        const isLoadedInSlot = slotIdx !== -1;
        
        row.className = isLoadedInSlot && activeSlotIndex === slotIdx ? "selected" : "";
        
        const priorityClass = `priority-${(p.outreachPriority || "Low").toLowerCase()}-bg`;
        
        row.innerHTML = `
            <td class="table-status-cell">
                ${isCompleted 
                    ? `<i class="fa-solid fa-circle-check status-check"></i>` 
                    : `<i class="fa-regular fa-circle status-pending"></i>`}
            </td>
            <td class="table-company-cell">
                ${p.company}
                ${isLoadedInSlot ? `<span class="active-slot-badge">Slot ${slotIdx + 1}</span>` : ""}
            </td>
            <td class="table-type-cell">${p.type || "N/A"}</td>
            <td class="table-location-cell">${p.city || ""}, ${p.state || ""}</td>
            <td class="table-priority-cell">
                <span class="table-priority-badge ${priorityClass}">${p.outreachPriority || "Low"}</span>
            </td>
        `;

        row.addEventListener("click", () => {
            // Load this prospect into the currently selected slot
            activeSlots[activeSlotIndex] = p;
            renderWorkbenches();
            renderProspectList();
            showToast(`Loaded "${p.company}" into Slot ${activeSlotIndex + 1}`);
        });

        prospectsTableBody.appendChild(row);
    });
}

function renderWorkbenches() {
    workbenchesGrid.innerHTML = "";
    activeSlots.forEach((prospect, idx) => {
        const container = document.createElement("div");
        container.className = `slot-container ${activeSlotIndex === idx ? "active" : ""}`;
        container.dataset.index = idx;
        
        container.addEventListener("click", () => {
            if (activeSlotIndex !== idx) {
                activeSlotIndex = idx;
                document.querySelectorAll(".slot-container").forEach((el, cIdx) => {
                    if (cIdx === idx) {
                        el.classList.add("active");
                    } else {
                        el.classList.remove("active");
                    }
                });
                renderProspectList(); // Highlights active selection indicators in directory
            }
        });
        
        if (!prospect) {
            container.innerHTML = `
                <div class="slot-empty">
                    <i class="fa-solid fa-compass-drafting"></i>
                    <h4>Slot ${idx + 1} Empty</h4>
                    <p>Select a prospect from the directory to load it here.</p>
                </div>
            `;
            workbenchesGrid.appendChild(container);
            return;
        }
        
        // Generate queries
        const descQuery = `${prospect.company} operations in ${prospect.city} presence, physical existence, factory office address and business activity`;
        const alignmentProposition = valueText || prospect.reason;
        const alignQuery = `${prospect.company} operations and business activity - does it align with: ${alignmentProposition} Do it align with us if yes then how and if no then why ?`;
        const contactQuery = `${prospect.company} contact details, headquarters telephone, email, executive head, website and social media profiles`;
        
        // Expose data attributes for automation tools (Automa / userscripts)
        container.dataset.company = prospect.company;
        container.dataset.city = prospect.city || "";
        container.dataset.state = prospect.state || "";
        container.dataset.descQuery = descQuery;
        container.dataset.alignQuery = alignQuery;
        container.dataset.contactQuery = contactQuery;

        // Check pre-fill
        const verifiedData = verifiedMap.get(prospect.company);
        const preFillDesc = verifiedData ? verifiedData.description || "" : "";
        const preFillAlign = verifiedData ? verifiedData.reason_alignment || "" : "";
        const preFillContact = verifiedData ? verifiedData.contact || "" : "";
        
        container.innerHTML = `
            <div class="slot-header">
                <span class="slot-badge">Slot ${idx + 1}</span>
                <h4 class="slot-title" title="${prospect.company}">${prospect.company}</h4>
                <button class="clear-slot-btn" title="Clear Slot" id="clear-btn-${idx}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="slot-meta" title="${prospect.type} • ${prospect.city}, ${prospect.state}">
                ${prospect.type || "OEM"} • ${prospect.city || ""}, ${prospect.state || ""}
            </div>
            <div class="slot-actions">
                <button type="button" class="slot-action-btn search" id="btn-copy-desc-${idx}" title="Copy Q1 & Search Google AI">
                    <i class="fa-solid fa-magnifying-glass"></i> Q1 Search
                </button>
                <button type="button" class="slot-action-btn copy" id="btn-copy-align-${idx}" title="Copy Q2 (Alignment)">
                    <i class="fa-solid fa-copy"></i> Q2 Copy
                </button>
                <button type="button" class="slot-action-btn copy" id="btn-copy-contact-${idx}" title="Copy Q3 (Contact)">
                    <i class="fa-solid fa-copy"></i> Q3 Copy
                </button>
            </div>
            <div class="slot-form-container" style="display: flex; flex-direction: column; gap: 0.35rem; flex: 1; margin-top: 0.25rem;">
                <div class="slot-textarea-group">
                    <textarea id="textarea-desc-${idx}" placeholder="Paste Q1 Operations (Presence) results...">${preFillDesc}</textarea>
                    <textarea id="textarea-align-${idx}" placeholder="Paste Q2 Alignment results...">${preFillAlign}</textarea>
                    <textarea id="textarea-contact-${idx}" placeholder="Paste Q3 Contact results...">${preFillContact}</textarea>
                </div>
            </div>
        `;
        
        workbenchesGrid.appendChild(container);
        
        // Clear slot listener
        document.getElementById(`clear-btn-${idx}`).addEventListener("click", (e) => {
            e.stopPropagation();
            activeSlots[idx] = null;
            renderWorkbenches();
            renderProspectList();
            updateConsolidatedButton();
        });
        
        // Bind action triggers
        setupQueryBtn(document.getElementById(`btn-copy-desc-${idx}`), descQuery, true);
        setupQueryBtn(document.getElementById(`btn-copy-align-${idx}`), alignQuery, false);
        setupQueryBtn(document.getElementById(`btn-copy-contact-${idx}`), contactQuery, false);
        
        // Add change/input event listener to textareas to update the button status
        [`textarea-desc-${idx}`, `textarea-align-${idx}`, `textarea-contact-${idx}`].forEach(id => {
            document.getElementById(id).addEventListener("input", () => {
                updateConsolidatedButton();
            });
        });
    });
    
    // Initial consolidated submit button recalculation
    updateConsolidatedButton();
}

function updateConsolidatedButton() {
    const btnSubmitAll = document.getElementById("btn-submit-all");
    if (!btnSubmitAll) return;
    
    let readyCount = 0;
    let activeCount = 0;
    
    activeSlots.forEach((prospect, idx) => {
        if (prospect) {
            activeCount++;
            const descEl = document.getElementById(`textarea-desc-${idx}`);
            const alignEl = document.getElementById(`textarea-align-${idx}`);
            const contactEl = document.getElementById(`textarea-contact-${idx}`);
            
            if (descEl && alignEl && contactEl) {
                const descVal = descEl.value.trim();
                const alignVal = alignEl.value.trim();
                const contactVal = contactEl.value.trim();
                
                if (descVal && alignVal && contactVal) {
                    readyCount++;
                }
            }
        }
    });
    
    btnSubmitAll.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Submit & Verify Filled Slots (${readyCount} / ${activeCount})`;
    btnSubmitAll.disabled = readyCount === 0;
}

async function submitAllFilledSlots() {
    const btnSubmitAll = document.getElementById("btn-submit-all");
    const originalText = btnSubmitAll.innerHTML;
    btnSubmitAll.disabled = true;
    btnSubmitAll.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting & Verifying...`;
    
    const submissionPromises = [];
    const readyIndices = [];
    
    activeSlots.forEach((prospect, idx) => {
        if (prospect) {
            const descEl = document.getElementById(`textarea-desc-${idx}`);
            const alignEl = document.getElementById(`textarea-align-${idx}`);
            const contactEl = document.getElementById(`textarea-contact-${idx}`);
            
            if (descEl && alignEl && contactEl) {
                const descVal = descEl.value.trim();
                const alignVal = alignEl.value.trim();
                const contactVal = contactEl.value.trim();
                
                if (descVal && alignVal && contactVal) {
                    readyIndices.push(idx);
                    submissionPromises.push(submitSlotAPI(prospect, descVal, alignVal, contactVal, idx));
                }
            }
        }
    });
    
    if (submissionPromises.length === 0) {
        showToast("No slots are complete and ready for submission.", false);
        btnSubmitAll.disabled = false;
        btnSubmitAll.innerHTML = originalText;
        return;
    }
    
    try {
        const results = await Promise.all(submissionPromises);
        let successCount = 0;
        
        results.forEach((data, listIdx) => {
            const slotIdx = readyIndices[listIdx];
            if (data && data.success) {
                successCount++;
                verifiedMap.set(activeSlots[slotIdx].company, data.result);
                
                // Auto-refill with next available pending candidate
                activeSlots[slotIdx] = getNextPendingForSlot();
            } else {
                showToast(`Failed to verify slot ${slotIdx + 1}: ${data ? data.error : "Unknown error"}`, false);
            }
        });
        
        if (successCount > 0) {
            showToast(`Successfully verified ${successCount} prospect(s)!`);
        }
        
        updateProgress();
        renderWorkbenches();
        renderProspectList();
    } catch (err) {
        showToast(`Error during batch verification: ${err.message}`, false);
    } finally {
        updateConsolidatedButton();
    }
}

async function submitSlotAPI(prospect, descVal, alignVal, contactVal, idx) {
    const payload = {
        prospect: prospect,
        pasted_description: descVal,
        pasted_alignment: alignVal,
        pasted_contact: contactVal
    };
    
    try {
        const res = await fetch("/api/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        return await res.json();
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function getNextPendingForSlot() {
    for (let i = 0; i < prospects.length; i++) {
        const p = prospects[i];
        if (!verifiedMap.has(p.company)) {
            const alreadyLoaded = activeSlots.some(slot => slot && slot.company === p.company);
            if (!alreadyLoaded) {
                return p;
            }
        }
    }
    return null;
}

function setupQueryBtn(btn, queryString, autoSearch = false) {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener("click", () => {
        copyToClipboard(queryString);
        
        if (autoSearch) {
            showToast("Query copied! Opening Google AI Overview search...");
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(queryString)}&udm=50`;
            window.open(searchUrl, "_blank");
        } else {
            showToast("Query copied to clipboard! Paste manually.");
        }
    });
}

function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
    } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand("copy");
        } catch (err) {}
        document.body.removeChild(textarea);
    }
}

function showToast(message, isSuccess = true) {
    toastMessage.textContent = message;
    
    if (isSuccess) {
        toast.style.borderColor = "var(--success-color)";
        toastIcon.className = "fa-solid fa-circle-check toast-icon";
        toastIcon.style.color = "var(--success-color)";
    } else {
        toast.style.borderColor = "#ef4444";
        toastIcon.className = "fa-solid fa-circle-exclamation toast-icon";
        toastIcon.style.color = "#ef4444";
    }

    toast.classList.add("show");
    
    setTimeout(() => {
        toast.classList.remove("show");
    }, 3500);
}
