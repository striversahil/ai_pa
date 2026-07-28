#!/bin/bash

# Ensure we are in the script directory
cd "$(dirname "$0")"

# Check if .env file exists, create a template if it doesn't
if [ ! -f .env ]; then
  echo "⚠️  No .env file found. Creating a template .env file..."
  echo "# Scraping Configuration" > .env
  echo "CONCURRENCY_LIMIT=4" >> .env
  echo "# PROXY_URL is highly recommended for 100+ prospects to avoid Google Search rate limits" >> .env
  echo "# Example: PROXY_URL=http://user:pass@proxy-provider.com:8080" >> .env
  echo "PROXY_URL=" >> .env
  echo "Please edit the .env file if you wish to adjust concurrency or configure a proxy."
fi

echo "🚀 Building and launching the Prospect Research Finder container..."
docker compose up --build
