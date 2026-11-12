/* solarium — a JavaScript port of LiquidGlassKit
 * (https://github.com/DnV1eX/LiquidGlassKit, Swift + Metal).
 *
 * Port of LiquidGlassSlider.swift: a slider whose thumb rests as a solid pill
 * and expands into a glass pill while it is being used. The value mapping,
 * rubber-band resistance, track fill ramp and tap-versus-drag timing are the
 * same numbers as the UIKit control.
 *
 * Not ported: the minimum/maximum value images. They are UIKit image views that
 * only shift the track inset, and the port has no image API to hang them on.
 */

import { LiquidGlassView } from './glass-view.js';
import { LiquidGlass } from './liquid-glass.js';
import { ThumbMorph } from './thumb.js';
import { animateSpring, clamp, prefersReducedMotion } from './spring.js';

const HEIGHT = 28;
const TRACK_HEIGHT = 6;
const CONTRACTED = { width: 40, height: 24 };
const EXPANDED = { width: 60, height: 36 };

// A touch shorter than this counts as a tap rather than a drag.
const TAP_THRESHOLD = 150;
// Distance from an end at which the edge haptic fires.
const EDGE_THRESHOLD = 2;
// The fill fades in over this distance from either end.
const FILL_RAMP = 10;
// How long a tap keeps the thumb expanded before it contracts again.
const TAP_CONTRACT_DELAY = 200;

export class LiquidGlassSlider {
  constructor(options = {}) {
    this.minimumValue = options.minimumValue ?? 0;
    this.maximumValue = options.maximumValue ?? 1;
    this.isContinuous = options.isContinuous !== false;
    this.minimumTrackTintColor = options.minimumTrackTintColor ?? 'rgb(0, 145, 255)';
    this.maximumTrackTintColor = options.maximumTrackTintColor ?? 'rgba(120, 120, 128, 0.36)';
    this.thumbTintColor = options.thumbTintColor ?? '#ffffff';
    this.onHaptic = options.onHaptic ?? null;

    this.currentValue = clamp(options.value ?? 0, this.minimumValue, this.maximumValue);
    this.isDragging = false;
    this.isThumbExpanded = false;
    this.isUpdatingValue = false;
    this.pointerId = null;
    this.rubberBandOffset = 0;
    this.dragStartLocation = 0;
    this.dragStartThumbCenterX = 0;
    this.touchBeganTime = 0;
    this.didTriggerMinHaptic = false;
    this.didTriggerMaxHaptic = false;
    this.tapTimer = 0;
    this.positionAnimation = null;
    this.trackAnimation = null;

    this.element = document.createElement('div');
    Object.assign(this.element.style, {
      position: 'relative',
      width: '100%',
      height: `${HEIGHT}px`,
      touchAction: 'none',
      userSelect: 'none',
      cursor: 'default',
      outline: 'none',
    });
    this.element.tabIndex = 0;
    this.element.setAttribute('role', 'slider');
    this.element.setAttribute('aria-valuemin', String(this.minimumValue));
    this.element.setAttribute('aria-valuemax', String(this.maximumValue));

    this.track = document.createElement('div');
    Object.assign(this.track.style, {
      position: 'absolute',
      borderRadius: `${TRACK_HEIGHT / 2}px`,
      background: this.maximumTrackTintColor,
      pointerEvents: 'none',
      transition: 'background-color 200ms ease',
    });

    this.fill = document.createElement('div');
    Object.assign(this.fill.style, {
      position: 'absolute',
      background: this.minimumTrackTintColor,
      pointerEvents: 'none',
      transition: 'background-color 200ms ease',
    });

    this.contractedThumb = document.createElement('div');
    Object.assign(this.contractedThumb.style, {
      background: this.thumbTintColor,
      // The resting pill keeps a faint drop shadow so it reads as lifted off
      // the track even before it becomes glass.
      boxShadow: '0 0 5px rgba(0, 0, 0, 0.15)',
      transition: 'background-color 200ms ease',
    });

    this.glass = new LiquidGlassView(LiquidGlass.thumb(), {
      source: options.source ?? null,
      sourceBounds: options.sourceBounds ?? null,
      backgroundLayers: [this.track, this.fill],
      cornerRadius: EXPANDED.height / 2,
    });

    this.thumb = new ThumbMorph({
      container: this.element,
      controlHeight: HEIGHT,
      contracted: this.contractedThumb,
      glass: this.glass,
      contractedSize: CONTRACTED,
      expandedSize: EXPANDED,
    });

    this.element.append(this.track, this.fill, this.contractedThumb, this.glass.element);

    this.setEnabled(options.isEnabled !== false);
    this.bindEvents();
    this.layout();
    this.syncAccessibility();
  }

  // Track geometry. The value images would inset this; nothing else does.
  trackRect() {
    return {
      x: 0,
      y: (HEIGHT - TRACK_HEIGHT) / 2,
      width: this.element.clientWidth,
      height: TRACK_HEIGHT,
    };
  }

  get minThumbCenterX() {
    return CONTRACTED.width / 2;
  }

  get maxThumbCenterX() {
    return Math.max(this.element.clientWidth - CONTRACTED.width / 2, this.minThumbCenterX);
  }

  get thumbCenterRange() {
    return this.maxThumbCenterX - this.minThumbCenterX;
  }

  get normalizedValue() {
    if (this.maximumValue <= this.minimumValue) {
      return 0;
    }
    return (this.currentValue - this.minimumValue) / (this.maximumValue - this.minimumValue);
  }

  get targetThumbCenterX() {
    return this.minThumbCenterX + this.thumbCenterRange * this.normalizedValue;
  }

  get value() {
    return this.currentValue;
  }

  set value(next) {
    const clamped = clamp(next, this.minimumValue, this.maximumValue);
    if (clamped === this.currentValue) {
      return;
    }
    this.currentValue = clamped;

    if (!this.isUpdatingValue && !this.isDragging) {
      this.updateThumbPosition(false);
      this.updateTrackFill();
    }

    this.syncAccessibility();
    this.element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  setValue(next, animated = false) {
    const clamped = clamp(next, this.minimumValue, this.maximumValue);
    if (clamped === this.currentValue) {
      return;
    }
    this.isUpdatingValue = true;
    this.value = clamped;
    this.isUpdatingValue = false;
    this.updateThumbPosition(animated);
    this.updateTrackFill();
  }

  setMinimumValue(value) {
    this.minimumValue = value;
    this.element.setAttribute('aria-valuemin', String(value));
    this.currentValue = clamp(this.currentValue, this.minimumValue, this.maximumValue);
    this.syncAccessibility();
    this.layout();
  }

  setMaximumValue(value) {
    this.maximumValue = value;
    this.element.setAttribute('aria-valuemax', String(value));
    this.currentValue = clamp(this.currentValue, this.minimumValue, this.maximumValue);
    this.syncAccessibility();
    this.layout();
  }

  setEnabled(enabled) {
    this.isEnabled = enabled;
    this.element.style.opacity = enabled ? '1' : '0.5';
    this.element.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    if (!enabled) {
      this.element.tabIndex = -1;
    } else {
      this.element.tabIndex = 0;
    }
  }

  setBackgroundSource(source, bounds = null) {
    this.glass.setBackgroundSource(source, bounds);
  }

  syncAccessibility() {
    this.element.setAttribute('aria-valuenow', String(this.currentValue));
    this.element.setAttribute('aria-valuetext', this.currentValue.toFixed(2));
  }

  // Recomputes everything that depends on the element's width. The controls are
  // laid out by their host, so this runs from a ResizeObserver as well as from
  // construction.
  layout() {
    this.thumb.setCenter(this.targetThumbCenterX);
    this.updateTrackLayout();
    this.updateTrackFill();
  }

  updateTrackLayout() {
    const track = this.trackRect();
    const centerY = HEIGHT / 2;

    // Rubber band: the track slides with the thumb and thins out while the
    // thumb is being pulled past an end. Same formula as the UIKit control.
    const horizontalOffset = this.rubberBandOffset / 4 * 3 - Math.abs(this.rubberBandOffset) / 4;
    const heightShrink = Math.abs(this.rubberBandOffset) / 3;
    const effectiveHeight = Math.max(2, TRACK_HEIGHT - heightShrink);

    Object.assign(this.track.style, {
      left: `${track.x + horizontalOffset}px`,
      top: `${centerY - effectiveHeight / 2}px`,
      width: `${track.width + Math.abs(this.rubberBandOffset) / 2}px`,
      height: `${effectiveHeight}px`,
      borderRadius: `${effectiveHeight / 2}px`,
    });
    this.track.style.background = this.maximumTrackTintColor;
    if (this.thumb.morph > 0) this.glass.requestDraw();
  }

  updateTrackFill() {
    const centerX = this.thumb.centerX;
    const trackLeft = Number.parseFloat(this.track.style.left) || 0;
    const trackWidth = Number.parseFloat(this.track.style.width) || 0;

    // The fill fades in as the thumb leaves either end, so a thumb sitting at
    // minimum shows no coloured sliver behind it.
    const kMin = clamp((centerX - this.minThumbCenterX) / FILL_RAMP, 0, 1);
    const kMax = clamp((this.maxThumbCenterX - centerX) / FILL_RAMP, 0, 1);
    const fillWidth = Math.max(0, centerX - trackLeft) * kMin * kMax + trackWidth * (1 - kMax);

    Object.assign(this.fill.style, {
      left: `${trackLeft}px`,
      top: this.track.style.top,
      width: `${fillWidth}px`,
      height: this.track.style.height,
      borderRadius: this.track.style.borderRadius,
      background: this.minimumTrackTintColor,
    });
    if (this.thumb.morph > 0) this.glass.requestDraw();
  }

  updateThumbPosition(animated) {
    if (this.positionAnimation) {
      this.positionAnimation();
      this.positionAnimation = null;
    }

    const target = this.targetThumbCenterX;
    if (!animated || prefersReducedMotion()) {
      this.thumb.setCenter(target);
      return;
    }

    const from = this.thumb.centerX;
    this.positionAnimation = animateSpring({
      duration: 0.5,
      damping: 1,
      onFrame: progress => {
        this.thumb.setCenter(from + (target - from) * progress);
        this.updateTrackFill();
      },
      onDone: () => {
        this.positionAnimation = null;
        this.updateTrackFill();
      },
    });
  }

  // Rubber-band clamping: past an end the thumb keeps moving, but only with the
  // square root of the overshoot.
  clampWithRubberBand(centerX) {
    if (centerX < this.minThumbCenterX) {
      return this.minThumbCenterX - Math.sqrt(this.minThumbCenterX - centerX);
    }
    if (centerX > this.maxThumbCenterX) {
      return this.maxThumbCenterX + Math.sqrt(centerX - this.maxThumbCenterX);
    }
    return centerX;
  }

  pointerX(event) {
    return event.clientX - this.element.getBoundingClientRect().left;
  }

  haptic(strength) {
    if (this.onHaptic) {
      this.onHaptic(strength);
    }
  }

  bindEvents() {
    this.element.addEventListener('pointerdown', event => this.onPointerDown(event));
    this.element.addEventListener('pointermove', event => this.onPointerMove(event));
    this.element.addEventListener('pointerup', event => this.onPointerUp(event));
    this.element.addEventListener('pointercancel', () => this.onPointerCancel());
    this.element.addEventListener('lostpointercapture', () => {
      if (this.pointerId != null) this.onPointerCancel();
    });
    this.element.addEventListener('keydown', event => this.onKeyDown(event));
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.isDragging) {
        this.layout();
      }
    });
    this.resizeObserver.observe(this.element);
  }

  onPointerDown(event) {
    if (!this.isEnabled || this.pointerId != null || event.isPrimary === false ||
      (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    event.preventDefault();
    this.element.setPointerCapture(event.pointerId);
    this.pointerId = event.pointerId;

    if (this.positionAnimation) {
      this.positionAnimation();
      this.positionAnimation = null;
    }
    if (this.trackAnimation) {
      this.trackAnimation();
      this.trackAnimation = null;
    }
    this.isDragging = false;
    this.didTriggerMinHaptic = false;
    this.didTriggerMaxHaptic = false;
    this.rubberBandOffset = 0;
    this.touchBeganTime = performance.now();
    this.dragStartLocation = this.pointerX(event);
    this.dragStartThumbCenterX = this.thumb.centerX;

    if (this.tapTimer) {
      clearTimeout(this.tapTimer);
      this.tapTimer = 0;
    }
    this.thumb.expand();
    this.isThumbExpanded = true;
    this.haptic('prepare');
  }

  onPointerMove(event) {
    if (event.pointerId !== this.pointerId) {
      return;
    }

    const duration = performance.now() - this.touchBeganTime;
    const translation = this.pointerX(event) - this.dragStartLocation;
    if (duration >= TAP_THRESHOLD || Math.abs(translation) > 3) this.isDragging = true;
    const newCenterX = this.dragStartThumbCenterX + translation;
    if (newCenterX < this.minThumbCenterX) {
      this.rubberBandOffset = this.clampWithRubberBand(newCenterX) - this.minThumbCenterX;
    } else if (newCenterX > this.maxThumbCenterX) {
      this.rubberBandOffset = this.clampWithRubberBand(newCenterX) - this.maxThumbCenterX;
    } else {
      this.rubberBandOffset = 0;
    }

    this.thumb.setCenter(this.clampWithRubberBand(newCenterX));
    this.updateTrackLayout();
    this.updateTrackFill();

    const effectiveCenterX = clamp(newCenterX, this.minThumbCenterX, this.maxThumbCenterX);
    const normalized = this.thumbCenterRange > 0
      ? (effectiveCenterX - this.minThumbCenterX) / this.thumbCenterRange
      : 0;
    this.isUpdatingValue = true;
    this.value = this.minimumValue + normalized * (this.maximumValue - this.minimumValue);
    this.isUpdatingValue = false;

    this.checkForEdgeHaptics(newCenterX);
  }

  onPointerUp(event) {
    if (event.pointerId !== this.pointerId) {
      return;
    }
    this.pointerId = null;

    const duration = performance.now() - this.touchBeganTime;
    if (duration < TAP_THRESHOLD && !this.isDragging) {
      // A tap moves the thumb to where it landed rather than tracking a drag.
      const tapX = this.pointerX(event);
      const clampedX = clamp(tapX, this.minThumbCenterX, this.maxThumbCenterX);
      const normalized = this.thumbCenterRange > 0
        ? (clampedX - this.minThumbCenterX) / this.thumbCenterRange
        : 0;

      this.isUpdatingValue = true;
      this.value = this.minimumValue + normalized * (this.maximumValue - this.minimumValue);
      this.isUpdatingValue = false;

      this.updateThumbPosition(true);
      this.updateTrackFill();

      if (Math.abs(this.currentValue - this.minimumValue) < 0.01) {
        this.haptic('light');
      } else if (Math.abs(this.currentValue - this.maximumValue) < 0.01) {
        this.haptic('medium');
      }

      this.element.dispatchEvent(new Event('change', { bubbles: true }));
      this.tapTimer = setTimeout(() => {
        this.tapTimer = 0;
        if (!this.isDragging) {
          this.isThumbExpanded = false;
          this.thumb.contract();
        }
      }, TAP_CONTRACT_DELAY);
      return;
    }

    this.finishDrag();
  }

  onPointerCancel() {
    this.pointerId = null;
    if (this.isDragging) {
      this.finishDrag();
    } else if (this.isThumbExpanded) {
      this.isThumbExpanded = false;
      this.thumb.contract();
    }
  }

  finishDrag() {
    this.isDragging = false;
    const releaseOffset = this.rubberBandOffset;
    this.rubberBandOffset = 0;
    this.isThumbExpanded = false;

    // The track springs back to its resting geometry; the thumb contracts and
    // slides to its final position on the same frame.
    if (releaseOffset && !prefersReducedMotion()) {
      this.trackAnimation = animateSpring({
        duration: 0.3,
        damping: 0.8,
        onFrame: progress => {
          this.rubberBandOffset = releaseOffset * (1 - progress);
          this.updateTrackLayout();
          this.updateTrackFill();
        },
        onDone: () => {
          this.trackAnimation = null;
          this.rubberBandOffset = 0;
          this.updateTrackLayout();
          this.updateTrackFill();
        },
      });
    } else {
      this.updateTrackLayout();
      this.updateTrackFill();
    }

    this.thumb.contract();
    this.updateThumbPosition(true);
    this.element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  checkForEdgeHaptics(centerX) {
    if (centerX <= this.minThumbCenterX + EDGE_THRESHOLD && !this.didTriggerMinHaptic) {
      this.didTriggerMinHaptic = true;
      this.didTriggerMaxHaptic = false;
      this.haptic('light');
    } else if (centerX >= this.maxThumbCenterX - EDGE_THRESHOLD && !this.didTriggerMaxHaptic) {
      this.didTriggerMaxHaptic = true;
      this.didTriggerMinHaptic = false;
      this.haptic('medium');
    } else if (centerX > this.minThumbCenterX + EDGE_THRESHOLD * 2 &&
      centerX < this.maxThumbCenterX - EDGE_THRESHOLD * 2) {
      this.didTriggerMinHaptic = false;
      this.didTriggerMaxHaptic = false;
    }
  }

  // Keyboard steps match the UIKit accessibility increment and decrement.
  onKeyDown(event) {
    if (!this.isEnabled) {
      return;
    }
    const step = (this.maximumValue - this.minimumValue) / 10;
    let next = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      next = this.currentValue - step;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      next = this.currentValue + step;
    } else if (event.key === 'Home') {
      next = this.minimumValue;
    } else if (event.key === 'End') {
      next = this.maximumValue;
    }
    if (next === null) {
      return;
    }
    event.preventDefault();
    this.setValue(next, true);
    this.element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  appendTo(parent) {
    parent.append(this.element);
    this.layout();
    return this;
  }

  destroy() {
    this.pointerId = null;
    if (this.tapTimer) {
      clearTimeout(this.tapTimer);
      this.tapTimer = 0;
    }
    if (this.positionAnimation) {
      this.positionAnimation();
      this.positionAnimation = null;
    }
    this.resizeObserver.disconnect();
    this.trackAnimation?.();
    this.thumb.cancelAnimation();
    this.glass.dispose();
    this.element.remove();
  }
}
