# Webview UI

React + TypeScript + Vite frontend for the extension's sidebar chat webview.

## Development

```bash
npm install
npm run dev     # start Vite dev server
npm run build   # production build consumed by the extension
npm run lint
```

The extension (see the repository root) loads the built output into a VS Code webview via `SidebarProvider`.
