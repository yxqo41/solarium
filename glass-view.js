/* solarium — a JavaScript port of LiquidGlassKit
 * (https://github.com/DnV1eX/LiquidGlassKit, Swift + Metal).
 *
 * `LiquidGlassView` is the port of the MTKView of the same name: it owns the
 * canvas, turns its geometry into shader uniforms, captures the backdrop and
 * asks the renderer to draw.
 *
 * The one thing that cannot be ported literally is the capture. The original
 * reads the layers underneath it through CABackdropLayer (or by rendering the
 * root view). A browser has no way to read composited page content back, so
 * the caller names the drawable that sits behind the glass — a canvas, video
 * or image — and the view maps its own on-screen rect into that drawable.
 */

import { LiquidGlass } from './liquid-glass.js';
import { LiquidGlassRenderer } from './renderer.js';

const THEME_QUERY = window.matchMedia('(prefers-color-scheme: dark)');

// Rounding a device-pixel size keeps the canvas backing store from drifting
// half a pixel away from the CSS box, which shows up as a one-pixel transparent
// seam along the glass edge.
function devicePixels(cssPixels) {
  return Math.max(1, Math.round(cssPixels * (window.devicePixelRatio || 1)));
}

export class LiquidGlassView {
  constructor(liquidGlass = LiquidGlass.regular(), options = {}) {
    this.liquidGlass = liquidGlass;
    this.frames = [];
    this.touchPoint = null;
    this.interactive = options.interactive ?? liquidGlass.interactive ?? false;
    this.autoCapture = options.autoCapture !== false;
    this.shapeMergeSmoothness = options.shapeMergeSmoothness
      ?? liquidGlass.uniforms.shapeMergeSmoothness
      // The Swift view overwrites whatever the material says with 0.2.
      ?? 0.2;

    this.source = options.source ?? null;
    this.sourceBounds = options.sourceBounds ?? null;
    // Controls add their own track layers here. The page's drawable cannot
    // contain DOM-painted tracks, and the thumb must not capture itself.
    this.backgroundLayers = options.backgroundLayers ?? [];
    this.captureUntil = 0;
    this.rasterSize = null;
    this.captureRasterSize = null;
    this.disposed = false;

    this.element = document.createElement('div');
    // The outer box must not clip. The thumb and lens materials paint a drop
    // shadow outside their pill, and an `overflow: hidden` ancestor cuts it off
    // along the edges it overhangs. Only the surface itself is clipped.
    Object.assign(this.element.style, {
      position: 'relative',
      overflow: 'visible',
      pointerEvents: 'none',
    });

    this.surface = document.createElement('div');
    Object.assign(this.surface.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
    });
    this.element.append(this.surface);

    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      display: 'block',
      width: '100%',
      height: '100%',
    });
    this.surface.append(this.canvas);

    this.captureCanvas = document.createElement('canvas');
    this.captureContext = this.captureCanvas.getContext('2d');

    this.renderer = null;
    if (LiquidGlassRenderer.isSupported()) {
      this.renderer = new LiquidGlassRenderer(this.canvas);
    } else {
      // No WebGL2: the shell stays in the layout so callers do not have to
      // special-case it, and nothing is painted inside it.
      this.element.dataset.solariumFallback = 'true';
    }

    this.shadow = null;
    if (liquidGlass.shadowOverlay) {
      this.createShadowOverlay();
    }

    this.cornerRadius = options.cornerRadius ?? 0;
    if (this.cornerRadius) {
      this.setCornerRadius(this.cornerRadius);
    }

    this._interactivePress = false;
    this._interactiveStart = null;
    if (this.interactive) {
      this._bindInteractive();
    }

    this.frameHandle = 0;
  }

  // InteractiveHighlight.kt & LiquidButton.kt: in-place elastic tanh press,
  // pinch scale, and glow on pinch (no persistent position dragging).
  _bindInteractive() {
    const state = {
      scale: 1,
      pointers: new Map(),
      startX: 0,
      startY: 0,
      pinching: false,
      initialPinchDist: 0,
      initialScale: 1,
      wheelTimer: 0,
    };
    this._dragState = state;

    const getHost = () => this.element.parentElement || this.element;

    const setPinching = active => {
      const host = getHost();
      state.pinching = active;
      if (host) host.classList.toggle('is-pinching', active);
      this.liquidGlass.uniforms.glareEdgeSharpness = active ? 1.65 : (this._interactivePress ? 1 : 0);
      this.requestDraw();
    };

    this._onInteractiveDown = event => {
      if (event.button !== undefined && event.button !== 0) return;
      const rect = this.element.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) return;

      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this._interactivePress = true;
      this._interactiveStart = { x: event.clientX, y: event.clientY };

      if (state.pointers.size === 1) {
        state.startX = event.clientX;
        state.startY = event.clientY;
        if (event.altKey || event.shiftKey) {
          state.initialScale = state.scale;
          setPinching(true);
        } else {
          this.liquidGlass.uniforms.glareEdgeSharpness = 1;
        }
      } else if (state.pointers.size >= 2) {
        const pts = Array.from(state.pointers.values());
        state.initialPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
        state.initialScale = state.scale;
        setPinching(true);
      }

      this._setInteractivePoint(event);
      window.addEventListener('pointermove', this._onInteractiveMove, true);
      window.addEventListener('pointerup', this._onInteractiveEnd, true);
      window.addEventListener('pointercancel', this._onInteractiveEnd, true);
    };

    this._onInteractiveMove = event => {
      if (!this._interactivePress || !state.pointers.has(event.pointerId)) return;
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (state.pointers.size >= 2) {
        const pts = Array.from(state.pointers.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
        state.scale = Math.max(0.65, Math.min(2.25, state.initialScale * (dist / state.initialPinchDist)));
        setPinching(true);
      } else if (event.altKey || event.shiftKey) {
        const dy = state.startY - event.clientY;
        const dx = event.clientX - state.startX;
        state.scale = Math.max(0.65, Math.min(2.25, state.initialScale * (1 + (dx + dy) * 0.004)));
        setPinching(true);
      }

      this._setInteractivePoint(event);
    };

    this._onInteractiveEnd = event => {
      if (event && event.pointerId !== undefined) {
        state.pointers.delete(event.pointerId);
      } else {
        state.pointers.clear();
      }
      if (state.pointers.size > 0) return;
      if (!this._interactivePress) return;
      this._interactivePress = false;
      this._interactiveStart = null;
      state.scale = 1;
      setPinching(false);
      this.liquidGlass.uniforms.glareEdgeSharpness = 0;
      const host = getHost();
      if (host) {
        host.style.transition = 'transform 220ms cubic-bezier(0.22, 1.35, 0.36, 1), box-shadow 180ms ease';
        host.style.transform = '';
      }
      window.removeEventListener('pointermove', this._onInteractiveMove, true);
      window.removeEventListener('pointerup', this._onInteractiveEnd, true);
      window.removeEventListener('pointercancel', this._onInteractiveEnd, true);
      this.setTouchPoint(null);
      this.requestDraw();
    };

    this._onInteractiveWheel = event => {
      const rect = this.element.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.06 : 0.94;
      state.scale = Math.max(0.65, Math.min(2.25, state.scale * factor));
      const host = getHost();
      if (host) {
        host.style.transition = 'transform 120ms cubic-bezier(0.2, 0.9, 0.3, 1), box-shadow 150ms ease';
        host.style.transform = `scale(${state.scale.toFixed(3)})`;
      }
      this._setInteractivePoint(event);
      setPinching(true);
      clearTimeout(state.wheelTimer);
      state.wheelTimer = setTimeout(() => {
        state.scale = 1;
        setPinching(false);
        if (host) host.style.transform = '';
        this.setTouchPoint(null);
        this.requestDraw();
      }, 260);
    };

    document.addEventListener('pointerdown', this._onInteractiveDown, true);
    document.addEventListener('wheel', this._onInteractiveWheel, { passive: false, capture: true });
  }

  _setInteractivePoint(event) {
    const rect = this.element.getBoundingClientRect();
    this.setTouchPoint([event.clientX - rect.left, event.clientY - rect.top]);
    const host = this.element.parentElement;
    if (host && this._interactiveStart) {
      const width = rect.width || 1;
      const height = rect.height || 1;
      const minDim = Math.min(width, height);
      const maxDim = Math.max(width, height);
      const dx = event.clientX - this._interactiveStart.x;
      const dy = event.clientY - this._interactiveStart.y;
      const tx = minDim * Math.tanh(0.05 * dx / minDim);
      const ty = minDim * Math.tanh(0.05 * dy / minDim);
      const baseScale = (1 + 4 / height) * (this._dragState?.scale ?? 1);
      const maxDragScale = 4 / height;
      const angle = Math.atan2(dy, dx);
      const sx = baseScale + maxDragScale * Math.abs(Math.cos(angle) * dx / maxDim) * Math.min(width / height, 1);
      const sy = baseScale + maxDragScale * Math.abs(Math.sin(angle) * dy / maxDim) * Math.min(height / width, 1);
      host.style.transition = 'transform 120ms cubic-bezier(0.2, 0.9, 0.3, 1), box-shadow 150ms ease';
      host.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
    }
    this.requestDraw();
  }

  // Shadow.kt: Shadow.Default (radius = 24.dp, offset = 4.dp, color = Black(0.1f))
  createShadowOverlay() {
    const shadow = document.createElement('div');
    Object.assign(shadow.style, {
      position: 'absolute',
      inset: '0',
      borderRadius: '0',
      boxShadow: '0 4px 24px rgba(0, 0, 0, 0.12)',
      pointerEvents: 'none',
    });
    this.element.append(shadow);
    this.shadow = shadow;
  }

  // The radius lives on the clipped surface, on the shadow's own outline and in
  // the shader. The surface clips the canvas to the same pill, which hides any
  // anti-aliased fringing the distance field leaves at the very edge, while the
  // shadow keeps the matching silhouette without being clipped itself.
  setCornerRadius(radius) {
    this.cornerRadius = radius;
    this.surface.style.borderRadius = `${radius}px`;
    if (this.shadow) {
      this.shadow.style.borderRadius = `${radius}px`;
    }
  }

  // Rects are in the view's own CSS pixels with an upper-left origin, exactly
  // like the `frames` array in the Swift view. An empty list falls back to the
  // view bounds.
  setFrames(frames) {
    this.frames = frames;
    this.requestDraw();
  }

  // Allocates the fixed backing from the stored raster size without waiting
  // for a draw. The menu morph starts from a zero-size box, so the first
  // visible frame would otherwise find the canvas still at its default
  // 300x150 allocation (and the capture canvas at its own default) and report
  // two distinct sizes to the tests — as well as doing a needless
  // reallocation at that.
  prepareRaster() {
    if (!this.renderer || !this.rasterSize) return;
    this.renderer.resize(devicePixels(this.rasterSize.width),
      devicePixels(this.rasterSize.height));
    if (!this.captureRasterSize) return;
    const sizeCoefficient = this.liquidGlass.backgroundTextureSizeCoefficient;
    const scaleCoefficient = this.liquidGlass.backgroundTextureScaleCoefficient;
    this.captureCanvas.width = devicePixels(this.captureRasterSize.width * sizeCoefficient * scaleCoefficient);
    this.captureCanvas.height = devicePixels(this.captureRasterSize.height * sizeCoefficient * scaleCoefficient);
  }

  setBackgroundSource(source, sourceBounds = null) {
    this.source = source;
    this.sourceBounds = sourceBounds;
    this.requestDraw();
  }

  setTouchPoint(point) {
    this.touchPoint = point;
  }

  // Coalesces every invalidation in a frame into one draw. The Swift view is an
  // unpaused MTKView and redraws continuously; here the caller decides the
  // cadence, which keeps an idle panel from holding the GPU awake.
  requestDraw() {
    if (this.disposed || this.frameHandle || !this.renderer) {
      return;
    }
    this.frameHandle = requestAnimationFrame(() => {
      this.frameHandle = 0;
      this.draw();
      if (performance.now() < this.captureUntil) this.requestDraw();
    });
  }

  // CSS track colours keep changing after their target style is assigned.
  // Capture those intermediate colours even when the backdrop itself is still.
  requestDrawFor(milliseconds) {
    this.captureUntil = Math.max(this.captureUntil, performance.now() + milliseconds);
    this.requestDraw();
  }

  draw() {
    // A frame owner can draw immediately after updating its geometry. Cancel
    // the deferred copy so it cannot repaint the previous geometry next frame.
    if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    }
    if (this.disposed || !this.renderer || (!this.source && !this.backgroundLayers.length)) {
      // Without a named backdrop there is nothing to refract; leaving the
      // canvas untouched keeps the control transparent instead of painting a
      // black rectangle.
      return;
    }

    if (this.autoCapture) {
      this.captureBackground();
    }

    const uniforms = this.buildUniforms();
    if (!uniforms) {
      return;
    }

    const blurSigma = this.liquidGlass.backgroundTextureBlurRadius * (window.devicePixelRatio || 1);
    this.renderer.draw(uniforms, blurSigma);
  }

  buildUniforms() {
    const style = getComputedStyle(this.element);
    const width = Number.parseFloat(style.width) || this.element.clientWidth;
    const height = Number.parseFloat(style.height) || this.element.clientHeight;
    if (!width || !height) {
      return null;
    }

    const dpr = window.devicePixelRatio || 1;
    // Keep lens storage large enough for its full deformation range. Logical
    // geometry still changes every frame; its texture allocation need not.
    this.renderer.resize(devicePixels(this.rasterSize?.width ?? width),
      devicePixels(this.rasterSize?.height ?? height));

    const uniforms = this.liquidGlass.uniforms;
    return {
      ...uniforms,
      resolution: [width * dpr, height * dpr],
      contentsScale: dpr,
      touchPoint: this.touchPoint ?? uniforms.touchPoint,
      cornerRadius: this.cornerRadius,
      cornerRoundnessExponent: uniforms.cornerRoundnessExponent,
      shapeMergeSmoothness: this.shapeMergeSmoothness || 0.0001,
      materialTint: this.liquidGlass.resolveTint(THEME_QUERY.matches),
      backdropTone: this.liquidGlass.resolveBackdropTone(THEME_QUERY.matches),
      rectangles: this.frames.length
        ? this.frames
        : [{ x: 0, y: 0, width, height }],
    };
  }

  // Draws the part of the backdrop the glass covers, expanded by the material's
  // size coefficient and scaled by its capture coefficient. For the lens the
  // expansion is what magnifies the content; for the regular material the
  // downscale is the cheap frost.
  captureBackground() {
    const source = this.source;
    if (!this.captureContext) return;
    const sourceBounds = this.resolveSourceBounds();

    // The on-screen rect (transforms included) is used here, unlike the shader
    // geometry, because a squashed lens is still sampling what is really behind
    // it.
    const viewRect = this.element.getBoundingClientRect();
    if (!viewRect.width || !viewRect.height) {
      return;
    }

    const sizeCoefficient = this.liquidGlass.backgroundTextureSizeCoefficient;
    const scaleCoefficient = this.liquidGlass.backgroundTextureScaleCoefficient;
    const dpr = window.devicePixelRatio || 1;

    const captureWidth = viewRect.width * sizeCoefficient;
    const captureHeight = viewRect.height * sizeCoefficient;
    const captureLeft = viewRect.left + (viewRect.width - captureWidth) / 2;
    const captureTop = viewRect.top + (viewRect.height - captureHeight) / 2;

    const sourcePixelWidth = source && (source.naturalWidth || source.videoWidth || source.width);
    const sourcePixelHeight = source && (source.naturalHeight || source.videoHeight || source.height);
    const pixelWidth = devicePixels((this.captureRasterSize?.width ?? viewRect.width) * sizeCoefficient * scaleCoefficient);
    const pixelHeight = devicePixels((this.captureRasterSize?.height ?? viewRect.height) * sizeCoefficient * scaleCoefficient);
    if (this.captureCanvas.width !== pixelWidth) {
      this.captureCanvas.width = pixelWidth;
    }
    if (this.captureCanvas.height !== pixelHeight) {
      this.captureCanvas.height = pixelHeight;
    }

    const context = this.captureContext;
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    if (sourcePixelWidth && sourcePixelHeight && sourceBounds?.width && sourceBounds?.height) {
      const scaleX = sourcePixelWidth / sourceBounds.width;
      const scaleY = sourcePixelHeight / sourceBounds.height;
      context.drawImage(source,
        (captureLeft - sourceBounds.left) * scaleX,
        (captureTop - sourceBounds.top) * scaleY,
        captureWidth * scaleX, captureHeight * scaleY,
        0, 0, pixelWidth, pixelHeight);
    }

    // Composite the actual painted track beneath the lens before refraction.
    // Viewport coordinates include scrolling and CSS morph transforms; this
    // keeps the sampled green/fill aligned with the visible track at every size.
    context.save();
    context.setTransform(pixelWidth / captureWidth, 0, 0, pixelHeight / captureHeight,
      -captureLeft * pixelWidth / captureWidth, -captureTop * pixelHeight / captureHeight);
    for (const layer of this.backgroundLayers) {
      const style = getComputedStyle(layer);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = layer.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      context.globalAlpha = Number.parseFloat(style.opacity) || 0;
      context.fillStyle = style.backgroundColor;
      const radius = Math.min(Number.parseFloat(style.borderTopLeftRadius) || 0,
        rect.width / 2, rect.height / 2);
      context.beginPath();
      context.roundRect(rect.left, rect.top, rect.width, rect.height, radius);
      context.fill();
    }
    context.restore();

    this.renderer.setBackground(this.captureCanvas);
  }

  resolveSourceBounds() {
    if (typeof this.sourceBounds === 'function') {
      return this.sourceBounds();
    }
    if (this.sourceBounds) {
      return this.sourceBounds;
    }
    if (this.source && typeof this.source.getBoundingClientRect === 'function') {
      return this.source.getBoundingClientRect();
    }
    return null;
  }

  appendTo(parent) {
    parent.append(this.element);
    return this;
  }

  remove() {
    this.element.remove();
  }

  dispose() {
    this.disposed = true;
    if (this.interactive) {
      document.removeEventListener('pointerdown', this._onInteractiveDown, true);
      document.removeEventListener('wheel', this._onInteractiveWheel, true);
      if (this._interactivePress) this._onInteractiveEnd();
    }
    if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.element.remove();
  }
}
