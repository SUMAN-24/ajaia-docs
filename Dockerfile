# --- 1. build the React client ---------------------------------------------
FROM node:22-bookworm-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client ./
RUN npm run build

# --- 2. runtime: Express serves the API and the built client ---------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/docs.db
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server ./
COPY --from=client /app/client/dist /app/client/dist
# Runs as root on purpose: platform-mounted volumes (e.g. Render disks) are root-owned and a
# non-root user couldn't create the SQLite file. Tighten with USER node if your volume allows it.
RUN mkdir -p /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
