import os
import json
import time
import logging
import re
import random
import threading
import copy
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
from playwright_stealth import stealth_sync

# Thread-local storage for browser reuse across tasks in the same worker thread
thread_local = threading.local()

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("ProspectResearch")

# Thread locks for safe file writing and console logging
file_lock = Lock()
print_lock = Lock()
captcha_lock = Lock()

# Load .env file manually if it exists to support local execution environment configuration
try:
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(env_file):
        env_file = ".env"
    if os.path.exists(env_file):
        with open(env_file, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ[key.strip()] = val.strip()
except Exception as e:
    logger.error(f"Failed to read .env file: {e}")

# Concurrency limits and proxy configurations from environment
CONCURRENCY_LIMIT = int(os.environ.get("CONCURRENCY_LIMIT", 4))
PROXY_URL = os.environ.get("PROXY_URL") # e.g. "http://user:password@proxyhost:port"
HEADLESS = os.environ.get("HEADLESS", "True").lower() in ("true", "1", "yes")

# Load rotated proxies from proxies.txt if available
PROXIES = []
try:
    # Look for proxies.txt in current workspace directory or beside this script
    proxies_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proxies.txt")
    if not os.path.exists(proxies_file):
        proxies_file = "proxies.txt"
        
    if os.path.exists(proxies_file):
        with open(proxies_file, "r") as f:
            for line in f:
                p = line.strip()
                if p and not p.startswith("#"):
                    if not p.startswith("http://") and not p.startswith("https://"):
                        p = "http://" + p
                    PROXIES.append(p)
        logger.info(f"Loaded {len(PROXIES)} proxy URLs from {proxies_file} for rotation.")
except Exception as e:
    logger.error(f"Failed to load proxies.txt: {e}")

# Load value.txt contents for Reason Alignment Query if available
VALUE_TEXT_CLEANED = ""
try:
    value_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "value.txt")
    if not os.path.exists(value_file):
        value_file = "value.txt"
        
    if os.path.exists(value_file):
        with open(value_file, "r") as f:
            value_raw = f.read().strip()
        # Replace newlines and excessive whitespace with single spaces for the search query
        VALUE_TEXT_CLEANED = re.sub(r'\s+', ' ', value_raw)
        logger.info(f"Loaded and cleaned value.txt ({len(VALUE_TEXT_CLEANED)} chars) for reason alignment.")
except Exception as e:
    logger.error(f"Failed to load value.txt: {e}")

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
]

def close_thread_browser():
    if hasattr(thread_local, "playwright"):
        try:
            thread_local.context.close()
        except Exception:
            pass
        try:
            thread_local.playwright.stop()
        except Exception:
            pass
        delattr(thread_local, "playwright")
        if hasattr(thread_local, "context"):
            delattr(thread_local, "context")

def get_browser_context(proxy_url=None, force_headless=None):
    """
    Get or create a thread-local persistent browser context.
    This stores cookies/state in a local folder for each thread to avoid CAPTCHAs,
    while ensuring safe parallel locks per thread.
    """
    headless_mode = HEADLESS if force_headless is None else force_headless

    # If thread_local has a context, but the headless mode requested doesn't match the context's launched mode,
    # we must close and recreate it.
    if hasattr(thread_local, "playwright"):
        if getattr(thread_local, "is_headless", True) != headless_mode:
            close_thread_browser()

    if not hasattr(thread_local, "playwright"):
        with print_lock:
            logger.info(f"Initializing Playwright and browser context (headless={headless_mode}) for current worker thread...")
        thread_local.playwright = sync_playwright().start()
        
        # Select random UA and match platform header
        ua = random.choice(USER_AGENTS)
        platform = "macOS" if "Macintosh" in ua else "Windows"
        
        extra_headers = {
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "accept-language": "en-US,en;q=0.9",
            "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": f'"{platform}"',
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "none",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1"
        }

        # Configure context-specific proxy if provided
        context_proxy = None
        if proxy_url:
            try:
                parsed = urllib.parse.urlparse(proxy_url)
                server = f"{parsed.scheme}://{parsed.hostname}"
                if parsed.port:
                    server += f":{parsed.port}"
                
                context_proxy = {"server": server}
                if parsed.username:
                    context_proxy["username"] = parsed.username
                if parsed.password:
                    context_proxy["password"] = parsed.password
            except Exception as e:
                with print_lock:
                    logger.error(f"Error parsing proxy URL '{proxy_url}': {e}")
                context_proxy = None

        # Determine thread identifier for persistent profile folder isolation
        thread_id = threading.get_ident()
        profile_dir = os.path.join(os.getcwd(), "browser_profiles", f"thread_{thread_id}")
        os.makedirs(profile_dir, exist_ok=True)

        # Launch persistent context
        thread_local.context = thread_local.playwright.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=headless_mode,
            ignore_default_args=["--enable-automation"],
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-infobars",
                "--start-maximized"
            ],
            user_agent=ua,
            viewport={"width": 1280, "height": 1000},
            proxy=context_proxy,
            locale="en-US",
            timezone_id="America/New_York",
            extra_http_headers=extra_headers
        )
        thread_local.is_headless = headless_mode
    
    return thread_local.context

def extract_html_links_and_clean_text(soup_element):
    """
    Traverses the BeautifulSoup element, extracts all links into a dictionary {Anchor Text: Direct URL},
    and cleans the HTML element by replacing <a> tags in-place with their plain text names.
    Returns (cleaned_text, links_dict).
    """
    links_dict = {}
    if not soup_element:
        return "", links_dict
        
    for a in soup_element.find_all('a'):
        href = a.get('href')
        if href:
            href_str = href.strip()
            # Clean up Google search redirections if present
            if href_str.startswith('/url?q='):
                match = re.search(r'/url\?q=([^&]+)', href_str)
                if match:
                    try:
                        href_str = urllib.parse.unquote(match.group(1))
                    except Exception:
                        pass
            
            # Skip empty or local anchor links
            if href_str.startswith('#') or not href_str.strip():
                continue
                
            link_text = a.get_text().strip()
            if link_text:
                # Add to links dictionary
                links_dict[link_text] = href_str
                # Replace the link element with just its text in the DOM
                a.replace_with(link_text)
            else:
                a.replace_with("")
                
    cleaned_text = soup_element.get_text(separator="\n", strip=True)
    return cleaned_text, links_dict

def filter_valid_ai_links(links_dict):
    """
    Filters a links dictionary to only keep valid, non-Google, absolute external links.
    Removes header/navigation/search links like 'All', 'Images', 'here', etc.
    """
    cleaned = {}
    irrelevant_titles = {"here", "all", "images", "videos", "news", "shopping", "books", "maps", "search", "play", "finance", "preferences"}
    irrelevant_domains = ["google.com", "gstatic.com", "google.co", "accounts.google", "youtube.com/feedback", "support.google"]
    
    for title, url in links_dict.items():
        title_clean = title.strip()
        title_lower = title_clean.lower()
        url_clean = url.strip()
        
        # 1. Skip if title is empty or in irrelevant titles
        if not title_clean or title_lower in irrelevant_titles:
            continue
        # 2. Skip if url is not absolute http/https
        if not (url_clean.startswith("http://") or url_clean.startswith("https://")):
            continue
        # 3. Skip if url is a Google domain or search link
        url_lower = url_clean.lower()
        if "/search?" in url_lower or "/url?" in url_lower:
            continue
        if any(dom in url_lower for dom in irrelevant_domains):
            continue
            
        cleaned[title_clean] = url_clean
    return cleaned

def extract_and_clean_all_links(text, existing_links=None):
    """
    Extracts markdown-formatted links and plain URLs from the text.
    Adds them to existing_links dictionary.
    Replaces markdown links with their title and removes plain URLs from the text.
    Returns (cleaned_text, updated_links).
    """
    if existing_links is None:
        links = {}
    else:
        links = copy.deepcopy(existing_links)
        
    if not text:
        return "", links

    # 1. Extract markdown links: [Title](URL)
    markdown_pattern = r'\[([^\]]+)\]\((https?://[^\s)]+)\)'
    matches = re.findall(markdown_pattern, text)
    for title, url in matches:
        title_str = title.strip()
        url_str = url.strip()
        # Clean up Google search redirections in url if present
        if url_str.startswith('https://www.google.com/url?q='):
            match_url = re.search(r'url\?q=([^&]+)', url_str)
            if match_url:
                try:
                    url_str = urllib.parse.unquote(match_url.group(1))
                except Exception:
                    pass
        # Clean up general redirect or tracking params if they are Google-specific
        if any(kw in url_str.lower() for kw in ["google.com", "gstatic.com", "accounts.google"]):
            continue
        links[title_str] = url_str
        
    # Replace [Title](URL) with Title in the text
    text = re.sub(markdown_pattern, r'\1', text)
    
    # 2. Extract and remove plain URLs in parentheses: (https://...)
    paren_url_pattern = r'\((https?://[^\s)]+)\)'
    paren_urls = re.findall(paren_url_pattern, text)
    for url in paren_urls:
        url_str = url.strip()
        if url_str.startswith('https://www.google.com/url?q='):
            match_url = re.search(r'url\?q=([^&]+)', url_str)
            if match_url:
                try:
                    url_str = urllib.parse.unquote(match_url.group(1))
                except Exception:
                    pass
        if any(kw in url_str.lower() for kw in ["google.com", "gstatic.com", "accounts.google"]):
            continue
        # If this URL is not in our links dictionary values, add it with a key derived from domain
        if url_str not in links.values():
            parsed_url = urllib.parse.urlparse(url_str)
            domain = parsed_url.netloc.replace("www.", "")
            key = f"{domain} Info"
            counter = 1
            original_key = key
            while key in links:
                key = f"{original_key} {counter}"
                counter += 1
            links[key] = url_str
            
    # Remove the (https://...) block entirely from the text
    text = re.sub(paren_url_pattern, '', text)
    
    # 3. Extract and remove standalone plain URLs: https://...
    plain_url_pattern = r'(?<!\[)(https?://[^\s()]+)(?!\])'
    plain_urls = re.findall(plain_url_pattern, text)
    for url in plain_urls:
        url_str = url.strip()
        if url_str.startswith('https://www.google.com/url?q='):
            match_url = re.search(r'url\?q=([^&]+)', url_str)
            if match_url:
                try:
                    url_str = urllib.parse.unquote(match_url.group(1))
                except Exception:
                    pass
        if any(kw in url_str.lower() for kw in ["google.com", "gstatic.com", "accounts.google"]):
            continue
        if url_str not in links.values():
            parsed_url = urllib.parse.urlparse(url_str)
            domain = parsed_url.netloc.replace("www.", "")
            key = f"{domain} Source"
            counter = 1
            original_key = key
            while key in links:
                key = f"{original_key} {counter}"
                counter += 1
            links[key] = url_str
            
    # Remove standalone plain URLs from text
    text = re.sub(plain_url_pattern, '', text)
    
    # Clean up any empty parentheses () left over
    text = re.sub(r'\(\s*\)', '', text)
    
    # Clean up any remaining double spaces, empty brackets or brackets with punctuation
    text = re.sub(r'\[\s*\]', '', text)
    
    # Clean up double newlines or excessive whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = text.strip()
    
    return text, links

def human_type(page, text):
    """
    Types text into the currently focused element character by character with human-like randomness:
    - Normal keystroke delays (40ms - 120ms).
    - Natural thinking pauses at word boundaries (spaces/punctuation) (250ms - 650ms).
    - Simulation of occasional typing errors (~1.5% chance) followed by Backspace and self-correction.
    """
    for char in text:
        # Typos simulation: 1.5% chance of making a typo if typing letters/digits
        if char.isalnum() and random.random() < 0.015:
            typo_char = random.choice("abcdefghijklmnopqrstuvwxyz")
            page.keyboard.type(typo_char)
            time.sleep(random.uniform(0.1, 0.25))
            page.keyboard.press("Backspace")
            time.sleep(random.uniform(0.1, 0.2))
            
        page.keyboard.type(char)
        time.sleep(random.uniform(0.04, 0.12))
        
        # Thinking pauses at spaces or punctuation
        if char in (" ", ",", ".", ";", "!", "?") and random.random() < 0.8:
            time.sleep(random.uniform(0.25, 0.65))

def wait_for_captcha_solved(page, search_criteria):
    """
    Polls the page content checking for captcha warning removal and search result elements load.
    Returns True if solved within timeout, False otherwise.
    """
    for attempt in range(150):
        time.sleep(2)
        try:
            current_html = page.content()
            current_text = BeautifulSoup(current_html, 'html.parser').get_text().lower()
            
            # Check if CAPTCHA text has disappeared
            if "unusual traffic from your computer" not in current_text and "enable javascript on your web browser" not in current_text:
                if any(x in current_html for x in ["id=\"search\"", "id=\"rso\"", "class=\"rso\"", "class=\"g\""]):
                    with print_lock:
                        logger.info("✅ [CAPTCHA] Solved successfully! Resuming...")
                    return True
            
            if attempt % 15 == 0:
                with print_lock:
                    logger.warning(f"⏳ Waiting for CAPTCHA to be solved for query: '{search_criteria}'...")
        except Exception as e:
            # If the browser window was closed manually, stop execution
            if "Target page, context or browser has been closed" in str(e):
                with print_lock:
                    logger.error(f"Error checking page status during CAPTCHA solving (browser closed): {e}")
                break
            # Otherwise (e.g. during page navigation), log and continue polling
            with print_lock:
                logger.info(f"Page is navigating or busy ({e}). Waiting...")
            time.sleep(1)
            continue
    return False

def search_google_ai(search_criteria, screenshot_path=None):
    """
    Search Google AI Overview with the specified search criteria.
    Saves a screenshot and returns raw text, links dict, AI Overview text, and AI Overview links dict.
    Optimized to block images, fonts, and media for fast loading.
    Reuses browser instances per thread.
    """
    encoded_criteria = search_criteria.replace(" ", "+")
    search_url = f"https://www.google.com/search?q={encoded_criteria}&udm=50"
    
    proxy_url = None
    if PROXIES:
        proxy_url = random.choice(PROXIES)
    elif PROXY_URL:
        proxy_url = PROXY_URL
        
    context = None
    try:
        context = get_browser_context(proxy_url)
        page = context.new_page()
        
        # Apply stealth evasions to mask Playwright attributes
        stealth_sync(page)

        # Route interception to block heavy assets (images, fonts, media)
        # This makes pages load significantly faster and saves massive bandwidth
        page.route("**/*", lambda route: route.abort() if route.request.resource_type in ["image", "font", "media"] else route.continue_())

        # Navigate to Google homepage first to mimic human entry point
        page.goto("https://www.google.com", wait_until="domcontentloaded", timeout=30000)
        
        # Locate search input box
        search_box_selector = "textarea[name='q'], input[name='q']"
        page.wait_for_selector(search_box_selector, timeout=10000)
        
        # Focus and click the search box
        page.focus(search_box_selector)
        page.click(search_box_selector)
        
        # Type the search criteria with human-like delays and typos
        human_type(page, search_criteria)
            
        # Press Enter to search
        page.keyboard.press("Enter")
        
        # Wait for search results page to load
        try:
            page.wait_for_selector("#search, #rso", timeout=15000)
        except Exception:
            pass
            
        # Check if there is an AI Overview tab to click (url contains udm=50)
        ai_tab_selector = "a[href*='udm=50']"
        try:
            if page.locator(ai_tab_selector).first.is_visible(timeout=3000):
                # Click the AI Overview tab
                page.locator(ai_tab_selector).first.click()
                # Wait for the AI tab page to load
                page.wait_for_load_state("domcontentloaded", timeout=10000)
        except Exception:
            # If the tab link is not found or fails to click, continue with the current page
            pass
        
        # Wait dynamically for either AI Overview, search results, or the Show More button to appear
        try:
            page.wait_for_selector("div:has-text('AI Overview'), #search, #rso, button:has-text('Show more')", timeout=4000)
        except Exception:
            # Fallback to a small sleep if timeout is reached
            time.sleep(1)

        # Try to expand "Show more" button if it exists
        show_more_selectors = [
            "button:has-text('Show more')",
            "div[role='button']:has-text('Show more')",
            "button[aria-label*='Show more']",
            "[aria-label*='AI Overview'] button",
            "[aria-label*='Show more']",
            "button[aria-expanded='false']"
        ]
        for selector in show_more_selectors:
            try:
                locator = page.locator(selector)
                if locator.first.is_visible(timeout=1000):
                    locator.first.click()
                    # Wait briefly for dynamic expansion to complete
                    time.sleep(1.5)
                    break
            except Exception:
                continue

        # Capture screenshot if path is provided
        if screenshot_path:
            with file_lock:
                os.makedirs(os.path.dirname(screenshot_path), exist_ok=True)
                page.screenshot(path=screenshot_path)
        
        html_content = page.content()
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Check for CAPTCHA / bot detection page text
        page_text = soup.get_text()
        if "enable javascript on your web browser" in page_text.lower() or "unusual traffic from your computer network" in page_text.lower():
            # If we are in headless mode, switch to headful mode dynamically to let the user solve CAPTCHA
            if getattr(thread_local, "is_headless", True):
                with print_lock:
                    logger.warning(f"⚠️ [CAPTCHA] Detected in headless mode for query: '{search_criteria}'. Switching to headful mode for manual solving...")
                
                # Close current headless page and context
                try:
                    page.close()
                except Exception:
                    pass
                if context:
                    try:
                        context.close()
                    except Exception:
                        pass
                    context = None
                
                # Close the thread-local headless browser
                close_thread_browser()
                
                # Acquire the global captcha lock so only one headful window opens at a time
                with captcha_lock:
                    with print_lock:
                        logger.warning(f"🚨 [ACTION REQUIRED] Please solve the CAPTCHA in the open browser window to proceed.")
                    
                    # Launch a headful browser context
                    context = get_browser_context(proxy_url, force_headless=False)
                    page = context.new_page()
                    stealth_sync(page)
                    
                    # Intercept resources for fast loading
                    page.route("**/*", lambda route: route.abort() if route.request.resource_type in ["image", "font", "media"] else route.continue_())
                    
                    # Navigate to search query page
                    page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
                    
                    # Poll page content until solved
                    solved = wait_for_captcha_solved(page, search_criteria)
                    
                    if not solved:
                        with print_lock:
                            logger.error("❌ [CAPTCHA] Not solved in time (timeout). Exiting...")
                        os._exit(1)
                    
                    # Capture screenshot of solved page if path is provided
                    if screenshot_path:
                        with file_lock:
                            os.makedirs(os.path.dirname(screenshot_path), exist_ok=True)
                            page.screenshot(path=screenshot_path)
                    
                    # Extract solved page content
                    html_content = page.content()
                    soup = BeautifulSoup(html_content, 'html.parser')
                    
                    # Close the headful context
                    try:
                        page.close()
                    except Exception:
                        pass
                    if context:
                        try:
                            context.close()
                        except Exception:
                            pass
                        context = None
                    
                    # Close the headful browser completely so we revert to headless next time
                    close_thread_browser()
            else:
                # We are already running in headful mode! Just let the user solve it in the existing window.
                with captcha_lock:
                    with print_lock:
                        logger.warning(f"🚨 [ACTION REQUIRED] CAPTCHA detected in the open browser window. Please solve it now to proceed...")
                    
                    solved = wait_for_captcha_solved(page, search_criteria)
                    if not solved:
                        with print_lock:
                            logger.error("❌ [CAPTCHA] Not solved in time (timeout). Exiting...")
                        os._exit(1)
                    
                    # Refresh page content and soup since CAPTCHA is now solved
                    html_content = page.content()
                    soup = BeautifulSoup(html_content, 'html.parser')
        
        # Convert links in the entire body to Markdown for body_text
        body_element = soup.find('body')
        if body_element:
            body_copy = copy.copy(body_element)
            body_text, body_links = extract_html_links_and_clean_text(body_copy)
        else:
            body_text = page.locator("body").inner_text()
            body_links = {}
            
        ai_overview_text = ""
        ai_overview_links = {}
        ai_header = soup.find(lambda tag: tag.name in ['h1', 'h2', 'h3', 'div', 'span'] and tag.get_text() and 'AI Overview' in tag.get_text())
        if ai_header:
            parent = ai_header.parent
            if parent:
                parent_copy = copy.copy(parent)
                ai_overview_text, ai_overview_links = extract_html_links_and_clean_text(parent_copy)
        
        return body_text, body_links, ai_overview_text, ai_overview_links

    except Exception as e:
        with print_lock:
            logger.error(f"Error scraping '{search_criteria}': {e}")
        # Self-healing: if Playwright/browser fails, clean up the thread_local state
        # so that the next task in this thread launches a clean instance.
        close_thread_browser()
        return "", {}, "", {}
    finally:
        if context:
            try:
                context.close()
            except Exception:
                pass


def extract_clean_ai_overview(body_text, criteria):
    """
    Extracts the clean AI Overview text from the raw body text.
    Funnels content following "You said: [query]" and stops at search results/footers.
    """
    lines = body_text.split('\n')
    start_collecting = False
    overview_paragraphs = []
    
    stop_dividers = [
        "people also ask", "web results", "videos", "images", "news",
        "search results", "feedback", "more results", "unfiltered results",
        "privacy", "terms", "sign in"
    ]
    
    for line in lines:
        cleaned_line = line.strip()
        if not cleaned_line:
            continue
            
        if start_collecting:
            lower_line = cleaned_line.lower()
            
            # Stop if we hit the AI Overview disclaimer (Google always appends this at the bottom of the card)
            if "ai can make mistakes" in lower_line:
                overview_paragraphs.append(cleaned_line)
                break
                
            # Stop if we hit any of the next major search section dividers exactly
            if any(lower_line == divider for divider in stop_dividers):
                break
                
            # Skip citation counts (e.g. "+3", "+4" button)
            if re.match(r'^\+\d+', cleaned_line):
                continue
                
            # Filter out standalone source/link button labels (e.g. "Clay", "Wikipedia", "LinkedIn")
            # These are short lines (less than 20 chars) that do not end in sentence punctuation, colons, or dashes
            if len(cleaned_line) < 20 and not cleaned_line.endswith(('.', '!', '?', '"', ')', ':', '-')):
                continue
                
            overview_paragraphs.append(cleaned_line)
            
        elif cleaned_line.lower().startswith("you said:"):
            start_collecting = True
            
    # Clean up any trailing link buttons
    if overview_paragraphs:
        while overview_paragraphs:
            last_line = overview_paragraphs[-1].strip()
            if len(last_line) < 30 and not last_line.endswith(('.', '!', '?', '"', ')', ':', '-')):
                overview_paragraphs.pop()
            else:
                break
                
        # If the first line is exactly the criteria, remove it
        if overview_paragraphs and overview_paragraphs[0].lower() == criteria.lower():
            overview_paragraphs.pop(0)
            
        return "\n\n".join(overview_paragraphs)
        
    return ""


def verify_prospect_details(prospect, body_text, ai_overview_text):
    """
    Directly parse details from Google Search and AI Overview text.
    Extracts JSON strings if Google AI formatted its output as JSON, otherwise falls back to keyword verification.
    """
    name = prospect.get("name", "")
    company = prospect.get("company", "")
    criteria = prospect.get("search_criteria", "")
    if not criteria:
        criteria = f"{name} {company}"

    # Extract the clean AI Overview text from body_text
    clean_overview = extract_clean_ai_overview(body_text, criteria)
    if not clean_overview:
        clean_overview = ai_overview_text
        
    search_space = clean_overview if clean_overview else body_text
    
    # Try to find a JSON block in the scraped text
    json_pattern = r'\{[\s\S]*?\}'
    matches = re.findall(json_pattern, search_space)
    
    for match in matches:
        try:
            cleaned = match.strip()
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict) and any(k in parsed for k in ["verification_status", "status", "role", "email"]):
                return parsed
        except json.JSONDecodeError:
            continue

    # Fallback to local heuristic rule-based parsing if no JSON block was returned
    text_lower = search_space.lower()
    
    name_matched = all(part.lower() in text_lower for part in name.split()) if name else False
    company_matched = company.lower() in text_lower if company else False
    
    # Extract email if present
    email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
    emails = re.findall(email_pattern, search_space)
    email = emails[0] if emails else None
    
    # Extract LinkedIn URL if present
    linkedin_pattern = r'https://[a-z]{2,3}\.linkedin\.com/in/[a-zA-Z0-9_-]+'
    linkedin_urls = re.findall(linkedin_pattern, search_space)
    linkedin_url = linkedin_urls[0] if linkedin_urls else None

    # Infer role if common job titles are near the name
    role = None
    common_roles = ["ceo", "cto", "cfo", "coo", "founder", "president", "director", "manager", "vice president", "vp"]
    for r in common_roles:
        if r in text_lower:
            role = r.upper()
            break

    status = "Unverified"
    notes = "Keyword matching fallback."
    score = 5
    
    if name_matched and company_matched:
        status = "Verified"
        notes = f"Google search text confirmed both name '{name}' and company '{company}'."
        score = 8
    elif name_matched:
        notes = f"Found name '{name}' but company '{company}' was not mentioned in search text."
        score = 4
    else:
        notes = f"Name '{name}' was not found in search text."
        score = 1

    return {
      "name": name,
      "company": company if company_matched else None,
      "role": role,
      "email": email,
      "linkedin_url": linkedin_url,
      "verification_status": status,
      "confidence_score": score,
      "details_summary": clean_overview if clean_overview else search_space[:500] + "...",
      "verification_notes": notes
    }


def process_single_prospect(index, total, prospect, screenshot_dir, output_path):
    """
    Scrapes description and contact details for a company and saves them.
    Saves incrementally to avoid data loss.
    """
    company = prospect.get("company", "Unknown")
    city = prospect.get("city", "")
    state = prospect.get("state", "")
    type_ = prospect.get("type", "")
    reason = prospect.get("reason", "")
    website = prospect.get("website", "")
    outreach_priority = prospect.get("outreachPriority", "")
    annual_capacity = prospect.get("annualCapacity", "")
    key_products_needed = prospect.get("keyProductsNeeded", [])
    
    with print_lock:
        logger.info(f"[{index}/{total}] Scraping: {company} (City: {city})")
    
    # Search 1: Description Query (focuses on existence and operations of the business in the city)
    criteria_desc = f"{company} operations in {city} presence, physical existence, factory office address and business activity"
    body_text_desc, body_links_desc, ai_overview_desc, ai_links_desc = search_google_ai(criteria_desc)
    clean_desc = extract_clean_ai_overview(body_text_desc, criteria_desc)
    if not clean_desc:
        clean_desc = ai_overview_desc if ai_overview_desc else (body_text_desc[:1000] + "..." if body_text_desc else "No search results found.")

    # Search 2: Reason Alignment Query (verifies alignment with our value proposition)
    alignment_ref = VALUE_TEXT_CLEANED if VALUE_TEXT_CLEANED else reason
    criteria_alignment = f"{company} operations and business activity - does it align with: {alignment_ref}"
    body_text_align, body_links_align, ai_overview_align, ai_links_align = search_google_ai(criteria_alignment)
    clean_alignment = extract_clean_ai_overview(body_text_align, criteria_alignment)
    if not clean_alignment:
        clean_alignment = ai_overview_align if ai_overview_align else (body_text_align[:1000] + "..." if body_text_align else "No search results found.")

    # Search 3: Contact Query (focuses on contact details, socials, website, and heads)
    criteria_contact = f"{company} contact details, headquarters telephone, email, executive head, website and social media profiles"
    body_text_contact, body_links_contact, ai_overview_contact, ai_links_contact = search_google_ai(criteria_contact)
    clean_contact = extract_clean_ai_overview(body_text_contact, criteria_contact)
    if not clean_contact:
        clean_contact = ai_overview_contact if ai_overview_contact else (body_text_contact[:1000] + "..." if body_text_contact else "No search results found.")

    # Merge links from all three searches (prioritize AI Overview links and filter irrelevant links)
    merged_links = {}
    merged_links.update(ai_links_desc)
    merged_links.update(ai_links_align)
    merged_links.update(ai_links_contact)
    
    # Extract links that are directly inside the text descriptions (e.g. Markdown or plain URLs)
    clean_desc, merged_links = extract_and_clean_all_links(clean_desc, merged_links)
    clean_alignment, merged_links = extract_and_clean_all_links(clean_alignment, merged_links)
    clean_contact, merged_links = extract_and_clean_all_links(clean_contact, merged_links)
    # Filter the merged links to only keep valid, non-Google, absolute external links.
    final_links = filter_valid_ai_links(merged_links)

    result = {
        "state": state,
        "company": company,
        "type": type_,
        "description": clean_desc,
        "reason_alignment": clean_alignment,
        "contact": clean_contact,
        "website": website,
        "outreachPriority": outreach_priority,
        "annualCapacity": annual_capacity,
        "keyProductsNeeded": key_products_needed,
        "links": final_links
    }
    
    # Thread-safe incremental save
    with file_lock:
        current_results = []
        if os.path.exists(output_path):
            try:
                with open(output_path, 'r') as f:
                    current_results = json.load(f)
            except Exception:
                pass
                
        # Update or append the result
        replaced = False
        for i, item in enumerate(current_results):
            if item.get("company") == company:
                current_results[i] = result
                replaced = True
                break
        if not replaced:
            current_results.append(result)
            
        # Write to temporary file and rename for atomic write safety
        temp_path = output_path + ".tmp"
        try:
            with open(temp_path, 'w') as f:
                json.dump(current_results, f, indent=2)
            os.replace(temp_path, output_path)
        except Exception as e:
            logger.error(f"Failed to write incremental results for {company}: {e}")

    # Introduce a small randomized delay to reduce rate limiting triggers.
    # If a proxy is configured, we can reduce the delay to process faster.
    has_proxy = bool(PROXY_URL or PROXIES)
    delay_min = 1.0 if has_proxy else 6.0
    delay_max = 3.0 if has_proxy else 15.0
    time.sleep(random.uniform(delay_min, delay_max))
    return result


def main():
    workspace_dir = "/Users/apple/Production/Prospect Research"
    if not os.path.exists(workspace_dir):
        workspace_dir = os.getcwd()

    input_path = os.path.join(workspace_dir, "prospects.json")
    output_path = os.path.join(workspace_dir, "prospects_verified.json")
    old_output_path = os.path.join(workspace_dir, "prospect_vefied.json")
    screenshot_dir = os.path.join(workspace_dir, "screenshots")

    if not os.path.exists(input_path):
        logger.error(f"Input file not found at: {input_path}")
        return

    with open(input_path, 'r') as f:
        try:
            prospects = json.load(f)
        except Exception as e:
            logger.error(f"Error parsing input prospects JSON: {e}")
            return

    # Migrate progress from the misspelled file if it exists
    migrated_results = []
    if os.path.exists(old_output_path):
        try:
            with open(old_output_path, 'r') as f:
                migrated_results = json.load(f)
            logger.info(f"Found old test run data in {old_output_path}. Migrating {len(migrated_results)} entries...")
            
            existing_results = []
            if os.path.exists(output_path):
                with open(output_path, 'r') as f:
                    existing_results = json.load(f)
            
            merged = {item["company"]: item for item in migrated_results if "company" in item}
            for item in existing_results:
                if "company" in item:
                    merged[item["company"]] = item
                    
            with open(output_path, 'w') as f:
                json.dump(list(merged.values()), f, indent=2)
                
            os.remove(old_output_path)
            logger.info(f"Migration successful. Removed {old_output_path}.")
        except Exception as e:
            logger.error(f"Failed to migrate old output file: {e}")

    # Initialize output file as empty JSON list if it doesn't exist
    if not os.path.exists(output_path):
        with open(output_path, 'w') as f:
            json.dump([], f)

    # Load and clean already verified prospects to enable skipping/resuming and consistent formats
    completed_companies = set()
    cleaned_completed_records = []
    if os.path.exists(output_path):
        try:
            needs_save = False
            with open(output_path, 'r') as f:
                completed = json.load(f)
                
            for item in completed:
                if item.get("company"):
                    # Check if this record is corrupted with a CAPTCHA block message
                    is_corrupted = False
                    for field in ["description", "contact", "reason alignment", "reason_alignment"]:
                        val = item.get(field, "")
                        if isinstance(val, str) and ("enable javascript on your web browser" in val or "unusual traffic from your computer network" in val):
                            is_corrupted = True
                            break
                    
                    if is_corrupted:
                        logger.warning(f"Removing corrupted CAPTCHA record for: {item.get('company')}")
                        needs_save = True
                        continue

                    orig_desc = item.get("description", "")
                    orig_contact = item.get("contact", "")
                    orig_align = item.get("reason_alignment")
                    if orig_align is None:
                        orig_align = item.get("reason alignment", "")
                    
                    orig_links = item.get("links", {})
                    if not isinstance(orig_links, dict):
                        orig_links = {}
                        
                    clean_desc, updated_links = extract_and_clean_all_links(orig_desc, orig_links)
                    clean_align, updated_links = extract_and_clean_all_links(orig_align, updated_links)
                    clean_contact, final_links = extract_and_clean_all_links(orig_contact, updated_links)
                    
                    # Apply the strict AI link filter
                    final_links = filter_valid_ai_links(final_links)
                    
                    item_modified = False
                    
                    if "reason alignment" in item:
                        item["reason_alignment"] = clean_align
                        del item["reason alignment"]
                        item_modified = True
                    else:
                        if item.get("reason_alignment") != clean_align:
                            item["reason_alignment"] = clean_align
                            item_modified = True
                            
                    if "reason" in item:
                        del item["reason"]
                        item_modified = True
                        
                    if (clean_desc != orig_desc or clean_contact != orig_contact or 
                        final_links != orig_links or "links" not in item):
                        item["description"] = clean_desc
                        item["contact"] = clean_contact
                        item["links"] = final_links
                        item_modified = True
                        
                    if item_modified:
                        needs_save = True
                        
                    cleaned_completed_records.append(item)
                    # A prospect is considered fully verified only if all three parsed fields are present
                    if item.get("description") and item.get("contact") and item.get("reason_alignment"):
                        completed_companies.add(item.get("company"))
            
            if needs_save:
                logger.info(f"Existing file {output_path} contains uncleaned inline links or missing fields. Saving cleaned records...")
                temp_path = output_path + ".tmp"
                with open(temp_path, 'w') as f:
                    json.dump(cleaned_completed_records, f, indent=2)
                os.replace(temp_path, output_path)
        except Exception as e:
            logger.warning(f"Could not read/clean existing output file for resuming: {e}")

    prospects_to_process = [p for p in prospects if p.get("company") not in completed_companies]
    
    total_loaded = len(prospects)
    total_to_process = len(prospects_to_process)
    skipped_count = total_loaded - total_to_process
    
    if skipped_count > 0:
        logger.info(f"Loaded {total_loaded} prospects. Skipped {skipped_count} already verified. Resuming with {total_to_process} prospects.")
    else:
        logger.info(f"Loaded {total_loaded} prospects. Processing all.")

    if total_to_process == 0:
        logger.info("All prospects have already been processed! Nothing to do.")
        return

    logger.info(f"Using concurrency limit of {CONCURRENCY_LIMIT} workers.")
    start_time = time.time()

    # Execute tasks concurrently using ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=CONCURRENCY_LIMIT) as executor:
        futures = []
        for i, prospect in enumerate(prospects_to_process):
            futures.append(
                executor.submit(
                    process_single_prospect,
                    i + 1,
                    total_to_process,
                    prospect,
                    screenshot_dir,
                    output_path
                )
            )
            
        # Monitor thread execution progress
        for future in as_completed(futures):
            try:
                future.result()
            except Exception as e:
                logger.error(f"A thread encountered an error: {e}")

    end_time = time.time()
    elapsed_time = end_time - start_time
    logger.info(f"Saved all verified results to: {output_path}")
    logger.info(f"Processed {total_to_process} prospects in {elapsed_time:.2f} seconds.")


if __name__ == "__main__":
    main()
