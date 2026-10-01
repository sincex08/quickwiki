/**
 * 轻量级数据变更事件总线。
 * Repository 写操作后发出事件，UI hooks 与搜索管理器订阅并响应。
 * 该设计让未来切换到 API/远端数据源时，仅需在 Repository 层发出相同事件。
 */

export type ChangeType = "create" | "update" | "delete";

export interface ChangeEvent {
  type: ChangeType;
  ids: string[];
  /**
   * 同步引擎应用远端行时置位（batchEmit 发出）。订阅者据此跳过 outbox 入队，
   * 避免「pull 应用的行被当成新本地编辑再推回去」的回声循环。
   * 不能用「pull 进行中」的全局时间窗代替——那样会把**用户恰在 pull 期间
   * 发起的本地写入**也一并丢弃（其入队丢失后该实体永远不同步，
   * 真实环境踩过：新建笔记本后笔记 FK 卡死 + 假收敛，2026-10-01）。
   */
  remote?: boolean;
}

export type Channel = "notes" | "notebooks" | "tags" | "attachments";

type Handler = (event: ChangeEvent) => void;

const listeners = new Map<Channel, Set<Handler>>();

export function subscribe(channel: Channel, handler: Handler): () => void {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
  };
}

export function emitChange(channel: Channel, event: ChangeEvent): void {
  listeners.get(channel)?.forEach((handler) => {
    try {
      handler(event);
    } catch (err) {
      console.error(`change handler error on [${channel}]`, err);
    }
  });
  // 跨标签页广播：本页写入后其它标签页的 UI 立即刷新。
  // 注意这**只解决显示陈旧**——Dexie 跨页无应用层锁，「最后写入者胜」的
  // 数据竞态仍需依赖 Realtime 回环收敛，不能靠广播消除。
  broadcast(channel, event);
}

// ---------- 跨标签页广播 ----------

/**
 * 用 BroadcastChannel 同步变更通知。特性检测失败（Safari 旧版 / 非浏览器）
 * 时静默降级为单页行为。
 *
 * **必须过滤自投递**：部分运行环境（含测试用的 Node 实现）不像浏览器那样
 * 保证「不向发送者自身投递」，会把页面自己发出的消息回投回来——本页收到
 * 自己的变更事件后会重复执行订阅回调（对同步引擎即「重新入队刚推完的操作」，
 * 导致 outbox 永远清不空）。用实例 id 做来源标记，只接收他人的消息。
 */
const BC_NAME = "quickwiki-events";
const BC_INSTANCE_ID = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 10)}`;
let bc: BroadcastChannel | null = null;

function broadcast(channel: Channel, event: ChangeEvent): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    if (!bc) bc = new BroadcastChannel(BC_NAME);
    bc.postMessage({ source: BC_INSTANCE_ID, channel, event });
  } catch {
    // 隐私模式等构造失败：跳过跨页同步
  }
}

if (typeof BroadcastChannel !== "undefined") {
  try {
    const inbound = new BroadcastChannel(BC_NAME);
    inbound.onmessage = (msg: MessageEvent) => {
      const data = msg.data as
        | { source?: string; channel?: Channel; event?: ChangeEvent }
        | null;
      if (!data?.channel || !data.event) return;
      // 丢弃自己发出的（被回投）消息，避免本页重复处理自己的变更
      if (data.source === BC_INSTANCE_ID) return;
      listeners.get(data.channel)?.forEach((handler) => {
        try {
          handler(data.event!);
        } catch (err) {
          console.error(`remote change handler error on [${data.channel}]`, err);
        }
      });
    };
  } catch {
    // 构造失败：跨页通知不可用，不影响本页
  }
}
