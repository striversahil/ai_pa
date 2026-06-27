// ==UserScript==
// @name         Prospect Research Helper
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Automates scraping and switching between the manual research workbench and Google Search
// @author       Antigravity
// @match        http://127.0.0.1:8000/*
// @match        http://localhost:8000/*
// @match        https://*.google.com/search*
// @match        https://*.google.co.in/search*
// @match        https://*.google.com.br/search*
// @match        https://*.google.co.uk/search*
// @match        https://www.google.*/search*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        window.close
// ==/UserScript==

(function() {
    'use strict';

    console.log('[Prospect Helper] Script initialized. Current URL:', window.location.href);

    // Support both 127.0.0.1 and localhost
    const isWorkbenchTab = window.location.port === "8000" && 
                           (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");

    // Clean strings for safe comparison
    const cleanString = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // ----------------------------------------------------
    // WORKBENCH TAB LOGIC
    // ----------------------------------------------------
    if (isWorkbenchTab) {
        console.log('[Prospect Helper] Matched manual research workbench page.');

        // 1. Setup change listener to receive scraped text from Google Search tabs
        GM_addValueChangeListener("scrapedData", function(key, oldValue, newValue, remote) {
            console.log('[Prospect Helper] Listener triggered for scrapedData. Remote change:', remote);
            if (remote && newValue) {
                const { scrapedText, type, slotIndex } = newValue;
                console.log('[Prospect Helper] Received cross-origin data. Slot:', slotIndex, 'Type:', type, 'Text Length:', scrapedText.length);
                
                const textarea = document.getElementById(`textarea-${type}-${slotIndex}`);
                if (textarea) {
                    textarea.value = scrapedText;
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    console.log('[Prospect Helper] Textarea updated successfully.');
                } else {
                    console.error('[Prospect Helper] Textarea element not found for index:', slotIndex, 'type:', type);
                }
            }
        });

        // 2. Listen for key presses to launch searches
        window.addEventListener('keydown', (e) => {
            if (e.altKey) {
                console.log('[Prospect Helper] Alt Keydown intercepted:', e.key, 'code:', e.code);
            }

            const isDigit1 = e.key === '1' || e.code === 'Digit1';
            const isDigit2 = e.key === '2' || e.code === 'Digit2';
            const isDigit3 = e.key === '3' || e.code === 'Digit3';

            if (e.altKey && (isDigit1 || isDigit2 || isDigit3)) {
                e.preventDefault(); // Prevent browser defaults
                
                const activeSlot = document.querySelector('.slot-container.active');
                if (!activeSlot) {
                    console.warn('[Prospect Helper] Hotkey abort: No slot container has the "active" class.');
                    alert("Please click and select an active slot in the workbench first!");
                    return;
                }
                const index = activeSlot.dataset.index;
                let query = "";
                let type = "";

                if (isDigit1) { query = activeSlot.dataset.descQuery; type = "desc"; }
                if (isDigit2) { query = activeSlot.dataset.alignQuery; type = "align"; }
                if (isDigit3) { query = activeSlot.dataset.contactQuery; type = "contact"; }

                if (!query) {
                    console.warn('[Prospect Helper] Hotkey abort: Active slot has no query data attributes.');
                    alert(`Slot ${parseInt(index) + 1} is empty! Select a prospect from the list on the left to load it first.`);
                    return;
                }

                console.log('[Prospect Helper] Setting pending search context in GM storage...');
                // Store pending search metadata globally in Tampermonkey storage
                GM_setValue("pendingSearch", {
                    query: query,
                    slotIndex: index,
                    type: type,
                    timestamp: Date.now()
                });

                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}${type === 'desc' ? '&udm=50' : ''}`;
                console.log('[Prospect Helper] Launching search tab. URL:', searchUrl);
                window.open(searchUrl, '_blank');
            }
        });
    }

    // ----------------------------------------------------
    // GOOGLE SEARCH TAB LOGIC
    // ----------------------------------------------------
    if (window.location.hostname.includes('google.')) {
        console.log('[Prospect Helper] Matched Google Search page.');

        window.addEventListener('load', () => {
            console.log('[Prospect Helper] Google page loaded. Checking pending search contexts...');

            const params = new URLSearchParams(window.location.search);
            const currentQuery = params.get('q');
            if (!currentQuery) {
                console.log('[Prospect Helper] No search query "q" found in URL.');
                return;
            }

            // Read the pending search context stored by the workbench tab
            const pending = GM_getValue("pendingSearch");
            if (!pending) {
                console.log('[Prospect Helper] No pending search registered in GM storage.');
                return;
            }

            // Verify if this Google Search matches the pending request
            const isMatch = cleanString(pending.query) === cleanString(currentQuery);
            console.log('[Prospect Helper] Matching comparison:', cleanString(pending.query), 'vs', cleanString(currentQuery), 'Result:', isMatch);

            if (!isMatch) {
                console.log('[Prospect Helper] Google Search query does not match the pending workbench query.');
                return;
            }

            // Save matched slot parameters locally in the tab scope
            window.myScrapeContext = {
                slotIndex: pending.slotIndex,
                type: pending.type,
                query: pending.query
            };
            console.log('[Prospect Helper] Context match successful! Scrape context registered:', window.myScrapeContext);

            // Add the floating extraction widget to the Google Search results page
            console.log('[Prospect Helper] Rendering float widget...');
            const widget = document.createElement('div');
            widget.style.position = 'fixed';
            widget.style.top = '15px';
            widget.style.right = '15px';
            widget.style.zIndex = '9999999';
            widget.style.background = '#0d1126';
            widget.style.border = '2px solid #6366f1';
            widget.style.borderRadius = '10px';
            widget.style.padding = '12px';
            widget.style.color = '#f3f4f6';
            widget.style.fontFamily = 'sans-serif';
            widget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
            widget.style.width = '200px';
            widget.innerHTML = `
                <div style="font-weight:bold;margin-bottom:6px;font-size:12px;color:#a855f7;text-align:center;">Prospect Scraper Active</div>
                <button id="scrape-send-btn" style="background:linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);color:#fff;border:none;border-radius:6px;padding:8px 12px;font-size:11px;cursor:pointer;font-weight:bold;width:100%;box-shadow:0 0 10px rgba(99,102,241,0.4);transition:opacity 0.2s;">
                    Extract & Return
                </button>
                <div style="font-size:9px;color:#9ca3af;margin-top:8px;text-align:center;line-height:1.3;">Highlight text with mouse to return ONLY selection. Otherwise, returns AI Overview.</div>
            `;
            document.body.appendChild(widget);
            console.log('[Prospect Helper] Widget appended to body.');

            const btn = document.getElementById('scrape-send-btn');
            btn.addEventListener('mouseover', () => { btn.style.opacity = '0.9'; });
            btn.addEventListener('mouseout', () => { btn.style.opacity = '1'; });
            
            btn.addEventListener('click', () => {
                console.log('[Prospect Helper] Extract button clicked.');

                // 1. Get highlighted text
                let scrapedText = window.getSelection().toString().trim();
                
                // 2. Fallback to AI Overview container
                if (!scrapedText) {
                    console.log('[Prospect Helper] No selection. Locating AI Overview container...');
                    const aiHeader = Array.from(document.querySelectorAll('h2, span, div')).find(el => el.textContent.includes('AI Overview'));
                    if (aiHeader) {
                        let parent = aiHeader.parentElement;
                        for (let i = 0; i < 5; i++) {
                            if (parent && (parent.tagName === 'G-CARD' || parent.classList.contains('dn1Noc') || parent.offsetHeight > 100)) {
                                scrapedText = parent.innerText;
                                console.log('[Prospect Helper] Extracted AI Overview container text.');
                                break;
                            }
                            parent = parent?.parentElement;
                        }
                    }
                }
                
                // 3. Fallback to general search results
                if (!scrapedText) {
                    console.log('[Prospect Helper] AI Overview not found. Extracting general search blocks...');
                    scrapedText = document.querySelector('#rso')?.innerText || document.body.innerText;
                }

                console.log('[Prospect Helper] Text extracted. Length:', scrapedText.length);

                // Publish scraped result to Tampermonkey storage to trigger the listener on the workbench tab
                GM_setValue("scrapedData", {
                    scrapedText: scrapedText,
                    type: window.myScrapeContext.type,
                    slotIndex: window.myScrapeContext.slotIndex,
                    query: window.myScrapeContext.query,
                    timestamp: Date.now() // Guarantees event triggers on every click
                });
                console.log('[Prospect Helper] GM_setValue scrapedData updated.');

                // Close the search tab
                console.log('[Prospect Helper] Closing tab...');
                window.close();
            });
        });
    }
})();
