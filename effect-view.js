/* solarium — a JavaScript port of LiquidGlassKit
 * (https://github.com/DnV1eX/LiquidGlassKit, Swift + Metal).
 *
 * Port of LiquidGlassEffectView.swift: a host view with a glass surface behind
 * its content, plus the two effect descriptors the original exposes.
 *
 * There is no `isNative` switch here. The Swift factory defers to iOS 26's
 * UIGlassEffect when it is available and falls back to the recreated renderer
 * otherwise; in a browser the recreated renderer is always the only
 * implementation, so the flag would have no branch to take.
 */

import { LiquidGlass } from './liquid-glass.js';
import { LiquidGlassView } from './glass-view.js';

export class LiquidGlassEffect {
  constructor(style = 'regular') {
    this.style = style;
    this.isInteractive = false;
    this.tintColor = null;
    this.shadowOverlay = false;
  }

  liquidGlass() {
    // UIGlassEffect.Style: 'none' means no glass surface at all, and 'clear'
    // is the thinner variant of the regular material.
    if (this.style === 'none') return null;
    const material = this.style === 'clear' ? LiquidGlass.clear() : LiquidGlass.regular();
    if (this.tintColor) {
      material.tintColor = this.tintColor;
    }
    material.shadowOverlay = this.shadowOverlay;
    material.interactive = this.isInteractive;
    return material;
  }
}

// Renders several glass elements as one combined surface. The upstream
// container is a passthrough while it still renders each nested effect
// individually, but the shader's multi-rectangle smooth union is already the
// mechanism for the combined look, so the rects can be fed straight in.
export class LiquidGlassContainerEffect {
  constructor({ spacing = 10 } = {}) {
    // The distance at which two elements start to merge, in CSS pixels.
    this.spacing = spacing;
  }

  // The shader measures distances in view heights, so the spacing has to be
  // normalised the same way before it can be used as a blend width.
  smoothnessFor(height) {
    return height ? this.spacing / height : 0.0001;
  }
}

export class LiquidGlassEffectView {
  constructor(effect) {
    this.effect = effect;
    this.element = document.createElement('div');
    Object.assign(this.element.style, {
      position: 'relative',
      isolation: 'isolate',
    });

    this.contentView = document.createElement('div');
    Object.assign(this.contentView.style, {
      position: 'relative',
      zIndex: '1',
    });
    this.element.append(this.contentView);

    this.liquidGlassView = null;
    if (effect instanceof LiquidGlassEffect) {
      const material = effect.liquidGlass();
      if (material) {
        this.liquidGlassView = new LiquidGlassView(material, {
          cornerRadius: 0,
          interactive: effect.isInteractive,
        });
        Object.assign(this.liquidGlassView.element.style, {
          position: 'absolute',
          inset: '0',
          zIndex: '0',
        });
        this.element.insertBefore(this.liquidGlassView.element, this.contentView);
      }
    }
    // A container effect owns no surface of its own; see the class comment.
  }

  // Called when the host is laid out, mirroring the Swift `layoutSubviews`
  // hand-off of the corner radius to the glass view.
  layout() {
    if (!this.liquidGlassView) {
      return;
    }
    const radius = Number.parseFloat(getComputedStyle(this.element).borderTopLeftRadius) || 0;
    this.liquidGlassView.setCornerRadius(radius);
    if (this.effect instanceof LiquidGlassContainerEffect) {
      this.liquidGlassView.shapeMergeSmoothness = this.effect.smoothnessFor(this.element.clientHeight);
    }
    this.liquidGlassView.requestDraw();
  }

  setBackgroundSource(source, bounds = null) {
    if (this.liquidGlassView) {
      this.liquidGlassView.setBackgroundSource(source, bounds);
    }
  }

  // Only used by the container effect: the rects of the elements that should
  // melt together, in this view's coordinates.
  setFrames(frames) {
    if (this.liquidGlassView) {
      this.liquidGlassView.setFrames(frames);
    }
  }

  appendTo(parent) {
    parent.append(this.element);
    return this;
  }

  dispose() {
    if (this.liquidGlassView) {
      this.liquidGlassView.dispose();
      this.liquidGlassView = null;
    }
    this.element.remove();
  }
}

// The Swift file exposes `VisualEffectView(effect:)` as the entry point, because
// UIKit callers cannot tell the two implementations apart. The same shape is
// kept here so the call sites read alike.
export function VisualEffectView(effect) {
  return new LiquidGlassEffectView(effect);
}
