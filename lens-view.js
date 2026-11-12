/* solarium — a JavaScript port of LiquidGlassKit
 * (https://github.com/DnV1eX/LiquidGlassKit, Swift + Metal).
 *
 * Port of LiquidLensView.swift: the tab-bar lens that rests as a translucent
 * pill, lifts into a glass lens, and squashes or stretches with the
 * acceleration of whatever is dragging it.
 *
 * The UIKit original tracks `layer.position` on a CADisplayLink. A DOM element
 * can be moved by any ancestor transform, so the tracking reads the element's
 * own on-screen rect instead — the same quantity, without assuming who moves
 * it.
 */

import { LiquidGlassView } from './glass-view.js';
import { LiquidGlass } from './liquid-glass.js';
import { animateSpring, clamp, prefersReducedMotion } from './spring.js';

// Timing and physics constants from LiquidLensView.swift.
const ACCELERATION_WINDOW = 0.3;       // seconds of position history
const ACCELERATION_SCALE = 0.00005;    // acceleration -> scale deviation
const MAX_SCALE_DEVIATION = 0.3;

export class LiquidLensView {
  constructor({ source = null, sourceBounds = null, restingBackgroundColor = null } = {}) {
    this.element = document.createElement('div');
    Object.assign(this.element.style, {
      position: 'relative',
      // The lifted lens overflows the resting pill's box, as it does on iOS.
      overflow: 'visible',
      touchAction: 'none',
    });

    this.restingPill = document.createElement('div');
    Object.assign(this.restingPill.style, {
      position: 'absolute',
      inset: '0',
      borderRadius: '999px',
      background: restingBackgroundColor ?? 'rgba(255, 255, 255, 0.3)',
      pointerEvents: 'none',
    });
    this.element.append(this.restingPill);

    this.glass = new LiquidGlassView(LiquidGlass.lens(), {
      source,
      sourceBounds,
      cornerRadius: 0,
    });
    Object.assign(this.glass.element.style, {
      position: 'absolute',
      inset: '0',
      opacity: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
    });
    this.element.append(this.glass.element);

    this.lifted = false;
    this.liftAnimation = null;
    this.trackingFrame = 0;
    this.positionHistory = [];
    this.lastSampleTime = 0;
    this.dragCleanup = null;
    this.deviation = 0;
    this.deviationVelocity = 0;
    this.targetDeviation = 0;
    this.deformationTime = null;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.lifted) this.layoutGlass(this.deviation);
    });
    this.resizeObserver.observe(this.element);
  }

  // The view normally follows a host's layout, just like the UIKit lens. A
  // standalone demo can opt into pointer movement without making every lens
  // hijack the gestures of a tab bar or another control that owns its position.
  setDraggable(enabled = true, { axis = 'both' } = {}) {
    this.dragCleanup?.();
    this.dragCleanup = null;
    if (!enabled) return this;
    if (!['both', 'x', 'y'].includes(axis)) throw new TypeError('Lens drag axis must be both, x or y.');

    const element = this.element;
    const original = { transform: element.style.transform, cursor: element.style.cursor,
      userSelect: element.style.userSelect };
    const state = { pointerId: null, x: 0, y: 0, startX: 0, startY: 0,
      clientX: 0, clientY: 0, wasLifted: false, keyboard: false };
    const listeners = [];
    const listen = (target, name, handler) => {
      target.addEventListener(name, handler);
      listeners.push(() => target.removeEventListener(name, handler));
    };
    const move = () => {
      element.style.transform = `translate(${state.x}px, ${state.y}px) ${original.transform}`;
      this.glass.requestDraw();
    };
    const finish = (cancelled = false) => {
      if (state.pointerId == null && !state.keyboard) return;
      const pointerId = state.pointerId;
      state.pointerId = null;
      state.keyboard = false;
      if (cancelled) { state.x = state.startX; state.y = state.startY; move(); }
      if (pointerId != null && element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      element.style.cursor = 'grab';
      this.setLifted(state.wasLifted);
    };
    element.style.cursor = 'grab';
    element.style.userSelect = 'none';
    listen(element, 'pointerdown', event => {
      if (state.pointerId != null || state.keyboard || event.isPrimary === false || event.button !== 0) return;
      if (event.target !== element && event.target.closest?.('button, input, select, textarea, a')) return;
      event.preventDefault();
      state.pointerId = event.pointerId;
      state.clientX = event.clientX; state.clientY = event.clientY;
      state.startX = state.x; state.startY = state.y;
      state.wasLifted = this.lifted;
      // The lens's CSS translation lives in its parent's coordinate space. A
      // scaled host therefore needs pointer distances converted back to CSS px.
      const rect = element.getBoundingClientRect();
      state.scaleX = rect.width / (element.offsetWidth || rect.width) || 1;
      state.scaleY = rect.height / (element.offsetHeight || rect.height) || 1;
      element.setPointerCapture(event.pointerId);
      if (element.tabIndex >= 0) element.focus({ preventScroll: true });
      element.style.cursor = 'grabbing';
      this.setLifted(true);
    });
    listen(element, 'pointermove', event => {
      if (event.pointerId !== state.pointerId) return;
      if (axis !== 'y') state.x = state.startX + (event.clientX - state.clientX) / state.scaleX;
      if (axis !== 'x') state.y = state.startY + (event.clientY - state.clientY) / state.scaleY;
      move();
    });
    listen(element, 'pointerup', event => { if (event.pointerId === state.pointerId) finish(); });
    listen(element, 'pointercancel', event => { if (event.pointerId === state.pointerId) finish(true); });
    listen(element, 'lostpointercapture', event => { if (event.pointerId === state.pointerId) finish(true); });
    listen(window, 'blur', () => finish(true));
    listen(element, 'blur', () => { if (state.keyboard) finish(); });
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    listen(element, 'keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); finish(true); return; }
      if (event.target !== element || !arrows.includes(event.key) || state.pointerId != null) return;
      event.preventDefault();
      if (!state.keyboard) {
        state.keyboard = true; state.wasLifted = this.lifted;
        state.startX = state.x; state.startY = state.y;
        this.setLifted(true);
      }
      const step = event.shiftKey ? 40 : 10;
      if (axis !== 'y') state.x += event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
      if (axis !== 'x') state.y += event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
      move();
    });
    listen(element, 'keyup', event => { if (arrows.includes(event.key) && state.keyboard) finish(); });
    this.dragCleanup = () => {
      finish();
      listeners.forEach(remove => remove());
      Object.assign(element.style, original);
      this.glass.requestDraw();
    };
    return this;
  }

  setRestingBackgroundColor(color) {
    this.restingPill.style.background = color;
  }

  setBackgroundSource(source, bounds = null) {
    this.glass.setBackgroundSource(source, bounds);
  }

  // Mirrors `setLifted(_:animated:alongsideAnimations:completion:)`. The
  // alongside callback runs inside the same frame as the lift, so callers can
  // move the surrounding chrome in step with it.
  setLifted(lifted, { animated = true, alongside = null } = {}) {
    if (this.lifted === lifted) {
      return;
    }
    this.lifted = lifted;
    if (this.liftAnimation) {
      this.liftAnimation();
      this.liftAnimation = null;
    }

    if (lifted) {
      this.lift(animated);
    } else {
      this.lower(animated);
    }

    if (alongside) {
      alongside();
    }
  }

  // UIKit clamps `layer.cornerRadius` to half the short side when it draws the
  // pill, so a 999pt radius on a 34pt-tall view is a pill, not an empty shape.
  // The shader has no such clamp, so the radius handed to it has to be the
  // resolved one.
  glassCornerRadius() {
    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    return Math.max(0, Math.min(width, height) / 2);
  }

  lift(animated = true) {
    const pillStart = Number.parseFloat(this.restingPill.style.opacity || '1');
    this.layoutGlass(this.deviation);
    this.glass.element.style.visibility = 'visible';
    const glassStart = Number.parseFloat(this.glass.element.style.opacity || '0');
    this.glass.requestDraw();
    this.startPositionTracking();

    const frame = progress => {
      // Clamped for the same reason as the thumb morph: the spring overshoots
      // and CSS ignores an opacity outside 0..1, which would drop frames of the
      // crossfade.
      this.restingPill.style.opacity = String(clamp(pillStart * (1 - progress), 0, 1));
      this.glass.element.style.opacity = String(clamp(glassStart + (1 - glassStart) * progress, 0, 1));
    };

    if (animated && !prefersReducedMotion()) {
      this.liftAnimation = animateSpring({
        duration: 0.4,
        damping: 0.7,
        onFrame: frame,
        onDone: () => {
          this.liftAnimation = null;
          this.restingPill.style.opacity = '0';
          this.glass.element.style.opacity = '1';
        },
      });
    } else {
      this.restingPill.style.opacity = '0';
      this.glass.element.style.opacity = '1';
    }
  }

  lower(animated = true) {
    this.stopPositionTracking();
    this.restingPill.style.visibility = 'visible';
    const pillStart = Number.parseFloat(this.restingPill.style.opacity || '0');
    const glassStart = Number.parseFloat(this.glass.element.style.opacity || '1');
    const frame = progress => {
      this.restingPill.style.opacity = String(clamp(pillStart + (1 - pillStart) * progress, 0, 1));
      this.glass.element.style.opacity = String(clamp(glassStart * (1 - progress), 0, 1));
      this.glass.requestDraw();
    };

    const finish = () => {
      if (this.lifted) {
        return;
      }
      // The glass leaves the hierarchy again, which also stops its capture loop.
      this.glass.element.style.visibility = 'hidden';
      this.glass.element.style.opacity = '0';
      this.layoutGlass(0);
    };

    if (animated && !prefersReducedMotion()) {
      this.liftAnimation = animateSpring({
        duration: 0.5,
        damping: 0.8,
        onFrame: frame,
        onDone: () => {
          this.liftAnimation = null;
          finish();
        },
      });
    } else {
      frame(1);
      finish();
    }
  }

  // Position is sampled while lifted; the same frame owner also settles the
  // last deformation on release. Pointer event spacing is irregular, so raw
  // acceleration must not become an instantaneous size jump.
  startPositionTracking() {
    this.positionHistory = [];
    this.lastSampleTime = 0;
    this.targetDeviation = 0;
    if (this.trackingFrame || prefersReducedMotion()) return;
    this.deformationTime = null;
    const step = now => {
      this.trackingFrame = 0;
      if (prefersReducedMotion()) { this.stopPositionTracking(true); return; }
      const dt = this.deformationTime == null ? 1 / 60 : Math.max(0, (now - this.deformationTime) / 1000);
      this.deformationTime = now;
      if (this.lifted) {
        const rect = this.element.getBoundingClientRect();
        this.samplePosition(rect.left + rect.width / 2, rect.top + rect.height / 2, now / 1000);
      }
      this.stepDeformation(dt);
      this.applyAccelerationSize(this.deviation / ACCELERATION_SCALE);
      // Geometry and pixels are committed together, before this frame paints.
      // A second requestAnimationFrame would leave old pixels stretched into
      // the new CSS box for a full display frame.
      this.glass.draw();
      if (this.lifted || Math.abs(this.deviation) > 0.00001 || Math.abs(this.deviationVelocity) > 0.0001) {
        this.trackingFrame = requestAnimationFrame(step);
      }
    };
    this.trackingFrame = requestAnimationFrame(step);
  }

  // Critical damping removes pointer quantisation without adding a second
  // wobble. The exact solution remains stable across missed frames and reaches
  // 90% of a changed target in about 80ms.
  stepDeformation(dt) {
    const omega = 48;
    const displacement = this.deviation - this.targetDeviation;
    const velocity = this.deviationVelocity;
    const decay = Math.exp(-omega * dt);
    this.deviation = this.targetDeviation + (displacement + (velocity + omega * displacement) * dt) * decay;
    this.deviationVelocity = (velocity - omega * (velocity + omega * displacement) * dt) * decay;
    if (Math.abs(this.deviation - this.targetDeviation) < 0.00001 && Math.abs(this.deviationVelocity) < 0.0001) {
      this.deviation = this.targetDeviation;
      this.deviationVelocity = 0;
    }
  }

  stopPositionTracking(immediate = false) {
    this.positionHistory = [];
    this.targetDeviation = 0;
    if (immediate || prefersReducedMotion() || !this.trackingFrame) {
      if (this.trackingFrame) cancelAnimationFrame(this.trackingFrame);
      this.trackingFrame = 0;
      this.deviation = 0;
      this.deviationVelocity = 0;
      this.layoutGlass(0);
    }
  }

  samplePosition(x, y, timestamp) {
    if (!this.lastSampleTime) {
      this.lastSampleTime = timestamp;
    }
    this.positionHistory.push({ x, y, timestamp });

    const cutoff = timestamp - ACCELERATION_WINDOW;
    this.positionHistory = this.positionHistory.filter(sample => sample.timestamp >= cutoff);

    this.targetDeviation = clamp(this.averageAcceleration() * ACCELERATION_SCALE,
      -MAX_SCALE_DEVIATION, MAX_SCALE_DEVIATION);
  }

  // Average acceleration over the history window, combined into one number:
  // positive means "accelerating right or up", negative "left or down". Y is
  // negated because a downward screen axis and an upward gesture should not
  // produce the same squash.
  averageAcceleration() {
    const samples = this.positionHistory;
    if (samples.length < 3) {
      return 0;
    }

    const velocities = [];
    for (let i = 1; i < samples.length; i += 1) {
      const previous = samples[i - 1];
      const current = samples[i];
      const delta = current.timestamp - previous.timestamp;
      if (delta <= 0) {
        continue;
      }
      velocities.push({
        x: (current.x - previous.x) / delta,
        y: (current.y - previous.y) / delta,
        timestamp: (previous.timestamp + current.timestamp) / 2,
      });
    }
    if (velocities.length < 2) {
      return 0;
    }

    let totalX = 0;
    let totalY = 0;
    let count = 0;
    for (let i = 1; i < velocities.length; i += 1) {
      const previous = velocities[i - 1];
      const current = velocities[i];
      const delta = current.timestamp - previous.timestamp;
      if (delta <= 0) {
        continue;
      }
      totalX += (current.x - previous.x) / delta;
      totalY += (current.y - previous.y) / delta;
      count += 1;
    }
    if (!count) {
      return 0;
    }

    return totalX / count - totalY / count;
  }

  // Match the reference's centred frame changes, not a compositor scale. A
  // scaled canvas turns circular corners into ellipses and stretches a stale
  // refraction image. Resizing reruns the shader in the new geometry instead.
  layoutGlass(deviation = 0) {
    const baseWidth = this.element.clientWidth;
    const baseHeight = this.element.clientHeight;
    if (!baseWidth || !baseHeight) return;
    this.glass.rasterSize = { width: baseWidth * (1 + MAX_SCALE_DEVIATION),
      height: baseHeight * (1 + MAX_SCALE_DEVIATION) };
    this.glass.captureRasterSize = this.glass.rasterSize;
    const width = baseWidth * (1 + deviation);
    const height = baseHeight * (1 - deviation);
    Object.assign(this.glass.element.style, {
      inset: 'auto',
      left: `${(baseWidth - width) / 2}px`,
      top: `${(baseHeight - height) / 2}px`,
      width: `${width}px`,
      height: `${height}px`,
      transform: 'none',
    });
    // A layer's corner radius resolves against its current bounds. Clamp the
    // shader too, so a flattened pill cannot grow a pinched, inverted centre.
    this.glass.setCornerRadius(Math.min(this.glassCornerRadius(), width / 2, height / 2));
    this.glass.requestDraw();
  }

  applyAccelerationSize(acceleration) {
    const deviation = prefersReducedMotion() ? 0
      : clamp(acceleration * ACCELERATION_SCALE, -MAX_SCALE_DEVIATION, MAX_SCALE_DEVIATION);
    this.layoutGlass(deviation);
  }

  appendTo(parent) {
    parent.append(this.element);
    return this;
  }

  dispose() {
    this.dragCleanup?.();
    this.dragCleanup = null;
    this.resizeObserver.disconnect();
    this.stopPositionTracking(true);
    if (this.liftAnimation) {
      this.liftAnimation();
      this.liftAnimation = null;
    }
    this.glass.dispose();
    this.element.remove();
  }
}
