# B2B Lead Enrichment manual Workbench & Browser Automation

A premium, local B2B lead enrichment system combining a **4-Container Parallel Research Workbench**, a **Verified Directory Viewer**, and **browser-native userscript automation** to search, analyze, and save high-value prospects.

This system is specifically engineered to solve a common bottleneck in lead scraping: **Google bot detection**. By running the searches inside your actual browser and routing the results back via extension-level hooks, the system completely avoids IP blocks, captchas, and bot flags, while providing the speed of fully automated scrapers.

---

## 🏗️ Project Architecture

```
.
├── web/                       # Research Workbench (Editing / Submitting)
│   ├── server.py              # Python HTTP Backend (Port 8000, thread-safe JSON updates)
│   ├── index.html             # Workbench UI structure
│   ├── index.css              # Glassmorphic dark theme variables & workbench styles
│   └── index.js               # 4-Slot Parallel State logic & AJAX batch submissions
│
├── view/                      # Verified Directory Dashboard (Read-Only)
│   ├── index.html             # Split list/viewer structure
│   ├── index.css              # Custom styling for rich text documentation & spacing
│   └── index.js               # Custom Markdown parser & dynamic link grid cards
│
├── prospects.json             # Raw input leads (source of truth)
├── prospects_verified.json    # Enriched and verified lead output data
├── value.txt                  # Your company's default value proposition
├── research_finder.py         # Python link-cleaning and content extraction logic
├── userscript.js              # Tampermonkey Userscript (Cross-origin storage bridge)
└── automa_workflow.json       # Visual Automa Workflow backup
```

---

## 🚀 Installation & Setup

### 1. Requirements & Dependencies
Ensure you are running inside a Python virtual environment (`uv` or `venv`):
- Python 3.10+
- Standard libraries (`http.server`, `urllib.parse`, `json`, `threading`)

### 2. Start the Server
Run the python server in the background:
```bash
python -u web/server.py
```
* **Workbench URL**: [http://localhost:8000](http://localhost:8000)
* **Verified Directory URL**: [http://localhost:8000/view](http://localhost:8000/view)

### 3. Install the browser Userscript
1. Install **[Tampermonkey](https://www.tampermonkey.net/)** (available for Chrome, Firefox, Edge, Safari).
2. Open the Tampermonkey dashboard, click **Create a new script**.
3. Overwrite the default template with the code from **[`userscript.js`](userscript.js)**.
4. Save the script (`Ctrl+S`). It is configured to run on `http://localhost:8000/*` and any global `google.*/search` page.

---

## 🛠️ Deep Dive: How the System Works

### 1. The Python Backend (`web/server.py`)
* **Thread-Safety**: Implements a `threading.Lock()` to prevent race conditions when multiple slots are submitted simultaneously.
* **Atomic Writes**: Writes changes to `prospects_verified.json.tmp` and uses `os.replace` to swap files atomically, preventing file corruption.
* **Link Extraction & Deduplication**: Passes the pasted text through `extract_and_clean_all_links()` from `research_finder.py`. It automatically strips Google redirect parameters, cleans up tracker tokens, filters out irrelevant search domains, and aggregates unique URLs into the prospect's profile.

### 2. The 4-Slot Parallel Workbench (`http://localhost:8000`)
* **Parallel Grid Layout**: Displays a 2x2 grid containing **4 active slots** representing prospects currently being researched.
* **Slot Lifecycle**:
  - Automatically populates empty slots with the first 4 pending prospects from `prospects.json`.
  - Shows active slot badges in the left-hand directory list (e.g. `Slot 1`, `Slot 2`) to visualize your queue.
  - Allows clearing slots with the **"X"** button, which releases the prospect back to the pending pool.
* **Prompt Copy-Buttons**:
  - **Q1 (Operations)**: Copies the query and automatically opens a new Google tab with `&udm=50` (forces Google to render the clean **AI Overview** layout).
  - **Q2 (Alignment)** & **Q3 (Contact)**: Copies value-proposition and contact queries to your clipboard.
* **Consolidated Submit**: When you have pasted search outputs into the textareas of one or more slots, the unified **Submit & Verify** button activates. Clicking it:
  1. Sends parallel `POST` requests to `/api/verify` for all fully filled slots.
  2. Updates progress stats in the header.
  3. Re-fills successfully completed slots with the next pending leads from the queue.

### 3. The Browser Userscript (`userscript.js`)
* **Bypassing the Same-Origin Policy (SOP)**: Modern browsers block direct messaging between cross-origin tabs (e.g., from `google.com` back to `localhost:8000`) and strip out `window.opener` references. 
* **Tampermonkey Privileged Storage API**:
  - When you press **`Alt+1`**, **`Alt+2`**, or **`Alt+3`** on the workbench, the script stores a `pendingSearch` context inside Tampermonkey's privileged storage (`GM_setValue`).
  - Upon opening Google, the script loads `pendingSearch`, cleans the query string (`cleanString` helper), and checks if they match.
  - On the Google search results page, a floating widget is rendered. Clicking **"Extract & Return"**:
    1. Grabs the text you highlighted with your mouse, OR falls back to extracting the `dn1Noc` AI Overview container.
    2. Writes the text to the `scrapedData` register.
    3. Closes the tab.
  - The workbench tab listens to the `scrapedData` change event (`GM_addValueChangeListener`), instantly updates the target textarea, and dispatches the reactive validation count.

### 4. The Verified Directory Dashboard (`http://localhost:8000/view`)
Once leads are verified, they can be reviewed and audited inside this premium, read-only panel.
* **Search & Filters**: Search by company, type, key products, or location. Filter lists by State and outreach priority.
* **Custom Markdown-to-HTML Parser**:
  - The scraper data contains raw markdown tables, headers, and bulleted lists.
  - The parser in `/view/index.js` splits content line-by-line and translates markdown symbols into styled elements (`<h2>`/`<h3>` tags, `<ul>`/`<li>` blocks, `<hr>` dividers, and HTML `<table>` cells).
* **Reference Links Grid**:
  - Aggregates verified reference URLs.
  - Automatically matches target domains against branding rules and renders custom card selectors with high-quality icons:
    - `linkedin.com` ➔ LinkedIn Icon (Blue)
    - `instagram.com` ➔ Instagram Icon (Pink/Magenta)
    - `facebook.com` ➔ Facebook Icon (Blue)
    - `youtube.com` ➔ YouTube Icon (Red)
    - Company Domain ➔ Website Icon (Green)
    - Source references ➔ Document Icon (Purple)

---

## ⚡ Productivity Guide (Hotkeys Workflow)
For maximum speed, follow this keyboard-driven workflow:

1. **Workbench Setup**: Open `http://localhost:8000`. Click inside the page to focus it. Slot 1 is active by default.
2. **Launch Q1**: Press **`Alt+1`**. A Google tab opens, searches for presence, and shows the AI Overview.
3. **Scrape Q1**: Highlight key lines if you want, or just click **Extract & Return** on the floating widget. The tab closes, and the Operations box on Slot 1 is instantly filled.
4. **Launch Q2**: Back on the workbench, press **`Alt+2`**. A Google search opens.
5. **Scrape Q2**: Click **Extract & Return**. Tab closes, and the Alignment box is filled.
6. **Launch Q3**: Press **`Alt+3`**. A Google search opens.
7. **Scrape Q3**: Click **Extract & Return**. Tab closes, and the Contact box is filled.
8. **Submit & Refill**: Press **`Enter`** on the consolidated button (or click it) to verify Slot 1 and automatically load the next lead!

---

## 🛠️ Customization

### Changing the Search Prompts
If you want to adjust the queries that are copied and sent to Google, modify the query templates in `web/index.js` (lines 239–243):
```javascript
const descQuery = `${prospect.company} operations in ${prospect.city} presence...`;
const alignQuery = `${prospect.company} operations and business activity...`;
const contactQuery = `${prospect.company} contact details, headquarters telephone...`;
```

### Adding New Link Icons
To add visual support for other social networks or domains in the directory links grid, modify the rules in `view/index.js` (lines 280–295):
```javascript
if (val.includes('twitter.com') || k.includes('twitter')) {
    return { icon: 'fa-brands fa-twitter', cls: 'twitter' };
}
```
Add matching colors for your new class (e.g. `.link-card.twitter i { color: #1da1f2; }`) inside [view/index.css](view/index.css).
