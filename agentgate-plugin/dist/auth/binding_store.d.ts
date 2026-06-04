import type { ChannelBinding, ChannelType } from '../types.js';
export declare class BindingStore {
    private cache;
    private load;
    private save;
    /** 查询绑定：按信道类型 + 用户 ID */
    getBinding(channel: ChannelType, channelUserId: string): ChannelBinding | undefined;
    /** 查询绑定：按绑定 ID */
    getById(id: string): ChannelBinding | undefined;
    /** 创建新绑定 */
    createBinding(binding: Omit<ChannelBinding, 'id' | 'created_at' | 'last_seen_at'>): ChannelBinding;
    /** 更新最后活动时间 */
    updateLastSeen(id: string): void;
    /** 撤销绑定 */
    revokeBinding(id: string): void;
    /** 列出所有活跃绑定 */
    listActive(): ChannelBinding[];
    /** 列出特定信道的所有绑定 */
    listByChannel(channel: ChannelType): ChannelBinding[];
}
//# sourceMappingURL=binding_store.d.ts.map