# Ooasis - VS Code Extension

Ooasis is a powerful AI chat assistant directly integrated into your Visual Studio Code editor. It provides a customized conversational interface in the secondary sidebar to help you reason about your code, chat with an LLM, and build software faster.

## Project Overview

This project is a VS Code extension that leverages a modern web stack for its UI. It brings an intelligent chat assistant into the VS Code sidebar, offering real-time streaming of AI responses, including step-by-step reasoning and markdown rendering for code snippets.

## Application Architecture

The application is divided into two main parts that communicate via message passing:

1. **Extension Host (Node.js)**: 
   Runs the core extension logic in `src/`. It manages the lifecycle of the extension, handles API requests to the LLM, reads workspace context, and manages the VS Code sidebar provider (`SidebarProvider.ts`).
2. **Webview UI (React + Vite)**: 
   Located in the `webview-ui/` directory, this is a modern React application built with Vite and styled using Tailwind CSS. It serves as the frontend for the chat interface, handling the display of chat messages, reasoning blocks, and capturing user inputs.

## Features

- **Integrated Chat Interface**: Access the AI assistant directly from the secondary sidebar (Ooasis).
- **Streaming Responses**: Real-time token streaming for fast and responsive AI replies.
- **Reasoning Display**: Dedicated UI components for displaying the AI's internal reasoning and thought processes.
- **Modern Web UI**: Beautiful and responsive UI powered by React and Tailwind CSS.
- **Context-Aware**: Capable of reading active files and interacting with the VS Code workspace context.

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

### 2. Environment Variables

Create a `.env` file in the root directory and add any necessary environment variables (e.g., API keys). You can copy the structure from `.env.example`.

### 3. Run for Development

1. **Start the Watchers**:
   In your terminal, run the following commands to watch for changes in both the extension TypeScript files and the Tailwind CSS:
   ```bash
   npm run watch
   npm run watch:tailwind
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
This will generate a `first-extension-x.x.x.vsix` file in your root directory, which can be installed manually in VS Code or published to the Marketplace.
