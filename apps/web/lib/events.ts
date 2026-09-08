/**
 * 轻量级数据变更事件总线。
 * Repository 写操作后发出事件，UI hooks 与搜索管理器订阅并响应。
 * 该设计让未来切换到 API/远端数据源时，仅需在 Repository 层发出相同事件。
 */

export type ChangeType = "create" | "update" | "delete";

export interface ChangeEvent {
  type: ChangeType;
  ids: string[];
}

export type Channel = "notes" | "notebooks" | "tags";

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
}
