export function buildKeys(namespace: string, roomId?: string | null, userId?: string | null, sessionId?: string | null, bucket?: number) {
  return {
    presence: userId && roomId ? `activaq:${namespace}:presence:${roomId}:${userId}` : null,
    presenceRoom: roomId ? `activaq:${namespace}:presence-room:${roomId}` : null,
    session: sessionId ? `activaq:${namespace}:session:${sessionId}` : null,
    sessionRoom: roomId ? `activaq:${namespace}:sessions:${roomId}` : null,
    heatmap: roomId !== undefined && bucket !== undefined ? `activaq:${namespace}:heatmap:${roomId}:${bucket}` : null,
    activeBucket: roomId !== undefined && bucket !== undefined ? `activaq:${namespace}:active:${roomId}:${bucket}` : null,
    events: roomId ? `activaq:${namespace}:events:${roomId}` : null,
    liveStream: roomId ? `activaq:${namespace}:live:${roomId}` : null
  };
}
