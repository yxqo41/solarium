/* solarium — a JavaScript port of LiquidGlassKit & AndroidLiquidGlass
 * (https://github.com/Kyant0/AndroidLiquidGlass, Compose Multiplatform / AGSL).
 *
 * Port of LiquidBottomTabs.kt and LiquidBottomTab.kt: a liquid glass bottom tab bar
 * featuring a draggable magnifying lens slider thumb, dynamic velocity-based squash & stretch,
 * pressed-expansion scaling, interactive touch highlight, and spring snapping physics.
 */

import { LiquidGlassView } from './glass-view.js';
import { LiquidGlass } from './liquid-glass.js';
import { animateSpring, clamp, prefersReducedMotion } from './spring.js';

const BAR_HEIGHT = 64;
const INNER_HEIGHT = 56;
const PADDING = 4;
const CONTAINER_RADIUS = 32;
const THUMB_RADIUS = 28;
const PRESSED_SCALE = 78 / 56; // ~1.3928x expansion on touch/drag

const DEFAULT_TABS = [
  {
    id: 'flight',
    label: 'Tab 1',
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
    </svg>`
  },
  {
    id: 'explore',
    label: 'Tab 2',
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
    </svg>`
  },
  {
    id: 'favorites',
    label: 'Tab 3',
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
    </svg>`
  }
];

export class TabBar extends HTMLElement {
  constructor(options = {}) {
    super();
    this.element = this;
    this._initialized = false;
    this._options = options;

    this.selectedIndex = options.selectedIndex ?? 0;
    this.tabs = options.tabs ?? DEFAULT_TABS;
    this.accentColor = options.accentColor ?? '#0091FF';
    this.onTabSelected = options.onTabSelected ?? null;
    this.source = options.source ?? null;
    this.sourceBounds = options.sourceBounds ?? null;

    // Physics & gesture state
    this.currentValue = this.selectedIndex;
    this.targetValue = this.selectedIndex;
    this.pressProgress = 0;
    this.velocity = 0;
    this.panelOffset = 0;
    this.isDragging = false;
    this.pointerId = null;
    this.touchStartTime = 0;
    this.startX = 0;
    this.lastPointerX = 0;
    this.lastPointerTime = 0;
    this.interactiveHighlightPoint = { x: 0, y: 0 };

    this._springAnimation = null;
    this._pressAnimation = null;
    this._panelAnimation = null;
    this._rafHandle = 0;
    this.disposed = false;
  }

  connectedCallback() {
    if (!this._initialized) {
      this._init();
    }
  }

  disconnectedCallback() {
    this.destroy();
  }

  _init() {
    this._initialized = true;

    // If configured via attributes/children in HTML
    if (this.hasAttribute('tabs')) {
      try {
        this.tabs = JSON.parse(this.getAttribute('tabs'));
      } catch (e) {
        console.warn('Failed to parse tabs attribute:', e);
      }
    }
    if (this.hasAttribute('selected-index')) {
      const idx = parseInt(this.getAttribute('selected-index'), 10);
      if (!isNaN(idx)) {
        this.selectedIndex = idx;
        this.currentValue = idx;
        this.targetValue = idx;
      }
    }

    Object.assign(this.style, {
      position: 'relative',
      display: 'inline-block',
      width: '100%',
      maxWidth: '380px',
      height: `${BAR_HEIGHT}px`,
      userSelect: 'none',
      webkitUserSelect: 'none',
      touchAction: 'none',
      outline: 'none',
      boxSizing: 'border-box',
    });
    this.tabIndex = 0;
    this.setAttribute('role', 'tablist');

    // Inner wrapper for container scaling & overscroll translation
    this.containerWrapper = document.createElement('div');
    Object.assign(this.containerWrapper.style, {
      position: 'absolute',
      inset: '0',
      borderRadius: `${CONTAINER_RADIUS}px`,
      overflow: 'visible',
      transformOrigin: 'center center',
      boxShadow: '0 4px 24px rgba(0, 0, 0, 0.14)',
    });
    this.append(this.containerWrapper);

    // Surface tint wash behind container glass (clean, clear transparency)
    this.containerSurface = document.createElement('div');
    Object.assign(this.containerSurface.style, {
      position: 'absolute',
      inset: '0',
      borderRadius: `${CONTAINER_RADIUS}px`,
      background: 'rgba(255, 255, 255, 0.06)',
      pointerEvents: 'none',
      transition: 'background 200ms ease',
    });
    this.containerWrapper.append(this.containerSurface);

    // Container LiquidGlassView
    this.containerGlass = new LiquidGlassView(LiquidGlass.regular(), {
      source: this.source,
      sourceBounds: this.sourceBounds,
      cornerRadius: CONTAINER_RADIUS,
    });
    Object.assign(this.containerGlass.element.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
    });
    this.containerWrapper.append(this.containerGlass.element);

    // Draggable Slider Lens Thumb (z-index 1: slides beneath the tabs)
    this.thumb = document.createElement('div');
    Object.assign(this.thumb.style, {
      position: 'absolute',
      top: `${PADDING}px`,
      left: `${PADDING}px`,
      height: `${INNER_HEIGHT}px`,
      borderRadius: `${THUMB_RADIUS}px`,
      overflow: 'visible',
      pointerEvents: 'none',
      zIndex: '1',
      transformOrigin: 'center center',
      willChange: 'transform, width',
    });
    this.containerWrapper.append(this.thumb);

    // Tab items layer (z-index 2: floats above the glass surfaces so icons & text are never hidden or blurred)
    this.tabsTrack = document.createElement('div');
    Object.assign(this.tabsTrack.style, {
      position: 'absolute',
      inset: `${PADDING}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      pointerEvents: 'none',
      zIndex: '2',
    });
    this.containerWrapper.append(this.tabsTrack);

    // Bright, clear liquid glass thumb pill (not dark, crisp specular highlights)
    this.restingPill = document.createElement('div');
    Object.assign(this.restingPill.style, {
      position: 'absolute',
      inset: '0',
      borderRadius: `${THUMB_RADIUS}px`,
      background: 'rgba(255, 255, 255, 0.22)',
      boxShadow: '0 2px 12px rgba(0, 0, 0, 0.08), inset 0 1px 1.5px rgba(255, 255, 255, 0.65), inset 0 0 0 0.5px rgba(255, 255, 255, 0.35)',
      pointerEvents: 'none',
    });
    this.thumb.append(this.restingPill);

    // Lens LiquidGlassView for the thumb (always active liquid glass)
    this.thumbGlass = new LiquidGlassView(LiquidGlass.lens(), {
      source: this.source,
      sourceBounds: this.sourceBounds,
      cornerRadius: THUMB_RADIUS,
    });
    Object.assign(this.thumbGlass.element.style, {
      position: 'absolute',
      inset: '0',
      opacity: '1',
      pointerEvents: 'none',
    });
    this.setupThumbBackdropCapture();
    this.thumb.append(this.thumbGlass.element);

    // Interactive Highlight Glow inside thumb
    this.thumbHighlight = document.createElement('div');
    Object.assign(this.thumbHighlight.style, {
      position: 'absolute',
      inset: '0',
      borderRadius: `${THUMB_RADIUS}px`,
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 180ms ease',
      background: 'radial-gradient(circle 60px at 50% 50%, rgba(255, 255, 255, 0.35), transparent 70%)',
      mixBlendMode: 'screen',
    });
    this.thumb.append(this.thumbHighlight);

    // Render tab buttons
    this.tabButtons = [];
    this.renderTabs();

    this.bindEvents();
    this.layout();
    this.updateThumbGeometry();
    this.updateActiveTabStyles();

    this.resizeObserver = new ResizeObserver(() => {
      this.layout();
      this.updateThumbGeometry();
    });
    this.resizeObserver.observe(this);
  }

  renderTabs() {
    this.tabsTrack.innerHTML = '';
    this.tabButtons = [];

    this.tabs.forEach((tab, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', index === this.selectedIndex ? 'true' : 'false');
      btn.id = `tab-${tab.id || index}`;

      Object.assign(btn.style, {
        position: 'relative',
        flex: '1',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2px',
        padding: '0',
        margin: '0',
        background: 'transparent',
        border: 'none',
        outline: 'none',
        cursor: 'pointer',
        pointerEvents: 'auto',
        color: index === this.selectedIndex ? this.accentColor : 'rgba(255, 255, 255, 0.65)',
        fontFamily: 'inherit',
        fontSize: '12px',
        fontWeight: '500',
        transition: 'color 180ms ease, transform 180ms ease',
        transformOrigin: 'center center',
      });

      const iconWrap = document.createElement('div');
      Object.assign(iconWrap.style, {
        width: '24px',
        height: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      });
      iconWrap.innerHTML = tab.icon || '';
      btn.append(iconWrap);

      const labelSpan = document.createElement('span');
      labelSpan.textContent = tab.label || `Tab ${index + 1}`;
      labelSpan.style.pointerEvents = 'none';
      btn.append(labelSpan);

      this.tabsTrack.append(btn);
      this.tabButtons.push(btn);
    });
  }

  setupThumbBackdropCapture() {
    // Keep backdrop capture purely for optical refraction without duplicating or blurring DOM text
    const originalCapture = this.thumbGlass.captureBackground.bind(this.thumbGlass);
    this.thumbGlass.captureBackground = () => {
      originalCapture();
      if (!this.thumbGlass.captureContext || !this.thumbGlass.renderer) return;
      this.thumbGlass.renderer.setBackground(this.thumbGlass.captureCanvas);
    };
  }

  setBackgroundSource(source, bounds = null) {
    this.source = source;
    this.sourceBounds = bounds;
    this.containerGlass?.setBackgroundSource(source, bounds);
    this.thumbGlass?.setBackgroundSource(source, bounds);
    this.requestDraw();
  }

  layout() {
    const rect = this.getBoundingClientRect();
    const availableWidth = rect.width - PADDING * 2;
    const tabCount = Math.max(1, this.tabs.length);
    this.tabWidth = Math.max(1, availableWidth / tabCount);
    this.thumb.style.width = `${this.tabWidth}px`;
    this.containerGlass?.requestDraw();
    this.thumbGlass?.requestDraw();
  }

  bindEvents() {
    const onPointerDown = (e) => {
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      this.setPointerCapture(e.pointerId);

      this.isDragging = true;
      this.touchStartTime = performance.now();
      this.startX = e.clientX;
      this.lastPointerX = e.clientX;
      this.lastPointerTime = performance.now();
      this.velocity = 0;

      const rect = this.getBoundingClientRect();
      const localX = e.clientX - rect.left - PADDING;
      this.interactiveHighlightPoint = {
        x: clamp(localX - this.currentValue * this.tabWidth, 0, this.tabWidth),
        y: e.clientY - rect.top - PADDING,
      };

      this._springAnimation?.();
      this._springAnimation = null;

      this.animatePressProgress(1.0);
      this.startRenderLoop();
    };

    const onPointerMove = (e) => {
      if (this.pointerId !== e.pointerId) return;

      const now = performance.now();
      const dt = Math.max(1, now - this.lastPointerTime) / 1000;
      const dx = e.clientX - this.lastPointerX;
      this.lastPointerX = e.clientX;
      this.lastPointerTime = now;

      // Update velocity with exponential smoothing
      const instantVelocity = dx / dt;
      this.velocity = this.velocity * 0.4 + instantVelocity * 0.6;

      const tabCount = this.tabs.length;
      const rect = this.getBoundingClientRect();
      const availableWidth = rect.width - PADDING * 2;
      this.tabWidth = availableWidth / tabCount;

      // Damped drag value
      const targetVal = this.currentValue + dx / this.tabWidth;
      const minVal = 0;
      const maxVal = tabCount - 1;

      if (targetVal < minVal) {
        const over = minVal - targetVal;
        this.currentValue = minVal - Math.tanh(over * 0.5) * 0.4;
        this.panelOffset = -4 * Math.tanh(over);
      } else if (targetVal > maxVal) {
        const over = targetVal - maxVal;
        this.currentValue = maxVal + Math.tanh(over * 0.5) * 0.4;
        this.panelOffset = 4 * Math.tanh(over);
      } else {
        this.currentValue = targetVal;
        this.panelOffset = 0;
      }

      // Update interactive highlight position
      const localX = e.clientX - rect.left - PADDING;
      this.interactiveHighlightPoint = {
        x: clamp(localX - this.currentValue * this.tabWidth, 0, this.tabWidth),
        y: clamp(e.clientY - rect.top - PADDING, 0, INNER_HEIGHT),
      };

      this.updateThumbGeometry();
      this.updateActiveTabStyles();
    };

    const onPointerUp = (e) => {
      if (this.pointerId !== e.pointerId) return;
      this.releasePointerCapture(e.pointerId);
      this.pointerId = null;
      this.isDragging = false;

      const elapsed = performance.now() - this.touchStartTime;
      const totalDist = Math.abs(e.clientX - this.startX);

      let targetIndex = this.selectedIndex;
      if (elapsed < 350 && totalDist < 6) {
        // Tap: resolve tab from exact element bounding box
        this.tabButtons.forEach((btn, i) => {
          const r = btn.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right) {
            targetIndex = i;
          }
        });
      } else {
        // Drag release: snap to nearest tab with velocity momentum
        targetIndex = Math.round(this.currentValue);
        if (this.velocity > 400) targetIndex = Math.ceil(this.currentValue);
        else if (this.velocity < -400) targetIndex = Math.floor(this.currentValue);
        targetIndex = clamp(targetIndex, 0, this.tabs.length - 1);
      }

      this.animateToTab(targetIndex);
      this.animatePressProgress(0.0);
    };

    this.addEventListener('pointerdown', onPointerDown);
    this.addEventListener('pointermove', onPointerMove);
    this.addEventListener('pointerup', onPointerUp);
    this.addEventListener('pointercancel', onPointerUp);

    // Keyboard navigation
    this.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectTab(clamp(this.selectedIndex + 1, 0, this.tabs.length - 1), true);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectTab(clamp(this.selectedIndex - 1, 0, this.tabs.length - 1), true);
      } else if (e.key === 'Home') {
        e.preventDefault();
        this.selectTab(0, true);
      } else if (e.key === 'End') {
        e.preventDefault();
        this.selectTab(this.tabs.length - 1, true);
      }
    });
  }

  animatePressProgress(target) {
    this._pressAnimation?.();
    const from = this.pressProgress;
    this._pressAnimation = animateSpring({
      duration: 0.28,
      damping: 0.8,
      onFrame: (p) => {
        this.pressProgress = from + (target - from) * p;
        this.updateThumbGeometry();
      },
      onDone: () => {
        this._pressAnimation = null;
      }
    });
  }

  animatePanelOffset(target) {
    this._panelAnimation?.();
    const from = this.panelOffset;
    this._panelAnimation = animateSpring({
      duration: 0.35,
      damping: 0.75,
      onFrame: (p) => {
        this.panelOffset = from + (target - from) * p;
        this.updateThumbGeometry();
      },
      onDone: () => {
        this._panelAnimation = null;
      }
    });
  }

  animateToTab(targetIndex) {
    this._springAnimation?.();
    this._panelAnimation?.();
    const fromVal = this.currentValue;
    const fromPanel = this.panelOffset;
    const toVal = targetIndex;
    this.targetValue = targetIndex;

    this._springAnimation = animateSpring({
      duration: 0.35,
      damping: 0.85,
      onFrame: (p) => {
        this.currentValue = fromVal + (toVal - fromVal) * p;
        this.panelOffset = fromPanel * (1 - p);
        this.updateThumbGeometry();
        this.updateActiveTabStyles();
      },
      onDone: () => {
        this.currentValue = toVal;
        this.panelOffset = 0;
        this.selectedIndex = targetIndex;
        this.updateThumbGeometry();
        this.updateActiveTabStyles();
        this._springAnimation = null;
        this.stopRenderLoop();

        this.dispatchEvent(new CustomEvent('change', {
          bubbles: true,
          detail: { index: targetIndex, tab: this.tabs[targetIndex] }
        }));
        if (typeof this.onTabSelected === 'function') {
          this.onTabSelected(targetIndex);
        }
      }
    });
  }

  selectTab(index, animate = true) {
    const valid = clamp(index, 0, this.tabs.length - 1);
    if (!animate || prefersReducedMotion()) {
      this._springAnimation?.();
      this.currentValue = valid;
      this.targetValue = valid;
      this.selectedIndex = valid;
      this.updateThumbGeometry();
      this.updateActiveTabStyles();
      this.dispatchEvent(new CustomEvent('change', {
        bubbles: true,
        detail: { index: valid, tab: this.tabs[valid] }
      }));
      if (typeof this.onTabSelected === 'function') {
        this.onTabSelected(valid);
      }
    } else {
      this.startRenderLoop();
      this.animateToTab(valid);
    }
  }

  updateThumbGeometry() {
    if (!this.tabWidth) {
      const rect = this.getBoundingClientRect();
      const availableWidth = rect.width - PADDING * 2;
      this.tabWidth = Math.max(1, availableWidth / Math.max(1, this.tabs.length));
    }

    const tx = this.currentValue * this.tabWidth + this.panelOffset;

    // Container elastic scale during touch/drag (from Compose LiquidBottomTabs.kt)
    const containerScale = 1 + (16 / (this.offsetWidth || 380)) * this.pressProgress;
    this.containerWrapper.style.transform = `scale(${containerScale.toFixed(4)})`;

    // Thumb pressed scale expansion
    const baseScale = 1 + (PRESSED_SCALE - 1) * this.pressProgress;

    // Velocity-based squash and stretch (from Compose LiquidBottomTabs.kt line 270-272)
    const vFactor = clamp(this.velocity / 2500, -0.2, 0.2);
    const scaleX = (baseScale / (1 - vFactor * 0.75)).toFixed(3);
    const scaleY = (baseScale * (1 - vFactor * 0.25)).toFixed(3);

    this.thumb.style.transform = `translate3d(${tx.toFixed(2)}px, 0, 0) scale(${scaleX}, ${scaleY})`;

    // Liquid glass lens is always active
    this.thumbGlass.element.style.opacity = '1';
    this.thumbHighlight.style.opacity = `${(this.pressProgress * 0.8).toFixed(2)}`;
    this.thumbHighlight.style.background = `radial-gradient(circle 60px at ${this.interactiveHighlightPoint.x.toFixed(1)}px ${this.interactiveHighlightPoint.y.toFixed(1)}px, rgba(255, 255, 255, 0.4), transparent 70%)`;

    // Request draw on active glass
    this.thumbGlass.requestDraw();
    this.containerGlass.requestDraw();
    this.updateActiveTabStyles();
  }

  updateActiveTabStyles() {
    const currentActive = Math.round(this.currentValue);
    this.tabButtons.forEach((btn, index) => {
      const dist = Math.abs(this.currentValue - index);
      const isSelected = index === currentActive;
      btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');

      // Interpolate tab color toward accent color based on proximity
      if (dist < 0.5) {
        btn.style.color = this.accentColor;
        const tabScale = 1 + (0.08 + 0.08 * this.pressProgress) * (1 - dist * 2);
        btn.style.transform = `scale(${tabScale.toFixed(3)})`;
        btn.style.filter = `drop-shadow(0 2px 6px rgba(0, 145, 255, ${(0.45 * (1 - dist * 2)).toFixed(2)}))`;
      } else {
        btn.style.color = 'rgba(255, 255, 255, 0.65)';
        btn.style.transform = 'scale(1)';
        btn.style.filter = 'none';
      }
    });
  }

  startRenderLoop() {
    if (this._rafHandle) return;
    const tick = () => {
      if (this.isDragging || this._springAnimation || this._pressAnimation || this._panelAnimation) {
        this.containerGlass?.requestDraw();
        this.thumbGlass?.requestDraw();
        this._rafHandle = requestAnimationFrame(tick);
      } else {
        this._rafHandle = 0;
      }
    };
    this._rafHandle = requestAnimationFrame(tick);
  }

  stopRenderLoop() {
    if (this._rafHandle) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = 0;
    }
  }

  requestDraw() {
    this.containerGlass?.requestDraw();
    this.thumbGlass?.requestDraw();
  }

  destroy() {
    this.disposed = true;
    this.stopRenderLoop();
    this._springAnimation?.();
    this._pressAnimation?.();
    this._panelAnimation?.();
    this.resizeObserver?.disconnect();
    this.containerGlass?.dispose?.();
    this.thumbGlass?.dispose?.();
  }
}

// Register Web Component custom element
if (typeof customElements !== 'undefined' && !customElements.get('tab-bar')) {
  customElements.define('tab-bar', TabBar);
}

export { TabBar as LiquidGlassTabBar };
