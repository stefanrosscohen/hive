FROM node:22-slim

# Install git (agents need it)
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Create workspace directory
RUN mkdir -p /app/workspace

# Configure git for the agent
RUN git config --global user.name "Hive Agent" && \
    git config --global user.email "hive@agent.bot"

ENV NODE_ENV=production
ENV WORKSPACE_DIR=/app/workspace

EXPOSE 3000

# Start in server mode (HTTP API + Telegram bot)
CMD ["node", "dist/index.js", "serve"]
