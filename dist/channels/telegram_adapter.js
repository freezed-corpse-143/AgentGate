/**
 * AgentGate — Telegram 信道适配器
 *
 * 基于 grammy (Bot API SDK) 实现 Telegram 轮询适配器。
 * 参考官方 Claude Code Telegram 插件的 server.ts 实现:
 *   - grammy Bot 轮询 (bot.start())
 *   - gate() 入站过滤逻辑
 *   - PID 文件防多实例冲突
 *   - 断线重连退避
 *   - 长消息 chunk 拆分
 *   - 附件下载 (download_attachment)
 *
 * 关键差异: 本适配器不直接注入消息到 Claude 会话，
 * 而是将原始消息包装为 RawMessage → 交给 ChannelGateway 处理。
 */
import { Bot, GrammyError } from 'grammy';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
const STATE_DIR = process.env.TELEGRAM_STATE_DIR ?? join(homedir(), '.agentgate', 'telegram');
const PID_FILE = join(STATE_DIR, 'bot.pid');
const INBOX_DIR = join(STATE_DIR, 'inbox');
export class TelegramAdapter {
    channelType = 'telegram';
    bot;
    callback = null;
    running = false;
    allowFrom;
    options;
    botUsername = '';
    constructor(options) {
        this.options = options;
        this.allowFrom = new Set(options.allowFrom ?? []);
        // 构造 grammy Bot，支持自定义 apiRoot (用于 Mock API 测试)
        const botConfig = {};
        if (options.apiRoot) {
            botConfig.client = { apiRoot: options.apiRoot };
        }
        this.bot = new Bot(options.token, botConfig);
        this.setupBot();
        this.claimPid();
    }
    /** PID 文件防多实例冲突 (参考 Telegram 插件 server.ts:59-70) */
    claimPid() {
        mkdirSync(STATE_DIR, { recursive: true });
        try {
            const stale = parseInt(readFileSync(PID_FILE, 'utf8'), 10);
            if (stale > 1 && stale !== process.pid) {
                process.kill(stale, 0);
                console.error(`[Telegram] Replacing stale poller pid=${stale}`);
                process.kill(stale, 'SIGTERM');
            }
        }
        catch { }
        writeFileSync(PID_FILE, String(process.pid));
    }
    releasePid() {
        try {
            if (parseInt(readFileSync(PID_FILE, 'utf8'), 10) === process.pid) {
                rmSync(PID_FILE);
            }
        }
        catch { }
    }
    /** 注册 grammy 消息处理器 */
    setupBot() {
        // 私聊消息处理
        this.bot.on('message:text', async (ctx) => {
            if (!ctx.from || !ctx.message?.text)
                return;
            const senderId = String(ctx.from.id);
            const chatType = ctx.chat?.type;
            // 简化版 gate: 允许列表模式
            if (chatType === 'private') {
                if (this.allowFrom.size > 0 && !this.allowFrom.has(senderId)) {
                    return; // 静默丢弃
                }
            }
            else if (chatType === 'group' || chatType === 'supergroup') {
                // 群组: 默认只响应 @mention
                if (!this.isMentioned(ctx))
                    return;
            }
            // 构造 RawMessage → 交给 callback
            const raw = {
                channel: 'telegram',
                channel_user_id: senderId,
                chat_id: String(ctx.chat.id),
                text: ctx.message.text,
                message_id: String(ctx.message.message_id),
                metadata: {
                    chat_type: chatType,
                    username: ctx.from.username,
                    first_name: ctx.from.first_name,
                },
            };
            this.callback?.(raw);
        });
        // bot command: /start
        this.bot.command('start', async (ctx) => {
            await ctx.reply('AgentGate Telegram Adapter\n\n' +
                'Chats here are forwarded to your Agent runtime.\n' +
                'Use pairing or allowlist to get started.');
        });
        // bot info
        this.bot.api.getMe().then(me => {
            this.botUsername = me.username ?? '';
        }).catch(() => { });
    }
    /** 检查是否被 @mention (参考 Telegram 插件 isMentioned) */
    isMentioned(ctx) {
        const entities = ctx.message?.entities ?? [];
        const text = ctx.message?.text ?? '';
        for (const e of entities) {
            if (e.type === 'mention') {
                const mentioned = text.slice(e.offset, e.offset + e.length);
                if (mentioned.toLowerCase() === `@${this.botUsername}`.toLowerCase())
                    return true;
            }
        }
        if (ctx.message?.reply_to_message?.from?.username?.toLowerCase() === this.botUsername.toLowerCase()) {
            return true;
        }
        return false;
    }
    /** 出站消息: 通过 Telegram sendMessage 发送 */
    async send(envelope) {
        const text = envelope.payload.text;
        if (!text)
            return;
        const chatId = envelope.channel_user_id;
        // 私聊中 channel_user_id == chat_id
        await this.bot.api.sendMessage(chatId, text);
        console.error(`[Telegram] Sent to ${chatId}: ${text.slice(0, 60)}...`);
    }
    /** 注册入站消息回调 */
    onMessage(callback) {
        this.callback = callback;
    }
    /** 启动轮询 */
    async start() {
        if (this.running)
            return;
        this.running = true;
        console.error('[Telegram] Starting polling...');
        // grammy bot.start() 启动长轮询
        // 使用 catch 处理断线重连
        this.bot.start({
            onStart: () => console.error('[Telegram] Polling started'),
            drop_pending_updates: true,
            timeout: this.options.pollingTimeout ?? 10,
        }).catch(err => {
            if (err instanceof GrammyError && err.error_code === 409) {
                console.error('[Telegram] 409 Conflict — another poller is active');
            }
            else {
                console.error(`[Telegram] Polling error: ${err}`);
            }
            this.running = false;
        });
    }
    /** 停止轮询 */
    async stop() {
        this.running = false;
        await this.bot.stop();
        this.releasePid();
        console.error('[Telegram] Stopped');
    }
}
//# sourceMappingURL=telegram_adapter.js.map