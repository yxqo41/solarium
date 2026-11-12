/* solarium — a JavaScript port of LiquidGlassKit
 * (https://github.com/DnV1eX/LiquidGlassKit, Swift + Metal).
 *
 * The upstream project is a UIKit library that recreates iOS 26's Liquid Glass
 * on iOS 13–18 and replaces the native materials when they are unavailable.
 * A glass pull-down menu is also exported as MenuView / LiquidGlassMenuView.
 * Load ../menuview.css and ./menuview.css, then pass a trigger and item list:
 *
 *   const menu = new MenuView(button, { source: backdropCanvas,
 *     items: [{ label: 'Settings', onSelect: openSettings }] });
 *
 * This directory is the same material and the same controls, rebuilt on WebGL2
 * and DOM:
 *
 *   LiquidGlassFragment.metal  -> shaders.js          GLSL ES 3.00
 *   LiquidGlassView.swift      -> glass-view.js       canvas, uniforms, capture
 *   LiquidGlassRenderer        -> renderer.js         program, blur, draw
 *   LiquidGlassEffectView.swift-> effect-view.js      effect and container hosts
 *   LiquidLensView.swift       -> lens-view.js        resting pill / lifted lens
 *   LiquidGlassSlider.swift    -> slider.js           contracted / expanded thumb
 *   LiquidGlassSwitch.swift    -> switch.js           same, with edge toggling
 *   ZeroCopyBridge.swift       -> not ported          the browser uploads the
 *                                                      capture directly
 *
 * There is no `isNative` routing: a browser has no system liquid glass to defer
 * to, so the recreated implementation is always the one that renders.
 *
 * Usage — every material needs a backdrop to refract, which is the drawable
 * behind it:
 *
 *   import { LiquidGlassView, LiquidGlass } from './solarium/index.js';
 *
 *   const glass = new LiquidGlassView(LiquidGlass.regular(), {
 *     source: document.querySelector('.backdrop'),
 *   });
 *   glass.appendTo(panel);
 *   glass.requestDraw();
 *
 * A lens follows its host by default. For a standalone movable lens, call
 * `lens.setDraggable()` (or `lens.setDraggable(true, { axis: 'x' })`). It lifts
 * while held, captures pointer movement outside its bounds, and stays where it
 * is dropped. Disable with `lens.setDraggable(false)`. Make the element focusable
 * and label it to enable its arrow-key movement and Escape cancellation.
 */

export { LiquidGlass, MAX_RECTANGLES } from './liquid-glass.js';
export { LiquidGlassView } from './glass-view.js';
export {
  LiquidGlassEffect,
  LiquidGlassContainerEffect,
  LiquidGlassEffectView,
  VisualEffectView,
} from './effect-view.js';
export { LiquidLensView } from './lens-view.js';
export { LiquidGlassSlider } from './slider.js';
export { LiquidGlassSwitch } from './switch.js';
export { LiquidGlassTabBar, TabBar } from './tab-bar.js';
export { prefersReducedMotion } from './spring.js';

export { MenuView, LiquidGlassMenuView } from './menuview.js';
export { normalizeMenuConfig, normalizeMenuItems } from './context-menu.js';
