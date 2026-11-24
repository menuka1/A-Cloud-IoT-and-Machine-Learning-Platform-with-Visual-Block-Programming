FROM node:24-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 MQTT_PORT=1883
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000 1883
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/index.js"]
