﻿# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --only=production
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node","server/index.js"]
