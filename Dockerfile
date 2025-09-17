FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --only=production
COPY . .
EXPOSE 8787
CMD ["node","server/index.js"]
