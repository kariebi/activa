import { createActivaHttpClient, subscribeToActivaStream } from './http-client';
import type { ActivaBrowserClientOptions, ActivaClientSnapshot, JsonRecord, SessionEventPayload } from './types';

function resolveValue<T>(value: T | (() => T) | undefined, fallback?: T) {
  if (typeof value === 'function') {
    return (value as () => T)();
  }
  return value ?? fallback;
}

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `activa_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function describeTarget(target: EventTarget | null) {
  if (!target || typeof target !== 'object' || !('tagName' in target)) {
    return null;
  }

  const element = target as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const className = typeof element.className === 'string'
    ? `.${element.className.split(/\s+/).filter(Boolean).join('.')}`
    : '';
  return `${tagName}${id}${className}`;
}

export { createActivaHttpClient, subscribeToActivaStream } from './http-client';

export function createActivaBrowserClient(options: ActivaBrowserClientOptions) {
  const client = createActivaHttpClient({
    endpoint: options.endpoint ?? '/activa',
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {})
  });

  const state: {
    started: boolean;
    userId: string | null;
    roomId: string | null;
    sessionId: string;
    heartbeatTimer: ReturnType<typeof setInterval> | null;
    disposers: Array<() => void>;
  } = {
    started: false,
    userId: null,
    roomId: null,
    sessionId: options.sessionId ?? createId(),
    heartbeatTimer: null,
    disposers: []
  };

  function context(overrides: Partial<SessionEventPayload> & { metadata?: JsonRecord | null } = {}) {
    const userId = resolveValue(options.userId);
    const roomId = resolveValue(
      overrides.roomId ?? state.roomId ?? options.roomId,
      typeof window !== 'undefined' ? window.location.pathname : 'default'
    );
    const path = overrides.path ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
    const href = overrides.href ?? (typeof window !== 'undefined' ? window.location.href : null);

    if (!userId) {
      throw new Error('Activa browser client requires a userId value.');
    }

    if (!roomId) {
      throw new Error('Activa browser client requires a roomId value.');
    }

    const nextRoomId = roomId as string;

    return {
      userId,
      roomId: nextRoomId,
      path,
      href,
      sessionId: state.sessionId,
      metadata: overrides.metadata ?? options.metadata ?? null
    };
  }

  function snapshot(): ActivaClientSnapshot {
    return {
      started: state.started,
      sessionId: state.sessionId,
      userId: state.userId,
      roomId: state.roomId
    };
  }

  function on(target: Document | Window, eventName: string, listener: EventListenerOrEventListenerObject) {
    target.addEventListener(eventName, listener);
    state.disposers.push(() => target.removeEventListener(eventName, listener));
  }

  function clearListeners() {
    for (const dispose of state.disposers.splice(0)) {
      dispose();
    }
  }

  function clearHeartbeat() {
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  }

  function installAutoTracking() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    if (options.autoTrackClicks !== false) {
      on(document, 'click', (event) => {
        const click = event as MouseEvent;
        void track({
          type: 'click',
          name: 'click',
          x: click.clientX,
          y: click.clientY,
          metadata: {
            source: 'auto-click',
            target: describeTarget(click.target)
          }
        }).catch(() => {});
      });
    }

    on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void heartbeat().catch(() => {});
      }
    });

    on(window, 'pagehide', () => {
      void stop({ keepalive: true }).catch(() => {});
    });
  }

  async function start(overrides: Partial<SessionEventPayload> & { metadata?: JsonRecord | null } = {}) {
    if (state.started) {
      return snapshot();
    }

    const details = context(overrides);
      state.started = true;
      state.userId = details.userId;
      state.roomId = details.roomId ?? null;

    try {
      await client.presence.join(details);
      await client.session.start(details);

      state.heartbeatTimer = setInterval(() => {
        void heartbeat().catch(() => {});
      }, options.heartbeatIntervalMs ?? 10_000);

      if (options.autoTrack !== false) {
        installAutoTracking();
      }

      return snapshot();
    } catch (error) {
      state.started = false;
      clearHeartbeat();
      clearListeners();
      throw error;
    }
  }

  async function heartbeat(overrides: Partial<SessionEventPayload> & { metadata?: JsonRecord | null } = {}) {
    const details = context(overrides);
    state.userId = details.userId;
    state.roomId = details.roomId ?? null;
    return client.presence.heartbeat(details);
  }

  async function track(event: Partial<SessionEventPayload> & { metadata?: JsonRecord | null } = {}) {
    const details = context(event);
    return client.session.event({
      ...details,
      type: event.type ?? event.event ?? 'event',
      name: event.name ?? event.event ?? event.type ?? 'event',
      x: typeof event.x === 'number' ? event.x : null,
      y: typeof event.y === 'number' ? event.y : null,
      metadata: event.metadata ?? details.metadata
    });
  }

  async function page(path?: string) {
    return track({
      type: 'pageview',
      name: 'pageview',
      path: path ?? (typeof window !== 'undefined' ? window.location.pathname : '/')
    });
  }

  async function stop(optionsValue: { keepalive?: boolean } = {}) {
    if (!state.started) {
      return snapshot();
    }

    state.started = false;
    clearHeartbeat();
    clearListeners();

    const details = context();
    await Promise.allSettled([
      client.presence.leave(
        details,
        optionsValue.keepalive !== undefined ? { keepalive: optionsValue.keepalive } : undefined
      ),
      client.session.end(
        {
          userId: details.userId,
          roomId: details.roomId,
          sessionId: details.sessionId
        },
        optionsValue.keepalive !== undefined ? { keepalive: optionsValue.keepalive } : undefined
      )
    ]);

    return snapshot();
  }

  function setRoom(roomId: string) {
    state.roomId = roomId;
    return snapshot();
  }

  return {
    start,
    stop,
    heartbeat,
    track,
    page,
    setRoom,
    snapshot,
    get sessionId() {
      return state.sessionId;
    }
  };
}
