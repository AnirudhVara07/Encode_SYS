import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Remove **bold** and __bold__ markdown fragments for plain chat display. */
export function stripMarkdownBoldForChat(text: string): string {
  if (!text) return text;
  return text
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/__([\s\S]*?)__/g, "$1");
}
