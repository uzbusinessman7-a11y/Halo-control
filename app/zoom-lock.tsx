"use client";

import { useEffect } from "react";

export default function ZoomLock() {
  useEffect(() => {
    const stopGesture = (event: Event) => event.preventDefault();
    const stopPinch = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };
    const stopKeyboardZoom = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ["+", "-", "=", "0"].includes(event.key)) {
        event.preventDefault();
      }
    };
    const stopWheelZoom = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };

    document.addEventListener("gesturestart", stopGesture, { passive: false });
    document.addEventListener("gesturechange", stopGesture, { passive: false });
    document.addEventListener("gestureend", stopGesture, { passive: false });
    document.addEventListener("touchmove", stopPinch, { passive: false });
    document.addEventListener("keydown", stopKeyboardZoom);
    document.addEventListener("wheel", stopWheelZoom, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", stopGesture);
      document.removeEventListener("gesturechange", stopGesture);
      document.removeEventListener("gestureend", stopGesture);
      document.removeEventListener("touchmove", stopPinch);
      document.removeEventListener("keydown", stopKeyboardZoom);
      document.removeEventListener("wheel", stopWheelZoom);
    };
  }, []);

  return null;
}
