# Two stages: compile with the toolchain, ship with production dependencies only.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY assets ./assets
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    VERDICT_LOG_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
# The map GeoJSON files. Without them the server starts with the map off.
COPY data/map ./data/map

# The verdict log lives here. A new named volume copies this ownership.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080

# The image has no curl, so the check uses the Node runtime. The first start
# waits up to 10 seconds for upstream data, hence the 20 second start period.
HEALTHCHECK --interval=30s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node","dist/index.js"]
