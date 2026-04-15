'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createActivaBrowserClient } from 'activa/browser';
import {
  useActiveUsers,
  useActiveUsersSeries,
  useActivaStream,
  useHeatmap,
  usePresence,
  usePresenceSnapshot,
  useRecentEvents
} from 'activa/react';
import { ACTIVA_DEMO_LABEL, ACTIVA_DEMO_ROOM, ACTIVA_ENDPOINT } from '@/lib/constants';

function createUserId() {
  return `demo_${Math.random().toString(36).slice(2, 8)}`;
}

function useDemoUserId() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const current = window.localStorage.getItem('activa-demo-user');
    if (current) {
      setUserId(current);
      return;
    }

    const next = createUserId();
    window.localStorage.setItem('activa-demo-user', next);
    setUserId(next);
  }, []);

  const regenerate = useCallback(() => {
    const next = createUserId();
    window.localStorage.setItem('activa-demo-user', next);
    setUserId(next);
  }, []);

  return { userId, regenerate };
}

function formatCount(value: number) {
  return value.toLocaleString('en-US');
}

function formatTime(value: number | null | undefined) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  }).format(value);
}

function Sparkline({ points }: { points: Array<{ timestamp: number; count: number }> }) {
  if (points.length === 0) {
    return <div className="empty-state">Waiting for activity…</div>;
  }

  const max = Math.max(...points.map((point) => point.count), 1);
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * 100;
      const y = 100 - point.count / max * 100;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 100 100" className="sparkline" preserveAspectRatio="none">
      <path d={path} className="sparkline-path" />
    </svg>
  );
}

function EventFeed({ items }: { items: Array<Record<string, unknown>> }) {
  if (items.length === 0) {
    return <div className="empty-state">No recorded events yet. Click around the heatmap lab to generate some.</div>;
  }

  return (
    <ul className="feed-list">
      {items.slice(0, 8).map((item, index) => (
        <li key={`${String(item.sessionId ?? 'event')}-${index}`} className="feed-item">
          <span className="feed-badge">{String(item.type ?? item.name ?? 'event')}</span>
          <div>
            <strong>{String(item.userId ?? 'unknown user')}</strong>
            <p>{String(item.path ?? '/')}</p>
          </div>
          <time>{formatTime(Number(item.occurredAt ?? 0))}</time>
        </li>
      ))}
    </ul>
  );
}

function LiveFeed({ envelopes }: { envelopes: Array<{ kind: string; roomId: string; timestamp?: number; event?: { type: string; userId: string; streamId: string } }> }) {
  if (envelopes.length === 0) {
    return <div className="empty-state">Open another tab to watch the live room stream come alive.</div>;
  }

  return (
    <ul className="live-list">
      {envelopes.slice(-8).reverse().map((envelope, index) => (
        <li key={`${envelope.kind}-${envelope.timestamp ?? index}-${index}`} className="live-item">
          <span className="live-kind">{envelope.kind}</span>
          <div>
            {envelope.kind === 'event' && envelope.event ? (
              <>
                <strong>{envelope.event.type}</strong>
                <p>{envelope.event.userId}</p>
              </>
            ) : (
              <>
                <strong>{envelope.kind}</strong>
                <p>{envelope.roomId}</p>
              </>
            )}
          </div>
          <time>{formatTime(envelope.timestamp)}</time>
        </li>
      ))}
    </ul>
  );
}

export function ActivaDemo() {
  const { userId, regenerate } = useDemoUserId();
  const trackerRef = useRef<ReturnType<typeof createActivaBrowserClient> | null>(null);
  const [boardPulse, setBoardPulse] = useState(0);

  const timeWindow = useMemo(() => {
    const to = Date.now();
    const from = to - 30 * 60 * 1000;
    return { from, to };
  }, []);

  const activeSeriesQuery = useMemo(
    () => ({
      roomId: ACTIVA_DEMO_ROOM,
      from: timeWindow.from,
      to: timeWindow.to,
      bucketMs: 5 * 60 * 1000
    }),
    [timeWindow]
  );

  const heatmapQuery = useMemo(
    () => ({
      roomId: ACTIVA_DEMO_ROOM,
      from: timeWindow.from,
      to: timeWindow.to,
      bucketMs: 5 * 60 * 1000,
      cellSize: 24
    }),
    [timeWindow]
  );

  const streamOptions = useMemo(
    () => ({
      endpoint: ACTIVA_ENDPOINT,
      roomId: ACTIVA_DEMO_ROOM,
      transport: 'sse' as const
    }),
    []
  );

  useEffect(() => {
    if (!userId) {
      return undefined;
    }

    const tracker = createActivaBrowserClient({
      endpoint: ACTIVA_ENDPOINT,
      userId,
      roomId: ACTIVA_DEMO_ROOM,
      metadata: {
        source: 'nextjs-demo'
      }
    });
    trackerRef.current = tracker;
    void tracker.start();
    void tracker.page('/');

    return () => {
      void tracker.stop({ keepalive: true });
      trackerRef.current = null;
    };
  }, [userId]);

  const presence = usePresence({
    endpoint: ACTIVA_ENDPOINT,
    roomId: ACTIVA_DEMO_ROOM,
    userId: userId ?? 'anonymous',
    enabled: Boolean(userId)
  });

  const activeUsers = useActiveUsers({
    endpoint: ACTIVA_ENDPOINT,
    roomId: ACTIVA_DEMO_ROOM
  });

  const snapshot = usePresenceSnapshot({
    endpoint: ACTIVA_ENDPOINT,
    roomId: ACTIVA_DEMO_ROOM
  });

  const activeSeries = useActiveUsersSeries({
    endpoint: ACTIVA_ENDPOINT,
    query: activeSeriesQuery
  });

  const heatmap = useHeatmap({
    endpoint: ACTIVA_ENDPOINT,
    query: heatmapQuery
  });

  const recentEvents = useRecentEvents({
    endpoint: ACTIVA_ENDPOINT,
    roomId: ACTIVA_DEMO_ROOM,
    limit: 20
  });

  const live = useActivaStream(streamOptions);

  const refreshEverything = useCallback(async () => {
    await Promise.allSettled([
      activeUsers.refresh(),
      snapshot.refresh(),
      activeSeries.refresh(),
      heatmap.refresh(),
      recentEvents.refresh(),
      presence.refresh()
    ]);
  }, [activeSeries, activeUsers, heatmap, presence, recentEvents, snapshot]);

  const handleBoardClick = useCallback(
    async (event: ReactMouseEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.round(event.clientX - rect.left);
      const y = Math.round(event.clientY - rect.top);
      setBoardPulse((value) => value + 1);
      await trackerRef.current?.track({
        type: 'heatmap_click',
        name: 'heatmap_click',
        x,
        y,
        metadata: {
          section: 'heatmap-lab'
        }
      });
      await Promise.allSettled([heatmap.refresh(), recentEvents.refresh()]);
    },
    [heatmap, recentEvents]
  );

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">{ACTIVA_DEMO_LABEL}</span>
          <h1>Real-time presence, analytics, and live room streaming — all running through the SDK.</h1>
          <p>
            This example app uses the published Activa interfaces the same way a real product would: Hono routes,
            Redis-compatible storage, browser tracking, React hooks, live SSE updates, and click-driven heatmaps.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => void refreshEverything()}>
              Refresh all panels
            </button>
            <button className="secondary-button" onClick={regenerate}>
              Regenerate demo user
            </button>
          </div>
        </div>
        <div className="hero-meta">
          <div className="meta-card">
            <span className="meta-label">Room</span>
            <strong>{ACTIVA_DEMO_ROOM}</strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Viewer ID</span>
            <strong>{userId ?? 'booting…'}</strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Transport</span>
            <strong>SSE in demo / WS supported in Node server</strong>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-card stat-card--presence">
          <span className="stat-label">Presence</span>
          <div className="presence-row">
            <span className={`presence-dot ${presence.online ? 'is-online' : ''}`} />
            <strong>{presence.online ? 'Online' : 'Offline'}</strong>
          </div>
          <p>Last seen: {formatTime(presence.lastSeenAt)}</p>
        </article>

        <article className="stat-card stat-card--count">
          <span className="stat-label">Active users</span>
          <strong className="stat-value">{formatCount(activeUsers.count)}</strong>
          <p>Open this page in another tab to watch the counter update live.</p>
        </article>

        <article className="stat-card stat-card--stream">
          <span className="stat-label">Live envelopes</span>
          <strong className="stat-value">{formatCount(live.envelopes.length)}</strong>
          <p>Latest stream event: {live.lastEvent?.type ?? 'waiting for events'}</p>
        </article>

        <article className="stat-card stat-card--events">
          <span className="stat-label">Recent event backlog</span>
          <strong className="stat-value">{formatCount(recentEvents.data.length)}</strong>
          <p>Tracked via Redis-backed analytics endpoints.</p>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel panel--tall">
          <header className="panel-header">
            <div>
              <span className="eyebrow">Presence roster</span>
              <h2>Who is online right now</h2>
            </div>
            <span className="panel-chip">{snapshot.data.count} live</span>
          </header>
          <div className="roster-list">
            {snapshot.data.users.length === 0 ? (
              <div className="empty-state">No one is in the room yet.</div>
            ) : (
              snapshot.data.users.map((entry) => (
                <div key={`${entry.userId}-${entry.joinedAt}`} className="roster-item">
                  <div>
                    <strong>{entry.userId}</strong>
                    <p>{entry.metadata ? JSON.stringify(entry.metadata) : 'No metadata'}</p>
                  </div>
                  <time>{formatTime(entry.lastSeenAt)}</time>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <header className="panel-header">
            <div>
              <span className="eyebrow">Active user series</span>
              <h2>Rolling 30-minute shape</h2>
            </div>
          </header>
          <Sparkline points={activeSeries.data.points} />
        </article>

        <article className="panel panel--stream-panel">
          <header className="panel-header">
            <div>
              <span className="eyebrow">Live stream</span>
              <h2>Incoming SSE envelopes</h2>
            </div>
          </header>
          <LiveFeed envelopes={live.envelopes as Array<{ kind: string; roomId: string; timestamp?: number; event?: { type: string; userId: string; streamId: string } }>} />
        </article>

        <article className="panel panel--events-panel">
          <header className="panel-header">
            <div>
              <span className="eyebrow">Recent analytics</span>
              <h2>Recorded event feed</h2>
            </div>
          </header>
          <EventFeed items={recentEvents.data} />
        </article>
      </section>

      <section className="heatmap-section">
        <div className="heatmap-copy">
          <span className="eyebrow">Heatmap lab</span>
          <h2>Click the board to generate session heatmap cells.</h2>
          <p>
            Each click writes a session event through Activa, increments Redis heatmap buckets, and refreshes the
            visual overlay below.
          </p>
        </div>

        <div className={`heatmap-board pulse-${boardPulse % 2}`} onClick={handleBoardClick}>
          <div className="board-grid" />
          {heatmap.cells.slice(0, 40).map((cell) => (
            <div
              key={`${cell.cellX}-${cell.cellY}`}
              className="heat-cell"
              style={{
                left: `${cell.x}px`,
                top: `${cell.y}px`,
                width: `${cell.width}px`,
                height: `${cell.height}px`,
                opacity: Math.min(0.12 + cell.count / 8, 0.92)
              }}
            />
          ))}
          <div className="board-overlay">
            <strong>Click anywhere</strong>
            <p>Activa will write a new `heatmap_click` event and update the overlay.</p>
          </div>
        </div>

        <div className="heatmap-summary">
          {heatmap.cells.slice(0, 6).map((cell) => (
            <div key={`summary-${cell.cellX}-${cell.cellY}`} className="heatmap-summary-card">
              <strong>
                Cell {cell.cellX}:{cell.cellY}
              </strong>
              <p>{cell.count} hits</p>
            </div>
          ))}
          {heatmap.cells.length === 0 && <div className="empty-state">Your clicks will paint this board in real time.</div>}
        </div>
      </section>
    </main>
  );
}
