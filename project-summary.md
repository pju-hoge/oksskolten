# Project Summary: HTTP Support, Protocol-Agnostic Lookups, and Keyboard Navigation Stability

## Task Overview
Add support for legacy HTTP feeds and articles while maintaining the security intentions of the project (Issue #63, PR #15). This involved refining how the frontend handles protocols, updating security headers, and fixing stability issues in the keyboard navigation feature.

## Changes Completed

### 1. HTTP Support & Protocol-Agnostic Lookup (PR #62)
- **Validator Relaxation**: Updated `articles.ts` and `feeds.ts` to allow both `http://` and `https://` URLs.
- **Frontend Path Encoding**: Refactored `articleUrlToPath` to encode `http://` URLs into the application path using an `/http/` prefix. `https://` URLs remain unchanged for backward compatibility.
- **Native Protocol Decoding**: Updated `ArticleDetailPage` to detect the prefix and reconstruct the original native protocol before API calls, enabling strict database lookups.
- **Security & Compatibility**:
  - Updated CSP `img-src` to allow `http:` to prevent broken images from legacy feeds.
  - Corrected `Referrer-Policy` to `strict-origin-when-cross-origin` to fix connectivity issues with local LLM providers (vLLM/Ollama).
  - Unified external service healthcheck timeouts to 15 seconds (Ollama, vLLM, RSS Bridge, Image Storage).

### 2. Keyboard Navigation Stability (PR #68)
- **JS Error Fix**: Corrected the `navigateToArticle` state initialization and setter usage in `KeyboardNavigationProvider`, resolving `TypeError` crashes.
- **Unified Navigation**: Refactored `ArticleList` and `ArticleZapNavigation` to use the unified `articleUrlToPath` utility, ensuring consistent protocol-aware navigation across the app.
- **Smart Back-Button**: Integrated `lastListUrl` persistence to ensure the back button correctly returns users to their previous context (feed/category).

## Lessons Learned
- **Source-Driven Normalization**: Encoding the protocol into the URL path at the source (frontend) is more robust than maintaining "lenient" fallback logic in the database, as it removes ambiguity early in the request lifecycle.
- **Referrer Policy Nuance**: While `no-referrer` is the most private option, it can break local network authentication and proxy state checks. `strict-origin-when-cross-origin` provides a better balance for applications interacting with local self-hosted services.
- **Functional State Initializers**: In React, when storing functions in state, always use functional initializers `useState(() => () => {})` to prevent the function from being executed during the initial render.

## Next Steps
- Reviewers to confirm the scoped changes in PR #62 and PR #68.
- Monitor local LLM connectivity logs in production environments.
