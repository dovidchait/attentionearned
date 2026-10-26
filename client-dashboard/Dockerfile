FROM node:22-alpine

WORKDIR /app

# Copy package files and install production deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy app source
COPY . .

# users.json is volume-mounted or baked in at deploy time (never commit secrets)
# In Fly.io: set secrets via fly secrets set, bind users.json as a volume or bake it

EXPOSE 4000

CMD ["node", "server.js"]
