"use client";

// NotificationOverlay — mounts the toast stack + the bell panel ONCE for the
// whole app (inside NotificationProvider, after the login gate). Keeping it a
// separate component means page.tsx only ever wraps children; the bell itself
// lives in the Sidebar/header and reads the same context.
import React from "react";
import { NotificationToasts } from "./NotificationToasts";
import { NotificationDrawer } from "./NotificationDrawer";

export function NotificationOverlay() {
  return (
    <>
      <NotificationToasts />
      <NotificationDrawer />
    </>
  );
}
