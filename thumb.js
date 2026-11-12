/* solarium — a JavaScript port of LiquidGlassKit
 * (https://github.com/DnV1eX/LiquidGlassKit, Swift + Metal).
 *
 * Shared thumb behaviour for the slider and the switch. Both controls in the
 * original keep two layered thumbs — a solid contracted pill and a glass
 * expanded pill — and animate one into the other with a UIKit spring. The
 * geometry constants live in the controls; this class only moves and morphs
 * whatever pair it is handed.
 */

import { animateSpring, clamp, prefersReducedMotion } from './spring.js';

export class ThumbMorph {
  constructor({ container, controlHeight, contracted, glass, contractedSize, expandedSize }) {
    this.container = container;
    this.controlHeight = controlHeight;
    this.contracted = contracted;
    this.glass = glass;
    this.contractedSize = contractedSize;
    this.expandedSize = expandedSize;
    this.centerX = 0;
    this.expanded = false;
    this.morph = 0;
    this.animation = null;

    Object.assign(this.contracted.style, {
      position: 'absolute',
      width: `${contractedSize.width}px`,
      height: `${contractedSize.height}px`,
      borderRadius: `${contractedSize.height / 2}px`,
      transformOrigin: 'center',
      pointerEvents: 'none',
    });

    Object.assign(this.glass.element.style, {
      position: 'absolute',
      width: `${expandedSize.width}px`,
      height: `${expandedSize.height}px`,
      transformOrigin: 'center',
      pointerEvents: 'none',
    });

    this.applyMorph(0);
  }

  get scaleToExpanded() {
    return {
      x: this.expandedSize.width / this.contractedSize.width,
      y: this.expandedSize.height / this.contractedSize.height,
    };
  }

  setCenter(centerX) {
    this.centerX = centerX;
    this.layout();
  }

  // Both thumbs are centred on the same point, so the contracted pill sits in
  // the track while the taller glass pill overflows it. That overflow is
  // deliberate: `clipsToBounds` is false on the UIKit control too.
  layout() {
    const contractedTop = (this.controlHeight - this.contractedSize.height) / 2;
    const expandedTop = (this.controlHeight - this.expandedSize.height) / 2;

    this.contracted.style.left = `${this.centerX - this.contractedSize.width / 2}px`;
    this.contracted.style.top = `${contractedTop}px`;
    this.glass.element.style.left = `${this.centerX - this.expandedSize.width / 2}px`;
    this.glass.element.style.top = `${expandedTop}px`;

    if (this.expanded || this.morph > 0) {
      // The backdrop under the thumb moved with it, so the capture is stale.
      this.glass.requestDraw();
    }
  }

  cancelAnimation() {
    if (this.animation) {
      this.animation();
      this.animation = null;
    }
  }

  // One scalar drives the whole morph: 0 is the contracted pill, 1 is the
  // expanded glass. Keeping the current value in the state — rather than
  // recomputing it from where the animation started — is what lets a new
  // gesture pick the motion up wherever it is, the way UIKit's
  // `beginFromCurrentState` does. A spring that overshoots past 1 is fine for
  // the transforms; opacity is clamped because CSS drops an out-of-range value
  // and the crossfade would stall on those frames.
  applyMorph(morph) {
    this.morph = morph;
    const scale = this.scaleToExpanded;

    this.contracted.style.visibility = morph >= 1 ? 'hidden' : 'visible';
    this.contracted.style.opacity = String(clamp(1 - morph, 0, 1));
    this.contracted.style.transform =
      `scale(${1 + (scale.x - 1) * morph}, ${1 + (scale.y - 1) * morph})`;

    this.glass.element.style.visibility = morph <= 0 ? 'hidden' : 'visible';
    this.glass.element.style.opacity = String(clamp(morph, 0, 1));
    this.glass.element.style.transform =
      `scale(${1 + (1 / scale.x - 1) * (1 - morph)}, ${1 + (1 / scale.y - 1) * (1 - morph)})`;
    // Capture after changing the transform, throughout expansion and contraction.
    // Otherwise a still backdrop leaves the lens frozen at its first size.
    if (morph > 0) this.glass.requestDraw();
  }

  animateMorph(target, duration, damping, animated) {
    this.cancelAnimation();
    if (target > 0) {
      this.glass.requestDraw();
    }

    const from = this.morph;
    if (!animated || prefersReducedMotion()) {
      this.applyMorph(target);
      return;
    }

    this.animation = animateSpring({
      duration,
      damping,
      onFrame: progress => this.applyMorph(from + (target - from) * progress),
      onDone: () => {
        this.animation = null;
        // The last sampled frame is short by a fraction of a percent; the
        // resting state is written exactly so nothing is left half-scaled.
        this.applyMorph(target);
      },
    });
  }

  // Durations and damping ratios are the ones the Swift controls hand to
  // UIView.animate: a quick, bouncy expansion and a slower contraction.
  expand(animated = true) {
    this.expanded = true;
    this.animateMorph(1, 0.4, 0.6, animated);
  }

  contract(animated = true) {
    this.expanded = false;
    this.animateMorph(0, 0.6, 0.7, animated);
  }
}
