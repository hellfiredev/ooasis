# Security Policy: Ooasis

At Ooasis, the security of our users and their development environments is a top priority. Because Ooasis enables agentic workflows that interact with your local files and integrated terminal, maintaining strong security boundaries is essential.

This document describes supported versions, our vulnerability reporting process, and our overall security architecture and threat model.

---

## Supported Versions

We provide security updates and patches for the following versions of Ooasis:

| Version | Supported          |
| :------ | :----------------: |
| `0.0.x` | :white_check_mark: |
| `< 0.0.5` | :x:                |

We strongly encourage all users to run the latest released version of Ooasis to ensure you have the latest security patches and boundary safeguards.

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities via public GitHub issues, discussions, or pull requests.**

If you discover or suspect a security vulnerability in Ooasis:

### Preferred Method: GitHub Private Vulnerability Advisory
Submit a confidential report directly via GitHub:
👉 **[New Security Advisory](https://github.com/hellfiredev/ooasis/security/advisories/new)**

### Alternative Method: Direct Email
If you are unable to use GitHub Advisories, email the maintainer directly at:
📧 **[hellfiredev24@gmail.com](mailto:hellfiredev24@gmail.com)** with the subject line `[SECURITY] Ooasis Vulnerability Report`.

### What to Include in Your Report
To help us triage and reproduce the issue as quickly as possible, please include:
- A clear summary of the vulnerability and its potential impact.
- Step-by-step instructions or a minimal Proof of Concept (PoC) repository / prompt demonstration.
- The version of Ooasis, VS Code, and operating system used.
- The LLM backend and model used (e.g., LM Studio with `Qwen 2.5 Coder`, Ollama, etc.).
- Any logs, screenshots, or stack traces relevant to the reproduction.
- Any suggested remediation or proposed fix (if available).

### Response Timeline
- **Acknowledgement**: We aim to acknowledge receipt of your report within **48 hours**.
- **Assessment**: We will evaluate the report, verify the impact, and discuss a patch timeline within **5 business days**.
- **Patch & Disclosure**: Once a fix is verified, a patched release will be published along with a security advisory crediting the reporter (unless anonymity is requested). We ask that you adhere to coordinated vulnerability disclosure principles and refrain from public disclosure until a patch is released.

---

## Security Architecture & Threat Model

Ooasis operates locally inside the user's VS Code instance, bridging local LLMs with developer tooling. Understanding our threat model helps contributors and users keep their environments secure:

### 1. Workspace Path Containment
- **Boundary**: Tool operations (`read_file`, `write_file`, `replace_in_file`, `list_directory`, etc.) are confined strictly within the current workspace root (`vscode.workspace.workspaceFolders`).
- **Enforcement**: Any path parameter containing absolute paths (`/etc/`, `C:\Windows\`) or traversal elements (`../`) that resolve outside the workspace root is rejected with `Access denied`.
- **Policy**: Any pull request modifying path resolution in `src/tools.ts` must maintain path containment and include automated test coverage.

### 2. Terminal & Tool Execution Safeguards
- **Terminal Execution**: When executing terminal commands (`run_terminal`), commands require explicit interactive user confirmation before execution, and run within the workspace directory with output capture.
- **Human Oversight**: Users should review agentic terminal actions, especially in unfamiliar or newly cloned repositories.

### 3. Workspace Trust
- **Policy**: Ooasis explicitly declares:
  ```json
  "capabilities": {
    "untrustedWorkspaces": {
      "supported": false
    }
  }
  ```
- **Constraint**: Ooasis will **not activate** and disables tool execution in untrusted workspaces. Users should never grant workspace trust to repositories from untrusted or unverified sources.

### 4. Indirect Prompt Injection
- **Vector**: Codebases containing untrusted third-party files, malicious comments, hidden markdown directives, or cloned PRs may attempt to steer the LLM into performing unintended tool actions.
- **Defense**: Ooasis relies on structural system instructions, strict workspace sandboxing, and user approval for critical terminal operations. Workspace boundary containment ensures that even if prompt injection occurs, access outside the workspace is denied.

### 5. Network & Local API Communication
- **Local-First Design**: Ooasis does not send telemetry, analytics, or code snippets to third-party tracking services.
- **Configurable Endpoint**: LLM inference requests are dispatched solely to the configured host (`ooasis.apiHost`, defaulting to `http://127.0.0.1:1234`).
- **Network Boundaries**: Users connecting Ooasis to remote endpoints should ensure transport encryption (HTTPS) and appropriate authentication tokens.

---

## Security Best Practices for Users

1. **Only Trust Trusted Code**: Never enable Workspace Trust on repositories from unverified authors.
2. **Keep Software Updated**: Ensure VS Code, local inference backends (LM Studio, Ollama), and the Ooasis extension are updated to their latest stable releases.
3. **Audit Terminal Suggestions**: Verify shell commands before allowing long-running or system-modifying scripts to execute.
4. **Isolate Backend Ports**: Do not expose your local LLM HTTP port to external networks without firewall rules or token authentication.
