# One container serves the API and the web app. Mount a persistent volume at /data.
FROM node:22-slim
WORKDIR /srv/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY backend/ ./
COPY app/www /srv/app/www
ENV NODE_ENV=production PORT=4000 WEB_DIR=/srv/app/www DB_PATH=/data/callnbarb.db UPLOAD_DIR=/data/uploads
EXPOSE 4000
CMD ["npx", "tsx", "src/server.ts"]
