export function buildKeys(namespace: string, roomId?: string | null, userId?: string | null, sessionId?: string | null, bucket?: number) {
  return {
    presence: userId && roomId ? `activa:${namespace}:presence:${roomId}:${userId}` : null,
    presenceRoom: roomId ? `activa:${namespace}:presence-room:${roomId}` : null,
    session: sessionId ? `activa:${namespace}:session:${sessionId}` : null,
    sessionRoom: roomId ? `activa:${namespace}:sessions:${roomId}` : null,
    heatmap: roomId !== undefined && bucket !== undefined ? `activa:${namespace}:heatmap:${roomId}:${bucket}` : null,
    activeBucket: roomId !== undefined && bucket !== undefined ? `activa:${namespace}:active:${roomId}:${bucket}` : null,
    events: roomId ? `activa:${namespace}:events:${roomId}` : null,
    liveStream: roomId ? `activa:${namespace}:live:${roomId}` : null
  };
}
