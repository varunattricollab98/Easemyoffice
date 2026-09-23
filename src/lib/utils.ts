import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as Indian Rupees with no decimals, e.g. 35400 -> "₹35,400".
 * Single source of truth for the "₹" + en-IN grouping formatting that was
 * duplicated across many components. Null/undefined/NaN render as "₹0".
 */
export function formatINR(n: number | null | undefined): string {
  const value = Number.isFinite(n as number) ? (n as number) : 0;
  return `\u20B9${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * Safely extract a human-readable message from an unknown thrown value.
 * Lets callers type catch/onError params as `unknown` instead of `any`
 * (a caught value is not guaranteed to be an Error). Falls back to a
 * generic message when nothing usable is present.
 */
export function getErrorMessage(
  e: unknown,
  fallback = "Something went wrong",
): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}
