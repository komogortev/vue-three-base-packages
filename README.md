# vue-three-base-packages (`@base/workspace`)

pnpm monorepo of **shared libraries** for Vue + Three.js PWAs in the **@base** ecosystem. These packages are consumed from application repos (e.g. [threejs-engine-dev](https://github.com/komogortev/threejs-engine-dev)) via **`pnpm` `file:`/`link:`** during development or from **GitHub Packages** when published.

**Repository:** [github.com/komogortev/vue-three-base-packages](https://github.com/komogortev/vue-three-base-packages)

---

## Packages

| Package | Role |
|--------|------|
| `@base/engine-core` | `BaseModule`, `EventBus`, shell/engine mount contract |
| `@base/threejs-engine` | Renderer, scene, camera, RAF loop, `ThreeModule`, assets |
| `@base/input` | Keyboard/gamepad/touch → `input:axis` / `input:action` on the bus |
| `@base/player-three` | `PlayerController`, terrain snap, Mixamo-oriented animation helpers |
| `@base/camera-three` | `GameplayCameraController`, third-person presets, first-person eye offset |
| `@base/pwa-core` | PWA-oriented helpers (shell integration) |
| `@base/audio` | Audio utilities |
| `@base/ui` | Vue UI kit (workspace member) |

Each package has its own `package.json`, `tsconfig`, and **`dist/`** produced by `tsc` (or Vite for `ui`). **`dist/` is gitignored** — run **`pnpm build`** before linking into apps.

---

## Requirements

- **Node** ≥ 20  
- **pnpm** ≥ 9  

---

## Scripts (root)

```bash
pnpm install
pnpm build      # pnpm -r --sort run build — topological order (engine-core before input, etc.)
pnpm test       # where configured per package
pnpm typecheck
```

---

## GitHub configuration

| Concern | This repo |
|--------|-----------|
| **GitHub Pages** | **Not used** — libraries only, no static site. |
| **GitHub Actions** | CI workflow runs **install + build** on push/PR to validate the workspace (see `.github/workflows/ci.yml`). Uses **GitHub-hosted** `ubuntu-latest` (no self-hosted runner required). Workflow sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` per [GitHub’s Node 20 deprecation on Actions](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/). |
| **Publishing** | Use `pnpm publish` / GitHub Packages per package; bump versions and follow your release process. |

---

## Consuming from an app repo

**Development (recommended layout):**

```text
workspace/
  vue-three-base-packages/   # this repo (clone as SHARED)
  threejs-engine-dev/        # app with link:../vue-three-base-packages/packages/...
```

Build **this** workspace first, then `pnpm install` in the app.

**Published installs:** point `package.json` dependencies at the registry versions of `@base/*` once published (replace `link:` entries).

---

## License

As specified per package / repository owner (add root `LICENSE` if you want a public default).
