# Getting Support for Ooasis

Thank you for using Ooasis! If you run into issues, have questions, or want to explore advanced configurations, here are the best channels to find help.

---

## 1. Documentation & Guides

Before reaching out, check out these resources:
- **[README.md](README.md)**: Overview, architecture, features, and local development setup.
- **[CONTRIBUTING.md](CONTRIBUTING.md)**: How to develop, build, test, and contribute to the extension.
- **[SECURITY.md](SECURITY.md)**: Supported versions, security architecture, and confidential vulnerability disclosure.

---

## 2. Common Configuration Questions

### Connecting to Local LLMs (LM Studio / Ollama)
Ooasis connects to local OpenAI-compatible API servers:
- **LM Studio**: Start the local server in LM Studio (default port `1234`).
- **Ollama**: Run `ollama serve` (default port `11434`), and point `ooasis.apiHost` to `http://127.0.0.1:11434/v1`.
- **Custom Endpoint**: In VS Code Settings (`Cmd+,` or `Ctrl+,`), search for `ooasis.apiHost` to configure your endpoint URL.

### Workspace Trust Required
Ooasis requires VS Code **Workspace Trust** to read context, inspect files, and execute terminal tools. If the extension does not appear or tools do not respond, verify that the active workspace folder is marked as **Trusted** in VS Code.

---

## 3. Where to Ask for Help

### GitHub Issues (Bugs & Feature Requests)
- If you encountered a reproducible bug or failure, please open a [Bug Report](https://github.com/hellfiredev/ooasis/issues/new?template=bug_report.md).
- If you have an idea for new capabilities or UI enhancements, submit a [Feature Request](https://github.com/hellfiredev/ooasis/issues/new?template=feature_request.md).

### GitHub Discussions (Questions, Setup Help & Ideas)
- For general questions, questions about prompt engineering with local models, or troubleshooting your local LLM setup, use **[GitHub Discussions](https://github.com/hellfiredev/ooasis/discussions)**.

---

## 4. Security Vulnerabilities

Please **do not** report security issues or tool containment vulnerabilities in public issues or discussions. Instead, follow the responsible disclosure guidelines in our **[Security Policy](SECURITY.md)** or report privately via [GitHub Security Advisories](https://github.com/hellfiredev/ooasis/security/advisories/new).
