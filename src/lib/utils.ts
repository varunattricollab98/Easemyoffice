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
