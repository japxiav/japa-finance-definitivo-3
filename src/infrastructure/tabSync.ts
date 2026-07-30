
export type TabSyncMessage =
  | { type: 'STATE_UPDATED'; revision: number; deviceId: string }
  | { type: 'SYNC_STARTED'; revision: number; deviceId: string }
  | { type: 'SYNC_SUCCEEDED'; revision: number; deviceId: string }
  | { type: 'SYNC_CONFLICT'; revision: number; deviceId: string };

export interface TabSyncCoordinator {
  publish(message: TabSyncMessage): void;
  close(): void;
}

export function createTabSyncCoordinator(
  userId: string,
  onMessage: (message: TabSyncMessage) => void,
): TabSyncCoordinator {
  if (typeof BroadcastChannel === 'undefined') {
    return { publish: () => undefined, close: () => undefined };
  }
  const channel = new BroadcastChannel(`japa-finance:${userId}`);
  channel.onmessage = (event: MessageEvent<TabSyncMessage>) => onMessage(event.data);
  return {
    publish: (message) => channel.postMessage(message),
    close: () => channel.close(),
  };
}
