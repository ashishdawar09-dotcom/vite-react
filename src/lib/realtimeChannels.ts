import type { RealtimeChannel, RealtimeChannelOptions } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// supabase.channel(name) hands back any channel of that name the client still
// holds, even one that is leaving, and subscribe() on a leaving channel does
// nothing: it never joins. A component that unmounts and mounts again quickly
// (React StrictMode in dev, an admin switching tabs and back) would be left
// with a dead channel. openChannel waits for an old channel of the same name
// to finish leaving first; closeChannel records that leave.

// The client gives up on a leave after 10 s.
const LEAVE_WAIT_MS = 12_000;
const leaves = new Map<string, Promise<unknown>>();

function capped(p: Promise<unknown>): Promise<unknown> {
  return Promise.race([p.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, LEAVE_WAIT_MS))]);
}

/** A channel that can join, or null when `signal` was aborted while waiting. */
export async function openChannel(
  name: string,
  opts: RealtimeChannelOptions,
  signal: AbortSignal,
): Promise<RealtimeChannel | null> {
  await leaves.get(name);
  if (signal.aborted) return null;
  const old = supabase.getChannels().find((c) => c.topic === `realtime:${name}`);
  if (old && (old.state === "leaving" || old.state === "closed")) await capped(supabase.removeChannel(old));
  if (signal.aborted) return null;
  return supabase.channel(name, opts);
}

export function closeChannel(name: string, channel: RealtimeChannel): void {
  const left = capped(supabase.removeChannel(channel));
  leaves.set(name, left);
  void left.then(() => {
    if (leaves.get(name) === left) leaves.delete(name);
  });
}
