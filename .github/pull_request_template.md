## Summary

<!-- 
Provide a clear and concise summary of the changes introduced in this pull request.
If this resolves an open issue, link it here: e.g. Fixes #123, Closes #456.
-->

Fixes #

---

## Type of Change

<!-- Please check the options that apply: -->

- [ ] 🐛 **Bug fix** (non-breaking change fixing an issue)
- [ ] ✨ **New feature** (non-breaking change adding functionality)
- [ ] 💥 **Breaking change** (fix or feature that alters existing behaviors or APIs)
- [ ] ♻️ **Refactoring / Chore** (code refactoring, build configuration, dependency updates)
- [ ] 📝 **Documentation** (documentation or README updates)

---

## Area of Impact

<!-- Which components are affected by this PR? -->

- [ ] **Extension Host** (`src/`)
- [ ] **Tool Execution & Security** (`src/tools.ts`)
- [ ] **Webview UI** (`webview-ui/`)
- [ ] **Build & Packaging** (`esbuild`, `vite`, `.vscodeignore`, `package.json`)
- [ ] **Tests & CI** (`src/test/`, `.github/workflows/`)

---

## Verification & Testing

<!-- 
Describe how you tested these changes.
Provide steps to reproduce testing, automated test additions, or manual checks performed.
-->

### Automated Tests
<!-- e.g. `npm test`, `npm run lint` -->
- [ ] Ran unit/extension tests (`npm test`)
- [ ] Ran linter (`npm run lint` and `cd webview-ui && npm run lint`)

### Manual Verification Steps
1. 
2. 
3. 

---

## Checklist

- [ ] My code adheres to the project's coding and formatting standards.
- [ ] I have performed a self-review of my code.
- [ ] Any modifications to file-based tools in `src/tools.ts` strictly enforce workspace path containment.
- [ ] I have commented my code where necessary, particularly in tricky logic.
- [ ] I have updated relevant documentation where appropriate.
- [ ] No extraneous build artifacts, logs, or sensitive files are included.
