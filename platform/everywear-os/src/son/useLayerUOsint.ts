import { useCallback, useEffect, useMemo, useState } from 'react';
import { getLayerUData, getLayerUHealth, triggerLayerUSweep } from './sonBridge';
import type { LayerUFeedItem, LayerUPosture, LayerUSnapshot, LayerUSourceRollup } from './types';

const EMPTY_POSTURE: LayerUPosture = {
  direction: 'standby',
  totalChanges: null,
  criticalChanges: 0,
  vix: '--',
  brent: '--',
  wti: '--',
};

const EMPTY_ROLLUP: LayerUSourceRollup = { ok: 0, failed: 0, total: 0 };

function asDisplay(value: unknown, prefix = '') {
  if (value === null || value === undefined || value === '') return '--';
  if (typeof value === 'number') return `${prefix}${value.toFixed(value >= 100 ? 0 : 2)}`;
  return `${prefix}${value}`;
}

function derivePosture(data: Record<string, any> | null): LayerUPosture {
  if (!data) return EMPTY_POSTURE;
  const summary = data.delta?.summary ?? {};
  const vix = Array.isArray(data.fred) ? data.fred.find((item: any) => item?.id === 'VIXCLS') : null;

  return {
    direction: summary.direction ?? 'mixed',
    totalChanges: typeof summary.totalChanges === 'number' ? summary.totalChanges : null,
    criticalChanges: typeof summary.criticalChanges === 'number' ? summary.criticalChanges : 0,
    vix: asDisplay(vix?.value),
    brent: asDisplay(data.energy?.brent, '$'),
    wti: asDisplay(data.energy?.wti, '$'),
  };
}

function deriveFeeds(data: Record<string, any> | null): LayerUFeedItem[] {
  if (!data) return [];
  const newsItems = Array.isArray(data.newsFeed)
    ? data.newsFeed
    : Array.isArray(data.news?.items)
      ? data.news.items
      : [];
  const youtubeItems = Array.isArray(data.youtube?.videos) ? data.youtube.videos : [];

  return [...newsItems, ...youtubeItems].slice(0, 6).map((item: any) => ({
    title: item.title ?? item.text ?? 'Untitled signal',
    source: item.source ?? item.channelTitle ?? item.type ?? 'feed',
    url: item.url ?? item.link,
    publishedAt: item.publishedAt ?? item.date,
  }));
}

function deriveRollup(health: LayerUSnapshot['health'], data: Record<string, any> | null): LayerUSourceRollup {
  const ok = health?.sourcesOk ?? data?.meta?.sourcesOk ?? 0;
  const failed = health?.sourcesFailed ?? data?.meta?.sourcesFailed ?? 0;
  const total = data?.meta?.sourcesQueried ?? ok + failed;
  return { ok, failed, total };
}

export function useLayerUOsint() {
  const [snapshot, setSnapshot] = useState<LayerUSnapshot>({
    online: false,
    health: null,
    data: null,
    posture: EMPTY_POSTURE,
    feeds: [],
    sourceRollup: EMPTY_ROLLUP,
    updatedAt: null,
    error: null,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const health = await getLayerUHealth();
      let data: Record<string, any> | null = null;

      try {
        data = await getLayerUData();
      } catch {
        data = null;
      }

      setSnapshot({
        online: true,
        health,
        data,
        posture: derivePosture(data),
        feeds: deriveFeeds(data),
        sourceRollup: deriveRollup(health, data),
        updatedAt: new Date().toISOString(),
        error: null,
      });
    } catch (err) {
      setSnapshot((prev) => ({
        ...prev,
        online: false,
        error: err instanceof Error ? err.message : 'Layer U OSINT is offline',
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const pullLive = useCallback(async () => {
    await triggerLayerUSweep();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return useMemo(() => ({ snapshot, isRefreshing, refresh, pullLive }), [snapshot, isRefreshing, refresh, pullLive]);
}
