# Change Log

All notable changes to the "Ooasis" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added
- Terminal execution sandbox (`TerminalSandbox`) enforcing workspace path containment for `run_terminal`, blocking commands that escape the workspace or target sensitive system directories.
- Configuration options `ooasis.terminalSandbox.enabled` and `ooasis.terminalSandbox.allowTempDirectory`.
- Tool execution status indicators: pass `isError` in `toolResult` and render a red `failed` badge in the chat UI when tool execution errors occur.
- Comprehensive unit and integration test suites covering terminal sandbox validation, path containment, and machine-scoped settings.

### Security
- Scoped `ooasis.apiHost` configuration setting to `machine` to prevent untrusted workspaces from hijacking the API endpoint.
- Enforced strict workspace path containment checks on `openFile` webview messages.
- Hardened webview Content Security Policy (CSP) by removing `blob:` from `script-src` and adding `base-uri 'none'` and `form-action 'none'`.
- Escaped error text in webview to prevent HTML injection via `errorHtml`.
- Restricted inline styles and enabled native MathML profile in DOMPurify to mitigate UI redressing and mutation XSS (mXSS).

### Fixed
- Resolved `Webview Logging Test Suite` failure in VS Code extension host by preserving and mocking `console` property descriptors via `Object.defineProperty`.

## [0.0.4] - 2026-10-13

### Added
- Integrated secondary sidebar chat assistant interface powered by React 19 and Vite.
- Real-time token streaming with dedicated collapsible reasoning block display.
- Markdown and KaTeX math formula rendering in chat responses.
- Agentic workspace tools with strict path containment (`read_file`, `write_file`, `replace_in_file`, `list_directory`, `search_workspace`).
- Terminal execution with user confirmation safeguard (`run_in_terminal`).
- Session history persistence, context summarization, and token usage tracking.
- Configurable OpenAI-compatible local LLM endpoint (`ooasis.apiHost`).
- Multi-platform CI workflow, security policy, and open-source contribution guidelines.