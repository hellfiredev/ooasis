# Ooasis - VS Code Extension

[![CI](https://github.com/hellfiredev/ooasis/actions/workflows/ci.yml/badge.svg)](https://github.com/hellfiredev/ooasis/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.0.4-informational.svg)](package.json)

Ooasis is a powerful AI chat assistant directly integrated into your Visual Studio Code editor. It provides a customized conversational interface in the secondary sidebar to help you reason about your code, chat with an LLM, and build software faster.

## Project Overview

This project is a VS Code extension that leverages a modern web stack for its UI. It brings an intelligent chat assistant into the VS Code sidebar, offering real-time streaming of AI responses, including step-by-step reasoning and markdown rendering for code snippets.

## Application Architecture

The application is divided into two main parts that communicate via message passing:

1. **Extension Host (Node.js)**: 
   Runs the core extension logic in `src/`. It manages the lifecycle of the extension, handles API requests to the LLM, reads workspace context, and manages the VS Code sidebar provider (`src/providers/SidebarProvider.ts`).
2. **Webview UI (React + Vite)**: 
   Located in the `webview-ui/` directory, this is a modern React application built with Vite and styled using standard CSS. It serves as the frontend for the chat interface, handling the display of chat messages, reasoning blocks, and capturing user inputs.

## Features

- **Integrated Chat Interface**: Access the AI assistant directly from the secondary sidebar (Ooasis).
- **Streaming Responses**: Real-time token streaming for fast and responsive AI replies.
- **Reasoning Display**: Dedicated UI components for displaying the AI's internal reasoning and thought processes.
- **Agentic Workspace Tools**: Secure agent tools for exploring and modifying code (`read_file`, `write_file`, `replace_in_file`, `list_directory`, `search_workspace`).
- **Terminal Execution Sandbox**: Integrated terminal execution (`run_in_terminal`) with interactive user confirmation and sandbox safeguards that block commands attempting to escape or modify paths outside the workspace.
- **Session Management**: Persistent chat history per workspace, automatic conversation summarization, token usage tracking, and markdown export.
- **Modern Web UI**: Beautiful and responsive UI powered by React 19, KaTeX math formatting, and standard CSS.
- **Privacy & Local-First**: Works completely locally with OpenAI-compatible endpoints (LM Studio, Ollama, etc.) without telemetry or cloud tracking. Requires VS Code Workspace Trust.

## Extension Settings

Ooasis contributes the following configurable settings (`settings.json`):

| Setting | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `ooasis.apiHost` | `string` | `"http://127.0.0.1:1234"` | API host for the OpenAI-compatible LLM endpoint (LM Studio, Ollama, etc.). Scoped to machine-level to prevent untrusted workspace tampering. |
| `ooasis.maxAgentIterations` | `integer` | `10` | Maximum number of agentic tool iterations per request. |
| `ooasis.maxContinuations` | `integer` | `3` | Maximum number of continuation requests when responses are truncated. |
| `ooasis.history.maxSessions` | `integer` | `100` | Maximum number of saved chat sessions per workspace (`0` = unlimited). |
| `ooasis.terminalSandbox.enabled` | `boolean` | `true` | Enable sandbox for `run_terminal` tool to prevent modifying files outside the workspace. |
| `ooasis.terminalSandbox.allowTempDirectory` | `boolean` | `false` | Allow terminal commands to modify files in the system temporary directory. |

## Development Setup

To work on this extension locally, you need to install dependencies for both the extension and the webview UI.

### 1. Install Dependencies

Run the following from the root directory:
```bash
# Install extension dependencies
npm install

# Install webview UI dependencies
cd webview-ui
npm install
```

### 2. Run for Development

1. **Start the Watchers**:
   In your terminal, run the following command to watch for changes in the extension TypeScript files:
   ```bash
   npm run watch
   ```
   
2. **Launch the Extension in VS Code**:
   - Open this project in VS Code.
   - Press `F5` (or go to the Run and Debug view and click "Run Extension").
   - This will open a new "Extension Development Host" window with your extension loaded. You can find the extension in the secondary sidebar.

*Note: For faster UI iteration without VS Code, you can also navigate to `webview-ui/` and run `npm run dev` to develop the React app in your browser.*

## Building for Production

When you are ready to package the extension for release, follow these steps to build and package it into a `.vsix` file.

### 1. Compile the Project

This command will build the Vite React app for production (placing the optimized bundle in `webview-ui/dist/`) and compile the extension's TypeScript code.
```bash
npm run compile
```

### 2. Package the Extension

Use `vsce` to package the extension. Make sure your `.vscodeignore` correctly ignores `webview-ui/src`, `webview-ui/node_modules`, and `webview-ui/public` so they aren't bundled.
```bash
npx @vscode/vsce package
```
This will generate a `ooasis-x.x.x.vsix` file in your root directory, which can be installed manually in VS Code or published to the Marketplace.

## Testing & Quality

Run the test suite and linters to verify changes:

```bash
# Run ESLint on the extension host
npm run lint

# Run Oxlint on the webview UI
npm --prefix webview-ui run lint

# Run unit and integration tests
npm test
```

## Security & Privacy

Ooasis is built with security as a core architectural priority:
- **Strict Path Containment**: Tool file operations (`read_file`, `write_file`, `replace_in_file`, `list_directory`, `search_workspace`) and webview `openFile` messages are strictly confined within the workspace root.
- **Terminal Sandbox**: Integrated shell execution validates commands to prevent directory traversal, destructive modifications, and path escapes outside the workspace.
- **Workspace Trust**: Untrusted workspaces are explicitly blocked (`untrustedWorkspaces: { supported: false }`).
- **Webview CSP**: Hardened Content Security Policy with nonces, `base-uri 'none'`, and `form-action 'none'`.
- **Zero Telemetry**: No tracking, analytics, or external cloud requests.

For detailed security guidelines or to report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contributing

We welcome community contributions! Please read our [CONTRIBUTING.md](CONTRIBUTING.md) guide and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before submitting issues or pull requests.

## Support

Need help or want to share feedback? Check out [SUPPORT.md](SUPPORT.md) or open a discussion on GitHub.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

