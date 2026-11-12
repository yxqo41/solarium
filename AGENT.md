# AGENT.md — Architecture & Engineering Guidelines

This document provides technical guidance for AI agents and maintainers modifying the `solarium` codebase.

---

## 1. Project Overview & Origins

Solarium is a browser-based WebGL2 implementation of Apple's Liquid Glass aesthetics, derived from:
1. **[LiquidGlassKit](https://github.com/DnV1eX/LiquidGlassKit)** (iOS UIKit, Swift + Metal): Interaction patterns, view lifecycle, spring physics, and component dimensions.
2. **[AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass)** (Compose Multiplatform / AGSL): Optical formulation, analytical SDF gradients, 7-band spectral dispersion, and highlight/shadow models.

---

## 2. Directory & Module Map

- `shaders.js`: GLSL ES 3.00 vertex & fragment shaders (`sdRoundedRect`, `gradSdRoundedRect`, `circleMap`, chromatic dispersion, highlights).
- `renderer.js`: WebGL2 pipeline owner: program compilation, uniform cache, dual-pass separable Gaussian blur, and draw calls.
- `glass-view.js`: `LiquidGlassView`: DOM-to-canvas bridge, backdrop capture (`captureCanvas`), and uniform building.
- `liquid-glass.js`: Material presets (`regular`, `clear`, `lens`, `thumb`), uniform definitions, and theme color resolvers.
- `menuview.js` / `menuview.css`: Liquid glass pull-down menu with smooth-union blob morphing and inline submenus.
- `menu-blob.js`: Radial SDF ray-marching tracer generating SVG clip-paths for morph transitions.
- `slider.js` & `switch.js`: Interactive controls with morphing liquid glass thumbs.
- `lens-view.js`: Freely draggable/inertial lens with velocity-based squash and stretch.
- `spring.js`: Semi-implicit Euler spring integrators and motion utilities.

---

## 3. Shader Invariants & GPU Compatibility

When editing `shaders.js`:

1. **No Screen-Space Derivatives in Dynamic Control Flow:**
   - Never call `dFdx()` or `dFdy()` inside loops or dynamic conditional branches (`if`/`else`).
   - The ANGLE Direct3D 11 translator on Windows / Intel Integrated Graphics crashes or fails shader validation if derivative instructions appear in divergent execution paths.
   - Always use the analytical normal function: `gradSdRoundedRect()`.

2. **Strict Math Domain Guards:**
   - Always guard `pow(base, exp)` against zero or negative inputs: `pow(max(x, 1e-4), y)`.
   - Never call `normalize(vec)` on zero vectors without fallback: `length(v) > 1e-5 ? normalize(v) : vec2(0.0)`.

3. **Multi-band Chromatic Aberration:**
   - Dispersion is evaluated along 7 discrete wavelengths (`RED`, `ORANGE`, `YELLOW`, `GREEN`, `CYAN`, `BLUE`, `PURPLE`) scaled by `dispersionStrength` and index deltas defined in `AndroidLiquidGlass`.

---

## 4. Coordinate Spaces & Backdrop Capture

Browsers cannot synchronously read composited DOM layers beneath a canvas without permission/extension APIs.
- The host application must designate a background drawable (HTMLCanvasElement, HTMLImageElement, or HTMLVideoElement) via `source` and provide its screen bounds via `sourceBounds`.
- Coordinate conversion:
  - Layout / DOM metrics: CSS pixels (`getBoundingClientRect()`).
  - Canvas backing store: Device pixels (`devicePixels = Math.round(css * devicePixelRatio)`).
  - WebGL viewport: Mapped strictly to the element's device-pixel dimensions.

---

## 5. Coding Standards

- **No Framework Dependencies:** Pure modern ES modules and vanilla DOM APIs.
- **Garbage Collection Hygiene:** Avoid per-frame object or array allocations inside `draw()`, `_stepTransition()`, or `step()`. Reuse existing buffers and vectors.
- **Graceful Fallback:** If `LiquidGlassRenderer.isSupported()` returns false (WebGL2 missing), `dataset.solariumFallback = 'true'` is applied and DOM CSS backdrop filters take over.
