// State Variables
let verifiedProspects = [];
let filteredProspects = [];
let selectedProspect = null;
let currentTab = 'desc'; // 'desc', 'align', 'contact'
let searchQuery = "";
let selectedState = "";
let selectedPriority = "";

// DOM Elements
const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search-btn");
const filterState = document.getElementById("filter-state");
const prospectsList = document.getElementById("prospects-list");

const viewerEmptyState = document.getElementById("viewer-empty-state");
const viewerContent = document.getElementById("viewer-content");

// Hero Info Elements
const viewCompanyName = document.getElementById("view-company-name");
const viewType = document.getElementById("view-type");
const viewPriority = document.getElementById("view-priority");
const viewStateCity = document.getElementById("view-state-city");
const viewCapacity = document.getElementById("view-capacity");
const viewWebsiteLink = document.getElementById("view-website-link");
const viewProductsTags = document.getElementById("view-products-tags");

// Tab content panel
const tabContentPanel = document.getElementById("tab-content-panel");
const btnTabDesc = document.getElementById("btn-tab-desc");
const btnTabAlign = document.getElementById("btn-tab-align");
const btnTabContact = document.getElementById("btn-tab-contact");

// Links
const viewLinksGrid = document.getElementById("view-links-grid");

// Initialization
document.addEventListener("DOMContentLoaded", async () => {
    setupEventListeners();
    await fetchVerifiedData();
});

// Fetch data
async function fetchVerifiedData() {
    try {
        const res = await fetch("/api/verified");
        const data = await res.json();
        
        // Sort verified prospects alphabetically by company name
        verifiedProspects = (data || []).sort((a, b) => {
            return (a.company || "").localeCompare(b.company || "");
        });

        populateStateDropdown();
        applyFilters();
    } catch (err) {
        console.error("Error loading verified data:", err);
    }
}

// Event Listeners setup
function setupEventListeners() {
    // Search
    searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        clearSearchBtn.style.display = searchQuery ? "block" : "none";
        applyFilters();
    });

    clearSearchBtn.addEventListener("click", () => {
        searchInput.value = "";
        searchQuery = "";
        clearSearchBtn.style.display = "none";
        applyFilters();
        searchInput.focus();
    });

    // State Filter
    filterState.addEventListener("change", (e) => {
        selectedState = e.target.value;
        applyFilters();
    });

    // Priority Filter Buttons
    document.querySelectorAll(".prio-filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const prio = btn.dataset.prio;
            if (selectedPriority === prio) {
                // Toggle off
                selectedPriority = "";
                btn.classList.remove("active");
            } else {
                // Toggle on
                document.querySelectorAll(".prio-filter-btn").forEach(b => b.classList.remove("active"));
                selectedPriority = prio;
                btn.classList.add("active");
            }
            applyFilters();
        });
    });

    // Tab buttons
    [btnTabDesc, btnTabAlign, btnTabContact].forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".viewer-tabs .tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentTab = btn.dataset.tab;
            renderTabContent();
        });
    });
}

// Filter Dropdowns Populator
function populateStateDropdown() {
    const states = new Set();
    verifiedProspects.forEach(p => {
        if (p.state) states.add(p.state);
    });

    // Sort states alphabetically
    const sortedStates = Array.from(states).sort();

    filterState.innerHTML = '<option value="">All States</option>';
    sortedStates.forEach(state => {
        filterState.innerHTML += `<option value="${state}">${state}</option>`;
    });
}

// Applying filters
function applyFilters() {
    filteredProspects = verifiedProspects.filter(p => {
        // Search filter
        if (searchQuery) {
            const name = (p.company || "").toLowerCase();
            const type = (p.type || "").toLowerCase();
            const desc = (p.description || "").toLowerCase();
            const products = (p.keyProductsNeeded || []).join(" ").toLowerCase();
            const state = (p.state || "").toLowerCase();

            const match = name.includes(searchQuery) || 
                          type.includes(searchQuery) || 
                          desc.includes(searchQuery) ||
                          state.includes(searchQuery) ||
                          products.includes(searchQuery);
            if (!match) return false;
        }

        // State filter
        if (selectedState && p.state !== selectedState) {
            return false;
        }

        // Priority filter
        if (selectedPriority && p.outreachPriority !== selectedPriority) {
            return false;
        }

        return true;
    });

    renderProspectList();
}

// Render Directory Sidebar
function renderProspectList() {
    prospectsList.innerHTML = "";

    if (filteredProspects.length === 0) {
        prospectsList.innerHTML = `
            <div class="loading-state" style="padding: 2rem; text-align: center;">
                <i class="fa-solid fa-folder-open" style="font-size: 1.5rem; opacity: 0.5;"></i>
                <p style="font-size: 0.85rem; margin-top: 0.5rem;">No verified prospects match filters.</p>
            </div>
        `;
        return;
    }

    filteredProspects.forEach(p => {
        const li = document.createElement("li");
        li.className = `prospect-list-item ${selectedProspect && selectedProspect.company === p.company ? "selected" : ""}`;
        
        li.innerHTML = `
            <div class="item-info">
                <h4>${p.company}</h4>
                <p>${p.type || "OEM"} • ${p.website ? new URL(p.website).hostname : "N/A"}</p>
            </div>
            <div class="item-badges">
                <span class="state-badge">${p.state || "N/A"}</span>
                <span class="prio-dot-badge ${(p.outreachPriority || "Low").toLowerCase()}">${p.outreachPriority || "Low"}</span>
            </div>
        `;

        li.addEventListener("click", () => {
            selectProspect(p);
            // Highlight list selection
            document.querySelectorAll(".prospect-list-item").forEach(item => item.classList.remove("selected"));
            li.classList.add("selected");
        });

        prospectsList.appendChild(li);
    });

    // Auto-select first item if details are empty but list is not
    if (!selectedProspect && filteredProspects.length > 0) {
        selectProspect(filteredProspects[0]);
        // Add selected class to the first rendered child
        if (prospectsList.firstElementChild) {
            prospectsList.firstElementChild.classList.add("selected");
        }
    } else if (selectedProspect) {
        // Re-establish selection highlight
        const idx = filteredProspects.findIndex(p => p.company === selectedProspect.company);
        if (idx !== -1 && prospectsList.children[idx]) {
            prospectsList.children[idx].classList.add("selected");
        }
    }
}

// Select prospect
function selectProspect(prospect) {
    selectedProspect = prospect;
    viewerEmptyState.style.display = "none";
    viewerContent.style.display = "flex";

    // Populate Hero Details
    viewCompanyName.textContent = prospect.company;
    viewType.textContent = prospect.type || "OEM";
    
    // Priority badge
    viewPriority.textContent = prospect.outreachPriority || "Low";
    viewPriority.className = `priority-badge ${prospect.outreachPriority || "Low"}`;

    viewStateCity.innerHTML = `<i class="fa-solid fa-location-dot"></i> State: ${prospect.state || "N/A"}`;
    
    // Capacity
    const capacityVal = prospect.annualCapacity || "N/A";
    const capacityText = typeof capacityVal === 'number' 
        ? `Capacity: ${capacityVal.toLocaleString()} tons` 
        : `Capacity: ${capacityVal}`;
    viewCapacity.innerHTML = `<i class="fa-solid fa-gauge-high"></i> ${capacityText}`;

    // Website Link
    if (prospect.website) {
        viewWebsiteLink.href = prospect.website;
        viewWebsiteLink.style.display = "inline-flex";
    } else {
        viewWebsiteLink.style.display = "none";
    }

    // Key Products Tags
    viewProductsTags.innerHTML = "";
    const products = prospect.keyProductsNeeded || [];
    if (products.length > 0) {
        products.forEach(prod => {
            viewProductsTags.innerHTML += `<span class="prod-tag">${prod}</span>`;
        });
    } else {
        viewProductsTags.innerHTML = `<span style="font-size:0.8rem; color:var(--text-muted);">None registered</span>`;
    }

    // Render current active tab content
    renderTabContent();

    // Render source link buttons
    renderSourceLinks();
}

// Render selected tab content
function renderTabContent() {
    if (!selectedProspect) return;

    let rawText = "";
    if (currentTab === 'desc') rawText = selectedProspect.description || "";
    if (currentTab === 'align') rawText = selectedProspect.reason_alignment || "";
    if (currentTab === 'contact') rawText = selectedProspect.contact || "";

    tabContentPanel.innerHTML = parseMarkdownToHTML(rawText);
}

// Render source links
function renderSourceLinks() {
    viewLinksGrid.innerHTML = "";
    if (!selectedProspect || !selectedProspect.links) {
        viewLinksGrid.innerHTML = `<p style="font-size:0.8rem; color:var(--text-muted);">No verified links available.</p>`;
        return;
    }

    const linksMap = selectedProspect.links;
    const keys = Object.keys(linksMap);

    if (keys.length === 0) {
        viewLinksGrid.innerHTML = `<p style="font-size:0.8rem; color:var(--text-muted);">No verified links available.</p>`;
        return;
    }

    keys.forEach(key => {
        const value = linksMap[key];
        if (!value) return;

        const info = getLinkIconClass(key, value);
        
        const card = document.createElement("a");
        card.href = value;
        card.target = "_blank";
        card.className = `link-card ${info.cls}`;
        card.title = key;

        card.innerHTML = `
            <i class="${info.icon}"></i>
            <span>${key}</span>
        `;

        viewLinksGrid.appendChild(card);
    });
}

// Helpers
function getLinkIconClass(key, value) {
    const k = key.toLowerCase();
    const val = value.toLowerCase();
    
    if (val.includes('linkedin.com') || k.includes('linkedin')) {
        return { icon: 'fa-brands fa-linkedin', cls: 'linkedin' };
    }
    if (val.includes('instagram.com') || k.includes('instagram')) {
        return { icon: 'fa-brands fa-instagram', cls: 'instagram' };
    }
    if (val.includes('facebook.com') || k.includes('facebook')) {
        return { icon: 'fa-brands fa-facebook', cls: 'facebook' };
    }
    if (val.includes('youtube.com') || k.includes('youtube')) {
        return { icon: 'fa-brands fa-youtube', cls: 'youtube' };
    }
    if (k.includes('website') || k.includes('main website') || k.includes('portal') || k.includes('homepage') || k.includes('moinhodonordeste.com.br')) {
        return { icon: 'fa-solid fa-globe', cls: 'website' };
    }
    return { icon: 'fa-solid fa-file-invoice', cls: 'source' };
}

// Parse Markdown/Txt blocks to HTML
function parseMarkdownToHTML(text) {
    if (!text) return "<p style='color:var(--text-muted); font-style:italic;'>No documentation text available for this section.</p>";
    
    const lines = text.split("\n");
    let inList = false;
    let inTable = false;
    let tableHeaderDone = false;
    let html = "";
    
    lines.forEach(line => {
        let trimmed = line.trim();
        
        // Handle dividers
        if (/^[-*_]{3,}$/.test(trimmed) || /^[-*]{5,}$/.test(trimmed)) {
            if (inList) { html += "</ul>"; inList = false; }
            if (inTable) { html += "</table>"; inTable = false; tableHeaderDone = false; }
            html += "<hr>";
            return;
        }
        
        // Handle headers
        if (trimmed.startsWith("###")) {
            if (inList) { html += "</ul>"; inList = false; }
            if (inTable) { html += "</table>"; inTable = false; tableHeaderDone = false; }
            html += `<h3>${trimmed.replace(/^###\s*/, "")}</h3>`;
            return;
        }
        if (trimmed.startsWith("##") || trimmed.startsWith("#")) {
            if (inList) { html += "</ul>"; inList = false; }
            if (inTable) { html += "</table>"; inTable = false; tableHeaderDone = false; }
            const cleanText = trimmed.replace(/^##?\s*/, "");
            html += `<h2>${cleanText}</h2>`;
            return;
        }
        
        // Handle tables
        if (trimmed.startsWith("|")) {
            if (inList) { html += "</ul>"; inList = false; }
            if (!inTable) {
                html += "<table>";
                inTable = true;
                tableHeaderDone = false;
            }
            
            // Check separator line |---|---|
            if (/^[|:\-\s]+$/.test(trimmed)) {
                return;
            }
            
            const cells = trimmed.split("|").slice(1, -1).map(c => c.trim());
            html += "<tr>";
            cells.forEach(cell => {
                if (!tableHeaderDone) {
                    html += `<th>${cell}</th>`;
                } else {
                    html += `<td>${cell}</td>`;
                }
            });
            html += "</tr>";
            tableHeaderDone = true;
            return;
        } else if (inTable) {
            html += "</table>";
            inTable = false;
            tableHeaderDone = false;
        }
        
        // Handle bullet lists
        if (trimmed.startsWith("*") || trimmed.startsWith("-")) {
            if (!inList) {
                html += "<ul>";
                inList = true;
            }
            const itemText = trimmed.replace(/^[*-\s]+/, "");
            html += `<li>${itemText}</li>`;
            return;
        } else if (inList) {
            html += "</ul>";
            inList = false;
        }
        
        // Regular paragraphs
        if (trimmed) {
            html += `<p>${trimmed}</p>`;
        }
    });
    
    // Close open tags
    if (inList) html += "</ul>";
    if (inTable) html += "</table>";
    
    return html;
}
