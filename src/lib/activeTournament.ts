// Tiny pub/sub for the currently-selected tournament id on the main app route.
//
// The voice widget is mounted globally (main.tsx, outside <Routes>), so on the
// `*` App route it has no router param to read the active tournament from —
// App holds it in local state. App publishes its `currentId` here and the
// widget subscribes. On public /t/:slug routes the widget resolves from the URL
// instead and ignores this.

let current: string | null = null;
const subscribers = new Set<(id: string | null) => void>();

export function setActiveTournament(id: string | null): void {
  if (id === current) return;
  current = id;
  for (const fn of subscribers) fn(current);
}

export function getActiveTournament(): string | null {
  return current;
}

export function subscribeActiveTournament(fn: (id: string | null) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
