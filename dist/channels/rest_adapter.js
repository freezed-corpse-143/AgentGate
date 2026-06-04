/**
 * AgentGate — REST/WebSocket 信道适配器
 *
 * 提供 HTTP POST + WebSocket 接入，供外部系统或浏览器控制台使用。
 *
 * 路由:
 *   POST /v1/messages          — 外部系统推送消息
 *   POST /v1/handshake/pair    — 请求配对码
 *   POST /v1/handshake/verify  — 验证配对码
 *   GET  /v1/health            — 健康检查
 *   WS   /v1/stream            — 双向实时通道
 */
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
// admin.html = src/../browser/admin.html → browser/admin.html
const ADMIN_HTML = resolve(dirname(__filename), '..', '..', 'browser', 'admin.html');
export class RESTAdapter {
    channelType = 'rest';
    httpServer = null;
    wss = null;
    callback = null;
    wsClients = new Set();
    options;
    convStore;
    bus;
    /** SSE 客户端 */
    sseClients = new Set();
    /** 启动时间 */
    startedAt = new Date().toISOString();
    constructor(options) {
        this.options = options;
        this.convStore = options.conversationStore;
        this.bus = options.bus;
        this.setupBusListener();
    }
    /** 监听 Bus 事件并广播给 SSE/WS 客户端 */
    setupBusListener() {
        if (!this.bus)
            return;
        this.bus.subscribe('*', (envelope, topic) => {
            const event = { type: 'envelope', topic, envelope, timestamp: new Date().toISOString() };
            const json = JSON.stringify(event);
            // 广播给 SSE 客户端
            for (const sse of this.sseClients) {
                try {
                    sse.write(`data: ${json}\n\n`);
                }
                catch {
                    this.sseClients.delete(sse);
                }
            }
            // 广播给 WebSocket 客户端
            for (const ws of this.wsClients) {
                try {
                    ws.send(json);
                }
                catch {
                    this.wsClients.delete(ws);
                }
            }
        });
    }
    onMessage(callback) {
        this.callback = callback;
    }
    async start() {
        const { port, host = '0.0.0.0' } = this.options;
        this.httpServer = createServer((req, res) => {
            // CORS 头
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }
            // 路由分发
            const url = new URL(req.url ?? '/', `http://${host}`);
            const path = url.pathname;
            if (req.method === 'POST' && path === '/v1/messages') {
                this.handleInboundMessage(req, res);
            }
            else if (req.method === 'POST' && path === '/v1/handshake/pair') {
                this.handlePair(req, res);
            }
            else if (req.method === 'POST' && path === '/v1/handshake/verify') {
                this.handleVerify(req, res);
            }
            else if (req.method === 'GET' && path === '/v1/health') {
                this.handleHealth(req, res);
            }
            else if (req.method === 'GET' && path === '/v1/conversations') {
                this.handleListConversations(res);
            }
            else if (req.method === 'GET' && path.match(/^\/v1\/conversations\/([^/]+)\/messages$/)) {
                this.handleGetMessages(req, res, path.match(/^\/v1\/conversations\/([^/]+)\/messages$/)?.[1] ?? '');
            }
            else if (req.method === 'DELETE' && path.match(/^\/v1\/conversations\/([^/]+)$/)) {
                this.handleDeleteConversation(res, path.match(/^\/v1\/conversations\/([^/]+)$/)?.[1] ?? '');
            }
            else if (req.method === 'GET' && path === '/v1/events') {
                this.handleSSE(req, res);
            }
            else if (req.method === 'GET' && (path === '/' || path === '/dashboard')) {
                this.handleDashboard(res);
            }
            else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not Found' }));
            }
        });
        // WebSocket Server
        this.wss = new WebSocketServer({ server: this.httpServer, path: '/v1/stream' });
        this.wss.on('connection', (ws) => {
            this.wsClients.add(ws);
            console.error('[REST] WebSocket client connected');
            ws.on('message', (data) => {
                try {
                    const json = JSON.parse(data.toString());
                    this.handleWSMessage(json, ws);
                }
                catch {
                    ws.send(JSON.stringify({ error: 'Invalid JSON' }));
                }
            });
            ws.on('close', () => {
                this.wsClients.delete(ws);
                console.error('[REST] WebSocket client disconnected');
            });
        });
        return new Promise((resolve) => {
            this.httpServer.listen(port, host, () => {
                console.error(`[REST] Server listening on http://${host}:${port}`);
                console.error(`[REST] WebSocket on ws://${host}:${port}/v1/stream`);
                resolve();
            });
        });
    }
    async stop() {
        // 关闭所有 WebSocket 连接
        for (const ws of this.wsClients) {
            ws.close();
        }
        this.wsClients.clear();
        // 关闭 WebSocket Server
        this.wss?.close();
        // 关闭 HTTP Server
        return new Promise((resolve) => {
            this.httpServer?.close(() => resolve());
        });
    }
    async send(envelope) {
        // 通过 WebSocket 广播给所有已连接客户端
        const msg = JSON.stringify(envelope);
        for (const ws of this.wsClients) {
            ws.send(msg);
        }
    }
    // ─── HTTP Handler ──────────────────────────────────────────
    async handleInboundMessage(req, res) {
        try {
            const body = await this.readBody(req);
            const data = JSON.parse(body);
            const raw = {
                channel: 'rest',
                channel_user_id: data.user_id ?? 'anonymous',
                chat_id: data.chat_id ?? 'default',
                text: data.text ?? '',
                message_id: `rest_${Date.now()}`,
                metadata: data.metadata,
            };
            this.callback?.(raw);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'received', message_id: raw.message_id }));
        }
        catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
        }
    }
    async handlePair(req, res) {
        if (!this.options.handshake) {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Handshake not configured' }));
            return;
        }
        try {
            const body = await this.readBody(req);
            const data = JSON.parse(body);
            const channelType = data.channel_type ?? 'rest';
            const code = this.options.handshake.createPairing(channelType, data.user_id ?? 'anonymous', data.chat_id ?? 'default');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code }));
        }
        catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
        }
    }
    async handleVerify(req, res) {
        if (!this.options.handshake) {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Handshake not configured' }));
            return;
        }
        try {
            const body = await this.readBody(req);
            const data = JSON.parse(body);
            const binding = this.options.handshake.verifyPairing(data.code, data.agent_id ?? 'default', data.principal_id ?? data.user_id ?? 'anonymous');
            if (binding) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'paired', binding }));
            }
            else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid or expired code' }));
            }
        }
        catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
        }
    }
    handleHealth(_req, res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            websocket_clients: this.wsClients.size,
        }));
    }
    // ─── WebSocket Handler ─────────────────────────────────────
    handleWSMessage(data, ws) {
        const raw = {
            channel: 'websocket',
            channel_user_id: data.user_id ?? 'anonymous',
            chat_id: data.chat_id ?? 'default',
            text: data.text ?? '',
            message_id: `ws_${Date.now()}`,
            metadata: data.metadata,
        };
        this.callback?.(raw);
    }
    // ─── SSE ─────────────────────────────────────────────────
    handleSSE(_req, res) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        // 发送初始连接事件
        res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
        this.sseClients.add(res);
        console.error('[REST] SSE client connected');
        // 客户端断开时清理
        _req.on('close', () => {
            this.sseClients.delete(res);
            console.error('[REST] SSE client disconnected');
        });
    }
    // ─── 仪表盘 ──────────────────────────────────────────────
    handleDashboard(res) {
        if (existsSync(ADMIN_HTML)) {
            const html = readFileSync(ADMIN_HTML, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        }
        else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html><html><head><title>AgentGate</title></head><body>
<h1>AgentGate Dashboard</h1>
<p>Dashboard file not found. Create <code>browser/admin.html</code>.</p>
</body></html>`);
        }
    }
    // ─── 对话历史 API ─────────────────────────────────────────
    handleListConversations(res) {
        if (!this.convStore) {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ConversationStore not configured' }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.convStore.listConversations()));
    }
    handleGetMessages(req, res, convId) {
        if (!this.convStore) {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ConversationStore not configured' }));
            return;
        }
        const url = new URL(req.url ?? '/', 'http://localhost');
        const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
        const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
        const messages = this.convStore.getMessages(convId, { limit, offset });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages, total: messages.length }));
    }
    handleDeleteConversation(res, convId) {
        if (!this.convStore) {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ConversationStore not configured' }));
            return;
        }
        const ok = this.convStore.deleteConversation(convId);
        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ deleted: ok }));
    }
    // ─── 工具 ──────────────────────────────────────────────────
    readBody(req) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', () => resolve(Buffer.concat(chunks).toString()));
            req.on('error', reject);
        });
    }
}
//# sourceMappingURL=rest_adapter.js.map