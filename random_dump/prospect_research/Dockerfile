FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

# Set working directory
WORKDIR /app

# Copy requirements file
COPY requirements.txt .

# Install python packages
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY research_finder.py .
COPY prospects.json .

# Run the python script by default
CMD ["python", "research_finder.py"]
