# Use official Node.js image with Playwright dependencies pre-installed
FROM mcr.microsoft.com/playwright:v1.57.0-jammy

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (skip postinstall to avoid conflicts)
RUN npm install --ignore-scripts

# Install Playwright Chromium browser
RUN npx playwright install chromium

# Copy application files
COPY . .

# Expose port (Render will override this with PORT env var)
EXPOSE 4400

# Start the application
CMD ["node", "server.js"]
