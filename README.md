# Solarium

Solarium is a WebGL2 liquid glass library for the browser, ported from [LiquidGlassKit](https://github.com/DnV1eX/LiquidGlassKit) (Swift / Metal) and [AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass) (Compose Multiplatform / AGSL).

It renders physically-based real-time optical refraction, 7-band spectral dispersion, Fresnel rims, and glare over arbitrary DOM drawables (canvases, images, and video backdrops).

---

## Architecture & Optics

### 1. Analytical Distance Fields
Unlike naive shader blurs or post-process distortion passes, Solarium computes surface normals analytically via `sdRoundedRect` and `gradSdRoundedRect`. This avoids finite-difference approximations (`dFdx` / `dFdy`), preventing gradient artifacts and shader crashes across ANGLE Direct3D 11 backends on Intel Integrated Graphics.

### 2. Multi-band Spectral Dispersion
Refraction samples the backdrop across 7 discrete chromatic wavelengths:
- **Red:** 650 nm
- **Orange:** 610 nm
- **Yellow:** 580 nm
- **Green:** 540 nm (reference index)
- **Cyan:** 500 nm
- **Blue:** 460 nm
- **Violet:** 420 nm

### 3. Surface Curvature & Lighting
- **Curvature Profile:** Spherical cap mapping (`circleMap`) with adjustable refractive index and thickness.
- **Fresnel Reflections:** Distance-attenuated specular edge lighting with ambient bias.
- **Touch Interaction:** Dynamic radial spotlights (`InteractiveHighlight`) driven by pointer coordinates.

---

## Components

| Component | Source | Description |
| :--- | :--- | :--- |
| `LiquidGlassView` | `glass-view.js` | Base WebGL2 glass surface mapped to backdrops. |
| `MenuView` | `menuview.js` | Glass pull-down context menu with liquid blob morphing. |
| `LiquidGlassSlider` | `slider.js` | Slider with contracted/expanded liquid glass thumb. |
| `LiquidGlassSwitch` | `switch.js` | Toggle with 1:1 iOS dimensions and magnified glass thumb. |
| `LiquidLensView` | `lens-view.js` | Movable lens with squash-and-stretch acceleration physics. |
| `VisualEffectView` | `effect-view.js` | Container host replicating UIKit's `UIVisualEffectView`. |

---

## Quickstart

```javascript
import { LiquidGlassView, LiquidGlass } from './index.js';

const scene = document.querySelector('canvas.backdrop');

const glass = new LiquidGlassView(LiquidGlass.regular(), {
  source: scene,
  sourceBounds: () => scene.getBoundingClientRect(),
  cornerRadius: 24,
});

glass.appendTo(document.querySelector('.card'));
glass.requestDraw();
```

### Context Menu

```javascript
import { MenuView } from './index.js';

const button = document.getElementById('menu-trigger');

const menu = new MenuView(button, {
  source: scene,
  theme: 'dark',
  placement: 'morph',
  items: [
    { label: 'Share', icon: MenuView.icons.share, onSelect: () => {} },
    { label: 'Duplicate', icon: MenuView.icons.copy },
    {
      type: 'menu',
      menuTitle: 'Add to Playlist',
      menuItems: [
        { label: 'Favorites', state: 'on' },
        { label: 'New Playlist…' },
      ],
    },
    { label: 'Delete', destructive: true, icon: MenuView.icons.trash },
  ],
});
```

---

## Browser Support

- Requires WebGL2 support (`GLSL ES 3.00`).
- Compatible with Chrome, Edge, Safari (15+), and Firefox.
- Fully compatible with Windows Intel UHD / Iris Xe Graphics (Direct3D 11 ANGLE translator).

---

## License

GNU AGPL 3.0