# Web Preview Archive

This directory preserves the only browser-specific component from `v0.1.2`: the Vite middleware that read Patina through local `/api/patina/*` endpoints.

The Windows application no longer uses this middleware. It reads Patina through Tauri/Rust and uses the native Windows file picker, so the desktop build has the same supported product features without a browser server.

`src/`, `index.html`, `public/`, and the active `vite.config.ts` remain in the project because Tauri packages that React interface into the Windows application. They are not a separately supported web client.

To restore the old browser preview later, use the `v0.1.2` Git tag as the complete snapshot and start from `vite.patina-web-preview.config.ts` in this directory.
