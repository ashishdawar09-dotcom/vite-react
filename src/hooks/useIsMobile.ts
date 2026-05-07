import { useEffect, useState } from "react";

export function useIsMobile(maxWidth = 640): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" &&
          window.matchMedia(`(max-width: ${maxWidth}px)`).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [maxWidth]);
  return isMobile;
}
