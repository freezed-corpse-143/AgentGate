import type { ChannelType, PendingPairing, ChannelBinding } from '../types.js';
import { BindingStore } from './binding_store.js';
export declare class HandshakeManager {
    private store;
    private cache;
    constructor(store: BindingStore);
    private load;
    private save;
    /** 清理过期配对码 (参考 Telegram 插件 pruneExpired) */
    pruneExpired(): number;
    /** 获取待配对记录 */
    getPending(channel: ChannelType, channelUserId: string): PendingPairing | undefined;
    /** 生成配对码
     *  参考 Telegram 插件: randomBytes(3).toString('hex') → 6 字符 hex 码
     */
    createPairing(channel: ChannelType, channelUserId: string, chatId: string): string;
    /** 验证配对码 → 创建绑定 */
    verifyPairing(code: string, agentId: string, principalId: string): ChannelBinding | null;
    /** 拒绝配对码 */
    denyPairing(code: string): boolean;
}
//# sourceMappingURL=handshake.d.ts.map