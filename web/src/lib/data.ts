/* Shared data hooks with offline fallbacks. */
import { fixtureScripts, getScripts } from '../api';
import type { ScriptInfo } from '../types';
import { useAppState } from './appState';
import { useAsync } from './useAsync';

let scriptsCache: ScriptInfo[] | null = null;

/** Scripts S1–S6 from the API, falling back to the bundled copy when offline. */
export function useScripts(): { scripts: ScriptInfo[]; loading: boolean; fromFixture: boolean } {
  const { status, online } = useAppState();
  const { data, loading } = useAsync(async () => {
    if (status === 'checking') return null;
    if (!online) return { scripts: fixtureScripts, fromFixture: true };
    if (scriptsCache) return { scripts: scriptsCache, fromFixture: false };
    try {
      const s = await getScripts();
      scriptsCache = s;
      return { scripts: s, fromFixture: false };
    } catch {
      return { scripts: fixtureScripts, fromFixture: true };
    }
  }, [status, online]);
  return {
    scripts: data?.scripts ?? scriptsCache ?? fixtureScripts,
    loading: loading || status === 'checking',
    fromFixture: data?.fromFixture ?? true,
  };
}
