import os
import sys
import json
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Lock

# Add parent directory to sys.path to import from research_finder.py
PARENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(PARENT_DIR)

from research_finder import extract_and_clean_all_links, filter_valid_ai_links

# Lock for safe atomic writes
file_lock = Lock()

class ProspectServer(BaseHTTPRequestHandler):
    def end_headers(self):
        # Prevent browser caching for local testing
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        if path == "/" or path == "/index.html":
            self.serve_file(os.path.join(os.path.dirname(__file__), "index.html"), "text/html")
        elif path == "/index.css":
            self.serve_file(os.path.join(os.path.dirname(__file__), "index.css"), "text/css")
        elif path == "/index.js":
            self.serve_file(os.path.join(os.path.dirname(__file__), "index.js"), "application/javascript")
        elif path == "/view" or path == "/view/" or path == "/view/index.html":
            self.serve_file(os.path.join(PARENT_DIR, "view", "index.html"), "text/html")
        elif path == "/view/index.css":
            self.serve_file(os.path.join(PARENT_DIR, "view", "index.css"), "text/css")
        elif path == "/view/index.js":
            self.serve_file(os.path.join(PARENT_DIR, "view", "index.js"), "application/javascript")
        elif path == "/api/prospects":
            prospects_path = os.path.join(PARENT_DIR, "prospects.json")
            value_path = os.path.join(PARENT_DIR, "value.txt")
            
            value_text = ""
            if os.path.exists(value_path):
                try:
                    with open(value_path, "r") as f:
                        value_text = f.read().strip()
                except Exception:
                    pass

            try:
                with open(prospects_path, "r") as f:
                    prospects = json.load(f)
                self.send_json({
                    "prospects": prospects,
                    "value_text": value_text
                })
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        elif path == "/api/verified":
            verified_path = os.path.join(PARENT_DIR, "prospects_verified.json")
            if not os.path.exists(verified_path):
                # Initialize as empty list if doesn't exist
                with open(verified_path, "w") as f:
                    json.dump([], f)
            self.serve_file(verified_path, "application/json")
        else:
            self.send_error(404, "File Not Found")

    def do_POST(self):
        if self.path == "/api/verify":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                payload = json.loads(post_data.decode('utf-8'))
                prospect = payload.get("prospect", {})
                pasted_desc = payload.get("pasted_description", "")
                pasted_align = payload.get("pasted_alignment", "")
                pasted_contact = payload.get("pasted_contact", "")

                company = prospect.get("company")
                if not company:
                    self.send_json({"error": "Missing company name"}, 400)
                    return

                # Clean the inputs and extract links
                clean_desc, updated_links = extract_and_clean_all_links(pasted_desc, {})
                clean_align, updated_links = extract_and_clean_all_links(pasted_align, updated_links)
                clean_contact, final_links = extract_and_clean_all_links(pasted_contact, updated_links)
                final_links = filter_valid_ai_links(final_links)

                result = {
                    "state": prospect.get("state"),
                    "company": company,
                    "type": prospect.get("type"),
                    "description": clean_desc,
                    "reason_alignment": clean_align,
                    "contact": clean_contact,
                    "website": prospect.get("website"),
                    "outreachPriority": prospect.get("outreachPriority"),
                    "annualCapacity": prospect.get("annualCapacity"),
                    "keyProductsNeeded": prospect.get("keyProductsNeeded"),
                    "links": final_links
                }

                # Save atomically
                output_path = os.path.join(PARENT_DIR, "prospects_verified.json")
                with file_lock:
                    current_results = []
                    if os.path.exists(output_path):
                        try:
                            with open(output_path, 'r') as f:
                                current_results = json.load(f)
                        except Exception:
                            pass

                    # Update or append
                    replaced = False
                    for i, item in enumerate(current_results):
                        if item.get("company") == company:
                            current_results[i] = result
                            replaced = True
                            break
                    if not replaced:
                        current_results.append(result)

                    temp_path = output_path + ".tmp"
                    with open(temp_path, 'w') as f:
                        json.dump(current_results, f, indent=2)
                    os.replace(temp_path, output_path)

                self.send_json({"success": True, "result": result})
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        else:
            self.send_error(404, "Endpoint Not Found")

    def serve_file(self, file_path, content_type):
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception:
            self.send_error(500, "Internal Server Error")

    def send_json(self, data, status_code=200):
        response_bytes = json.dumps(data).encode('utf-8')
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

def run(port=8000):
    server_address = ('127.0.0.1', port) # Listen on localhost only for secure local testing
    httpd = HTTPServer(server_address, ProspectServer)
    print(f"🚀 Prospect Manual Research Server running on http://127.0.0.1:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()

if __name__ == "__main__":
    run()
