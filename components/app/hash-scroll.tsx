"use client";

import { useEffect } from "react";

function scrollToHash() {
  const id = window.location.hash.replace(/^#/, "");
  if (!id) {
    return;
  }
  document.getElementById(id)?.scrollIntoView({ block: "start" });
}

export function HashScroll() {
  useEffect(() => {
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);

  return null;
}
