// Demo / testing helpers:
//  - reseed & clear demo data (admin RPC calls)
//  - realtime simulator: periodically updates a random lead to demonstrate live UI

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { STAGES, INTERESTS } from "@/lib/crm";

const STORAGE_KEY = "emo-crm:realtime-sim";

const listeners = new Set<() => void>();
let enabled = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

function emit() {
  listeners.forEach((l) => l());
}

export function isSimEnabled() {
  return enabled;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function tick() {
  // Pick a random lead and mutate something visible.
  const { data } = await supabase
    .from("leads")
    .select("id, stage, interest")
    .limit(200);
  if (!data || data.length === 0) return;
  const lead = data[Math.floor(Math.random() * data.length)];
  const change = Math.floor(Math.random() * 3);

  if (change === 0) {
    // Move to a different random stage
    const next = pick(STAGES.filter((s) => s.id !== lead.stage)).id;
    await supabase.from("leads").update({ stage: next as never }).eq("id", lead.id);
  } else if (change === 1) {
    const next = pick(INTERESTS.filter((i) => i.id !== lead.interest)).id;
    await supabase.from("leads").update({ interest: next as never }).eq("id", lead.id);
  } else {
    const due = new Date(Date.now() + (Math.random() * 48 - 12) * 3600_000).toISOString();
    await supabase.from("leads").update({ next_follow_up_at: due }).eq("id", lead.id);
  }
}

export function setSimEnabled(value: boolean) {
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (value) {
    // Fire one immediately, then every 5s
    void tick();
    intervalId = setInterval(() => void tick(), 5000);
  }
  emit();
}

export function bootstrapSim() {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(STORAGE_KEY) === "1") setSimEnabled(true);
  } catch {
    /* ignore */
  }
}

export function useSimEnabled() {
  const [v, setV] = useState(enabled);
  useEffect(() => {
    const fn = () => setV(enabled);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return v;
}

export async function reseedDemoData(): Promise<number> {
  // Clear first so we don't pile up
  const { error: e1 } = await supabase.rpc("clear_demo_data");
  if (e1) throw e1;
  const { data, error } = await supabase.rpc("seed_demo_leads");
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function clearDemoData(): Promise<void> {
  const { error } = await supabase.rpc("clear_demo_data");
  if (error) throw error;
}
