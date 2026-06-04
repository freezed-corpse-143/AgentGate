/**
 * AgentGate — 握手认证管理器
 *
 * 配对码生成/验证/过期清理。
 * 参考 Telegram 插件的 pairing 流程 (server.ts gate() + checkApprovals()):
 *   - 随机 6 字符十六进制码 (randomBytes(3).toString('hex'))
 *   - 1 小时过期
 *   - 最多回复 2 次，然后静默
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
const AGENTGATE_DIR = process.env.AGENTGATE_DIR ?? join(homedir(), '.agentgate');
const PENDING_FILE = join(AGENTGATE_DIR, 'pending.json');
const PAIRING_TTL_MS = 60 * 60 * 1000; // 1 小时
const MAX_PENDING = 10; // 最多 10 个待配对码
export class HandshakeManager {
    store;
    cache = null;
    constructor(store) {
        this.store = store;
    }
    load() {
        if (this.cache)
            return this.cache;
        try {
            const raw = readFileSync(PENDING_FILE, 'utf8');
            this.cache = JSON.parse(raw);
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                this.cache = [];
            }
            else {
                console.error(`[Handshake] Failed to load pending: ${err}`);
                this.cache = [];
            }
        }
        this.pruneExpired();
        return this.cache;
    }
    save() {
        mkdirSync(AGENTGATE_DIR, { recursive: true });
        try {
            writeFileSync(PENDING_FILE, JSON.stringify(this.cache, null, 2));
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Handshake] Save failed (retrying): ${msg}`);
            try {
                writeFileSync(PENDING_FILE, JSON.stringify(this.cache, null, 2));
            }
            catch { }
        }
    }
    /** 清理过期配对码 (参考 Telegram 插件 pruneExpired) */
    pruneExpired() {
        const now = Date.now();
        const before = this.cache?.length ?? 0;
        if (this.cache) {
            this.cache = this.cache.filter(p => p.expires_at > now);
        }
        const pruned = before - (this.cache?.length ?? 0);
        if (pruned > 0)
            this.save();
        return pruned;
    }
    /** 获取待配对记录 */
    getPending(channel, channelUserId) {
        return this.load().find(p => p.channel_type === channel && p.channel_user_id === channelUserId);
    }
    /** 生成配对码
     *  参考 Telegram 插件: randomBytes(3).toString('hex') → 6 字符 hex 码
     */
    createPairing(channel, channelUserId, chatId) {
        this.load();
        // 检查已有未过期配对
        const existing = this.cache.find(p => p.channel_type === channel && p.channel_user_id === channelUserId && p.expires_at > Date.now());
        if (existing)
            return existing.code;
        // 容量检查
        if (this.cache.length >= MAX_PENDING) {
            this.pruneExpired();
            if (this.cache.length >= MAX_PENDING) {
                throw new Error('Too many pending pairings');
            }
        }
        const code = randomBytes(3).toString('hex');
        const now = Date.now();
        this.cache.push({
            code,
            channel_type: channel,
            channel_user_id: channelUserId,
            chat_id: chatId,
            created_at: now,
            expires_at: now + PAIRING_TTL_MS,
            replies: 1,
        });
        this.save();
        return code;
    }
    /** 验证配对码 → 创建绑定 */
    verifyPairing(code, agentId, principalId) {
        this.load();
        const idx = this.cache.findIndex(p => p.code === code && p.expires_at > Date.now());
        if (idx === -1)
            return null;
        const pending = this.cache[idx];
        this.cache.splice(idx, 1);
        this.save();
        // 创建绑定
        return this.store.createBinding({
            channel_type: pending.channel_type,
            channel_user_id: pending.channel_user_id,
            principal_id: principalId,
            agent_id: agentId,
            permissions: ['read', 'write'],
            status: 'active',
        });
    }
    /** 拒绝配对码 */
    denyPairing(code) {
        this.load();
        const idx = this.cache.findIndex(p => p.code === code);
        if (idx === -1)
            return false;
        this.cache.splice(idx, 1);
        this.save();
        return true;
    }
}
//# sourceMappingURL=handshake.js.map