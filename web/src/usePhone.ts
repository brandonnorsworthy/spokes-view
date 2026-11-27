import { useEffect, useState } from "react";

/** The phone layout's breakpoint, the same as the CSS's. */
export const PHONE = "(max-width: 760px)";

/** Whether the screen is phone-sized, following changes (rotation, resizing). */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches);
  useEffect(() => {
    const q = window.matchMedia(PHONE);
    const on = () => setPhone(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return phone;
}
