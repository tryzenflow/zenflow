# Landing

Public site at `usezenflow.com`: Astro static pages with React islands for the motion demos. VI at `/`, EN at `/en/`.

## Run

```bash
pnpm --filter landing dev        # http://localhost:4321
pnpm --filter landing build      # dist/ and a bundle size report
pnpm --filter landing preview
pnpm --filter landing check      # typecheck, lint, unit tests
```

## Env

| Var | Default | Use |
| --- | --- | --- |
| `PUBLIC_SITE_URL` | `https://usezenflow.com` | Canonical, hreflang, OG and sitemap origin |
| `PUBLIC_APK_URL` | latest `tryzenflow/releases` APK | Download and QR target |

## Layout

- `src/content/copy.ts`: EN and VI copy, ported from `backend/src/landing/landing.content.ts`.
- `src/islands/`: React islands, all `client:visible`. Each wraps itself in `LazyMotion` so motion features load separately.
- `src/og/card.ts`: share cards, built to `/og/en.png` and `/og/vi.png`.
- Reduced motion: `prefers-reduced-motion` disables the CSS animations and the JS motion.
