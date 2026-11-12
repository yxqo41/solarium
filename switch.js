/* solarium — a JavaScript port of LiquidGlassKit
 * (https://github.com/DnV1eX/LiquidGlassKit, Swift + Metal).
 *
 * Port of LiquidGlassSwitch.swift. The thumb rests as a solid pill, expands
 * into glass while it is touched, and the switch flips when the thumb reaches
 * an end — or on a tap, which is what the time threshold separates.
 */

import { LiquidGlassView } from './glass-view.js';
import { LiquidGlass } from './liquid-glass.js';
import { ThumbMorph } from './thumb.js';
import { animateSpring, clamp, prefersReducedMotion } from './spring.js';

const WIDTH = 63;
const HEIGHT = 28;
const THUMB_PADDING = 2;
const CONTRACTED = { width: 37, height: 24 };
const EXPANDED = { width: 58, height: 38.333 };
const TAP_THRESHOLD = 150;
const EDGE_TOGGLE_THRESHOLD = 5;
const TAP_CONTRACT_DELAY = 200;
// The switch's thumb is drawn at a smaller magnification than the slider's,
// because the same glass sits in a smaller control.
const THUMB_MAGNIFICATION = 0.75;

export class LiquidGlassSwitch {
  constructor(options = {}) {
    this.isOn = options.isOn === true;
    this.onTintColor = options.onTintColor ?? 'rgb(52, 199, 89)';
    this.thumbTintColor = options.thumbTintColor ?? '#ffffff';
    this.onHaptic = options.onHaptic ?? null;

    this.isDragging = false;
    this.isThumbExpanded = false;
    this.pointerId = null;
    this.dragStartLocation = 0;
    this.dragStartThumbCenterX = 0;
    this.touchBeganTime = 0;
    this.didToggleDuringDrag = false;
    this.wasOnWhenDragStarted = false;
    this.tapTimer = 0;
    this.positionAnimation = null;

    this.element = document.createElement('div');
    Object.assign(this.element.style, {
      position: 'relative',
      width: `${WIDTH}px`,
      height: `${HEIGHT}px`,
      flex: 'none',
      touchAction: 'none',
      userSelect: 'none',
      cursor: 'default',
      outline: 'none',
    });
    this.element.tabIndex = 0;
    this.element.setAttribute('role', 'switch');

    this.track = document.createElement('div');
    Object.assign(this.track.style, {
      position: 'absolute',
      inset: '0',
      borderRadius: `${HEIGHT / 2}px`,
      // The 0.25s colour change is the port of the original's UIView.animate
      // around `trackView.backgroundColor`.
      transition: 'background-color 250ms ease',
      background: this.resolvedOffTintColor,
      pointerEvents: 'none',
    });

    this.contractedThumb = document.createElement('div');
    Object.assign(this.contractedThumb.style, {
      background: this.thumbTintColor,
      transition: 'background-color 200ms ease',
    });

    this.glass = new LiquidGlassView(LiquidGlass.thumb({ magnification: THUMB_MAGNIFICATION }), {
      source: options.source ?? null,
      sourceBounds: options.sourceBounds ?? null,
      backgroundLayers: [this.track],
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

    this.element.append(this.track, this.contractedThumb, this.glass.element);

    this.setEnabled(options.isEnabled !== false);
    this.bindEvents();
    this.updateTrackColor(false);
    this.updateThumbPosition(false);
    this.syncAccessibility();
  }

  get resolvedOffTintColor() {
    // .tertiaryLabel: the neutral track of an off switch.
    return 'rgba(118, 118, 128, 0.24)';
  }

  get minThumbCenterX() {
    return THUMB_PADDING + CONTRACTED.width / 2;
  }

  get maxThumbCenterX() {
    return WIDTH - this.minThumbCenterX;
  }

  get targetThumbCenterX() {
    return this.isOn ? this.maxThumbCenterX : this.minThumbCenterX;
  }

  setBackgroundSource(source, bounds = null) {
    this.glass.setBackgroundSource(source, bounds);
  }

  setEnabled(enabled) {
    this.isEnabled = enabled;
    this.element.style.opacity = enabled ? '1' : '0.5';
    this.element.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    this.element.tabIndex = enabled ? 0 : -1;
  }

  // Programmatic toggles move and recolour the switch but never expand the
  // thumb; only a real interaction does that.
  setOn(on, animated = false) {
    if (this.isOn === on) {
      return;
    }
    this.isOn = on;
    this.updateTrackColor(animated);
    this.updateThumbPosition(animated);
    this.syncAccessibility();
    this.element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  toggle() {
    this.setOn(!this.isOn, true);
  }

  syncAccessibility() {
    this.element.setAttribute('aria-checked', this.isOn ? 'true' : 'false');
  }

  updateTrackColor(animated) {
    this.track.style.transition = animated && !prefersReducedMotion() ? 'background-color 250ms ease' : 'none';
    this.track.style.background = this.isOn ? this.onTintColor : this.resolvedOffTintColor;
    if (this.thumb.morph > 0) this.glass.requestDrawFor(animated ? 250 : 0);
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
      onFrame: progress => this.thumb.setCenter(from + (target - from) * progress),
      onDone: () => {
        this.positionAnimation = null;
      },
    });
  }

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
    this.isDragging = false;
    this.wasOnWhenDragStarted = this.isOn;
    this.didToggleDuringDrag = false;
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
    const clampedCenterX = this.clampWithRubberBand(newCenterX);
    this.thumb.setCenter(clampedCenterX);
    this.checkForEdgeToggle(clampedCenterX);
  }

  onPointerUp(event) {
    if (event.pointerId !== this.pointerId) {
      return;
    }
    this.pointerId = null;

    const duration = performance.now() - this.touchBeganTime;
    if (duration < TAP_THRESHOLD && !this.isDragging) {
      this.haptic('light');
      // Keep the current centre as the animation origin. A nonanimated setOn
      // first would move it to the target before the spring even starts.
      this.setOn(!this.isOn, true);

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
    this.isDragging = false;
    this.isThumbExpanded = false;
    this.thumb.contract();
    this.updateThumbPosition(true);
  }

  onKeyDown(event) {
    if (!this.isEnabled) {
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      this.toggle();
    }
  }

  // Reaching an end while dragging flips the state immediately, so the track
  // colour and the thumb movement stay in step with the finger.
  checkForEdgeToggle(centerX) {
    const hitLeftEdge = centerX <= this.minThumbCenterX + EDGE_TOGGLE_THRESHOLD && this.isOn;
    const hitRightEdge = centerX >= this.maxThumbCenterX - EDGE_TOGGLE_THRESHOLD && !this.isOn;
    if (!hitLeftEdge && !hitRightEdge) {
      return;
    }

    const nextState = hitRightEdge;
    if (nextState === this.isOn) {
      return;
    }
    this.didToggleDuringDrag = true;
    this.haptic('light');
    this.isOn = nextState;
    this.syncAccessibility();
    this.updateTrackColor(true);
    this.element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  finishDrag() {
    // A drag that never reached an end still toggles: the gesture as a whole is
    // a switch flip, and the thumb then animates to the new resting position.
    if (!this.didToggleDuringDrag) {
      this.haptic('light');
      this.isOn = !this.isOn;
      this.syncAccessibility();
      this.updateTrackColor(true);
    }

    this.isDragging = false;
    this.isThumbExpanded = false;

    if (!this.didToggleDuringDrag && this.isOn !== this.wasOnWhenDragStarted) {
      this.element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    this.thumb.contract();
    this.updateThumbPosition(true);
  }

  appendTo(parent) {
    parent.append(this.element);
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
    this.thumb.cancelAnimation();
    this.glass.dispose();
    this.element.remove();
  }
}
