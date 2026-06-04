# AgentGate — 多阶段构建
# 使用方式:
#   docker build -t agentgate .
#   docker run -p 3000:3000 -p 8444:8444 agentgate

# ─── 构建阶段 ──────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── 运行阶段 ──────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# 只复制生产依赖和编译产物
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist/ ./dist/

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/v1/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

EXPOSE 3000 8444

ENV AGENTGATE_REST_PORT=3000
ENV AGENTGATE_BRIDGE_PORT=8444

CMD ["node", "dist/index.js", "start"]
