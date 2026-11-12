/* Glass menu morphing out of its trigger as a liquid blob: a clip-path
 * traced from the smooth-union field of the trigger pill and the panel,
 * each edge on its own spring (menu-blob.js). The react-native-ios-context-
 * menu item model and lifecycle events live in context-menu.js; the glass
 * styles come from @callstack/liquid-glass. Load ../menuview.css before
 * ./menuview.css.
 */

class BaseMenuView {
  static icons = {
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  };
  constructor(trigger, options = {}) {
    this.trigger = typeof trigger === 'string' ? document.querySelector(trigger) : trigger;
    this.opts = { width: 200, radius: 14, placement: 'bottom-end', trigger: 'click', edge: 12, gap: 8, slowMo: 1, items: [], ...options };
    this.state = 'closed';
    this._menu = null;
    this._shade = null;
    this._blur = null;
    this._items = [];
    this._anims = [];
    this._press = null;
    this._viaKeyboard = false;
    this._onKey = e => this._onMenuKey(e);
    this._onResize = () => { if (this.state === 'open') this.close(); };
    this._onScroll = () => { if (this.state === 'open') this.close(); };
    this._onMove = e => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.menuview__item');
      this._items.forEach(entry => entry.el.classList.toggle('is-active', entry.el === el && !entry.item.disabled));
    };
    this._onUp = e => {
      const press = this._press;
      this._endPress();
      if (!press) return;
      const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6;
      const held = performance.now() - press.t > 220;
      if (!moved && !held) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.menuview__item');
      if (el) this._select(el);
    };
    this._endPress = () => {
      this._press = null;
      window.removeEventListener('pointermove', this._onMove);
      window.removeEventListener('pointerup', this._onUp);
      window.removeEventListener('pointercancel', this._endPress);
    };
    this._onTriggerDown = e => {
      if (this.opts.trigger !== 'press' || e.button !== 0) return;
      if (this.state === 'open') { this.close(); return; }
      this.open();
    };
    this._onTriggerClick = e => {
      if (this.opts.trigger !== 'click') return;
      e.preventDefault();
      if (this.state === 'open') this.close(); else this.open();
    };
    this.trigger?.addEventListener('pointerdown', this._onTriggerDown);
    this.trigger?.addEventListener('click', this._onTriggerClick);
  }
  _build() {
    const menu = document.createElement('div');
    menu.className = 'menuview';
    menu.setAttribute('role', 'menu');
    if (this.opts.theme) menu.dataset.theme = this.opts.theme;
    this._items = [];
    for (const item of this.opts.items || []) {
      if (!item) continue;
      if (item.separator) {
        const gap = document.createElement('div');
        gap.className = 'menuview__gap';
        gap.setAttribute('role', 'separator');
        menu.append(gap);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'menuview__item';
      btn.setAttribute('role', 'menuitem');
      if (item.disabled) { btn.classList.add('is-disabled'); btn.disabled = true; }
      if (item.destructive) btn.classList.add('is-destructive');
      const label = document.createElement('span');
      label.className = 'menuview__label';
      label.textContent = item.label ?? item.title ?? '';
      btn.append(label);
      if (item.icon) {
        const icon = document.createElement('span');
        icon.className = 'menuview__icon';
        icon.setAttribute('aria-hidden', 'true');
        if (typeof item.icon === 'string') icon.innerHTML = item.icon;
        else if (item.icon instanceof Node) icon.append(item.icon.cloneNode(true));
        btn.append(icon);
      }
      btn.addEventListener('click', () => this._select(btn));
      menu.append(btn);
      this._items.push({ el: btn, item });
    }
    return menu;
  }
  open(viaKeyboard = false) {
    if (this.state === 'open') return;
    this._viaKeyboard = viaKeyboard;
    this.state = 'open';
    this.trigger?.setAttribute('aria-expanded', 'true');
    const mount = this.opts.container ?? document.body;
    this._shade = document.createElement('div');
    this._shade.className = 'menuview__shade';
    Object.assign(this._shade.style, { position: 'fixed', inset: '0', zIndex: '9998' });
    this._shade.addEventListener('pointerdown', () => this.close());
    this._menu = this._build();
    Object.assign(this._menu.style, { position: mount === document.body ? 'fixed' : 'absolute', zIndex: '9999' });
    mount.append(this._shade, this._menu);
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('scroll', this._onScroll, true);
  }
  _onMenuKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); this.close({ restoreFocus: true }); }
  }
  _teardown() {
    this.state = 'closed';
    this._endPress();
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('scroll', this._onScroll, true);
    this._shade?.remove();
    this._blur?.remove();
    this._menu?.remove();
    this._shade = null;
    this._blur = null;
    this._menu = null;
    this._items = [];
  }
  destroy() {
    this._teardown();
    this.trigger?.removeEventListener('pointerdown', this._onTriggerDown);
    this.trigger?.removeEventListener('click', this._onTriggerClick);
  }
}
import { LiquidGlass } from './liquid-glass.js';
import { LiquidGlassView } from './glass-view.js';
import { clamp, prefersReducedMotion } from './spring.js';
import { LiquidMenuMorph } from './menu-blob.js';
import { normalizeMenuConfig } from './context-menu.js';

// These are the reference GlassMenu constructor defaults.
const MENU_WIDTH = 200;
const MENU_RADIUS = 32;
// Blend width of the metaball neck, in px; matches SMOOTH in menu-blob.js.
const MERGE_WIDTH = 22;

const lerp = (a, b, t) => a + (b - a) * t;

// A damped spring stepped once per frame. Eight substeps of semi-implicit
// Euler keep the integration stable at the stiff close settings even when a
// hitching frame hands over a large dt, and the threshold snaps the last
// fraction of a pixel so the slow tail cannot hold the panel alive forever.
class LiquidSpring {
  constructor(dampingRatio, stiffness, value = 0) {
    this.dampingRatio = dampingRatio;
    this.stiffness = stiffness;
    this.threshold = 0.001;
    this.value = value;
    this.velocity = 0;
    this.target = value;
  }

  // Advances by dt seconds and returns true while moving.
  step(dt) {
    if (this.value === this.target && this.velocity === 0) return false;
    const substeps = 8;
    const h = dt / substeps;
    const damping = 2 * this.dampingRatio * Math.sqrt(this.stiffness);
    for (let i = 0; i < substeps; i++) {
      const acceleration = -this.stiffness * (this.value - this.target) - damping * this.velocity;
      this.velocity += acceleration * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.value - this.target) < this.threshold &&
      Math.abs(this.velocity) < this.threshold * 10) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    return true;
  }
}

let nextMenuId = 0;

// The menu surface is the regular preset with the menu's own frost and tint;
// 'clear' keeps the shape but drops both, the way UIGlassEffect's clear style
// thins the material out.
function menuMaterial(effect) {
  const base = effect === 'clear' ? LiquidGlass.clear() : LiquidGlass.regular();
  return new LiquidGlass({
    uniforms: {
      ...base.uniforms,
      glassThickness: effect === 'clear' ? 18 : 28,
      refractiveIndex: effect === 'clear' ? 36 : 54,
      dispersionStrength: 1.0,
      fresnelDistanceRange: 10,
      fresnelIntensity: 0.6,
      fresnelEdgeSharpness: 0, // Highlight.Default
      glareDistanceRange: 1.2,
      glareAngleConvergence: 1.0,
      glareOppositeSideBias: 1, // depthEffect = true
      glareIntensity: 0.75,
      glareEdgeSharpness: 0,
      glareDirectionOffset: Math.PI / 4,
    },
    backgroundTextureScaleCoefficient: 1,
    backgroundTextureBlurRadius: effect === 'clear' ? 0.2 : 0.5,
    backdropTone: [1.5, 0.02],
    tintColor: isDark => (isDark
      ? [0.08, 0.1, 0.16, 0.16]
      : [0.95, 0.98, 1.0, 0.18]),
  });
}

export class MenuView extends BaseMenuView {
  constructor(trigger, options = {}) {
    // The items may be described with the react-native-ios-context-menu
    // config shape (menuTitle/actionTitle/menuState/menuAttributes/...) or
    // the solarium-native one; both normalize to the same internal model.
    const menuConfig = normalizeMenuConfig(
      options.menuConfig ?? options.items ?? options.menuItems ?? []);
    super(trigger, {
      ...options,
      items: menuConfig.items,
      title: options.title ?? menuConfig.title,
      width: options.width ?? MENU_WIDTH,
      radius: options.radius ?? MENU_RADIUS,
      placement: options.placement ?? 'morph',
      trigger: options.trigger ?? 'press',
      edge: options.edge ?? 12,
      gap: options.gap ?? 0,
      // The opening callback runs once the glass and its frame owner are ready.
      onOpen: null,
    });
    this.source = options.source ?? null;
    this.sourceBounds = options.sourceBounds ?? null;
    this.backgroundLayers = options.backgroundLayers ?? [];
    this.live = options.live !== false;
    // UIGlassEffect.Style from @callstack/liquid-glass: 'regular' is the
    // default surface, 'clear' is the same material with a thinner tint and
    // frost, and 'none' leaves the CSS fallback to draw the panel.
    this.effect = options.effect ?? options.style ?? 'regular';
    // Match the reference's default menu surface without changing the other
    // Solarium materials. Capture pixels are one fifth of logical pixels.
    this.material = options.material ?? menuMaterial(this.effect);
    this.morphSource = options.morphSource ?? this.trigger;
    if (typeof this.morphSource === 'string') this.morphSource = document.querySelector(this.morphSource) ?? this.trigger;
    this._groupAnimations = new Map();
    this._onOpenGlass = options.onOpen ?? null;
    this.glass = null;
    this._content = null;
    this._progress = 0;
    this._morph = null;
    // Blob morph state: `_blobMode` is 'morph' while the clip-path is live
    // and 'settled' once the panel has landed as a plain rounded rect.
    this._blobMorph = null;
    this._blobMode = null;
    this._blobAnimating = false;
    this._blobBox = null;
    this._stageBox = null;
    this._stage = null;
    this._panel = null;
    this._face = null;
    this._rim = null;
    this._blobPaths = [];
    this._blobLast = 0;
    this._awaitingDidShow = false;
    this._closeRestoreFocus = false;
    this._frameHandle = 0;
    this._selectionTimer = 0;
    this._closePromise = null;
    this._resolveClose = null;
    this._destroyed = false;
    this._menuId = `solarium-menu-${++nextMenuId}`;
    // Lifecycle bookkeeping for the UIContextMenuInteraction event set:
    // `_didSelectItem` separates a dismissal from a cancellation, and
    // `_previewCommit` carries the commit style of a preview press so the
    // matching event fires at the right point of the exit animation.
    this._didSelectItem = false;
    this._suppressCancel = false;
    this._previewCommit = null;
    this._sourceOpacity = this.morphSource.style.opacity;
    this._sourceTransform = this.morphSource.style.transform;
    this._sourceFilter = this.morphSource.style.filter;
    this._sourceVisibility = this.morphSource.style.visibility;
    this._onContextMenu = event => { event.preventDefault(); this.open(); };
    this.trigger.addEventListener('contextmenu', this._onContextMenu);
    // The base press handler treats a second press on the trigger as a plain
    // close. UIKit's interaction reads that press as a commit on the lifted
    // preview, so the listener is swapped for one that reports it.
    this.trigger.removeEventListener('pointerdown', this._onTriggerDown);
    this._onTriggerPress = event => {
      if (this.opts.trigger !== 'press' || event.button !== 0) return;
      if (this.state === 'open') { this._commitPreview(); return; }
      this.open();
      this._press = { t: performance.now(), x: event.clientX, y: event.clientY };
      window.addEventListener('pointermove', this._onMove);
      window.addEventListener('pointerup', this._onUp);
      window.addEventListener('pointercancel', this._endPress);
    };
    this.trigger.addEventListener('pointerdown', this._onTriggerPress);
    this._sourceBaseOpacity = Number(getComputedStyle(this.morphSource).opacity);
    this._previousControls = this.trigger.getAttribute('aria-controls');
    this.trigger.setAttribute('aria-controls', this._menuId);
    // Compile during idle time so the first press does not pay for a new shader
    // context. Menus that open immediately still prepare synchronously below.
    const prepare = () => {
      this._warmupHandle = null;
      if (!this._destroyed) this._ensureGlass();
    };
    this._warmupHandle = window.requestIdleCallback
      ? window.requestIdleCallback(prepare, { timeout: 500 }) : setTimeout(prepare, 0);
  }

  setItems(items) {
    const config = normalizeMenuConfig(items);
    this.opts.items = config.items;
    if (config.title != null) this.opts.title = config.title;
  }

  setBackgroundSource(source, bounds = null) {
    this.source = source;
    this.sourceBounds = bounds;
    this.glass?.setBackgroundSource(source, bounds);
    this._syncFallback();
    this.requestDraw();
    return this;
  }

  // A static source can call this after it changes. Animated canvas/video
  // sources refresh while open by default; no draw loop survives dismissal.
  requestDraw() {
    if (!this._frameHandle && this._menu && !this._destroyed) {
      this._frameHandle = requestAnimationFrame(now => this._frame(now));
    }
  }

  _build() {
    const menu = super._build();
    menu.classList.add('solarium-menuview');
    menu.id = this._menuId;
    // Keep the existing label/onSelect API while accepting the reference's
    // title/onPress names, so callers can share menu descriptions.
    this._rowIndex = 0;
    this._decorateItems(this._items.slice());
    if (this.opts.title) {
      const title = document.createElement('div');
      title.className = 'solarium-menuview__title';
      title.textContent = this.opts.title;
      menu.prepend(title);
    }
    menu.style.width = `${Math.min(this.opts.width, innerWidth - this.opts.edge * 2)}px`;
    const content = document.createElement('div');
    content.className = 'solarium-menuview__content';
    content.setAttribute('role', 'presentation');
    content.append(...menu.children);
    menu.style.maxHeight = `${Math.max(44, innerHeight - this.opts.edge * 2)}px`;
    menu.setAttribute('aria-label', this.opts.label ?? this.trigger.getAttribute('aria-label') ?? 'Actions');

    // Everything visual lives on the stage, which is sized to the union of
    // the trigger pill and the panel so the blob's clip-path can grow the
    // surface out of the trigger. The menu element itself stays at its final
    // rect the whole time; only the stage's clip does the travelling.
    const wrap = document.createElement('div');
    wrap.className = 'solarium-menuview__wrap';
    this._wrap = wrap;
    const stage = document.createElement('div');
    stage.className = 'solarium-menuview__stage';
    this._stage = stage;

    const svgNS = 'http://www.w3.org/2000/svg';
    const shadow = document.createElementNS(svgNS, 'svg');
    shadow.setAttribute('class', 'solarium-menuview__shadow');
    shadow.setAttribute('aria-hidden', 'true');
    const shadowPath = document.createElementNS(svgNS, 'path');
    shadowPath.setAttribute('transform', 'translate(0 12)');
    shadowPath.style.fill = 'var(--solarium-shadow-fill)';
    shadow.append(shadowPath);
    wrap.append(shadow, stage);

    // The frosted fallback panel sits exactly where the glass canvas settles,
    // so the no-WebGL path still shows a rounded surface inside the blob.
    const panel = document.createElement('div');
    panel.className = 'solarium-menuview__panel';
    panel.setAttribute('aria-hidden', 'true');
    this._panel = panel;
    stage.append(panel);

    this._ensureGlass();
    if (this.glass) {
      Object.assign(this.glass.element.style, { position: 'absolute', zIndex: '0' });
      stage.append(this.glass.element);
    }

    // The face is a copy of the morph source riding inside the blob, so the
    // first frames show the trigger itself inflating into the menu — the
    // same trick the reference uses to keep the toolbar visible mid-morph.
    const face = this.morphSource.cloneNode(true);
    face.classList.add('solarium-menuview__face');
    face.setAttribute('aria-hidden', 'true');
    face.removeAttribute('id');
    face.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    this._face = face;
    stage.append(face);

    stage.append(content);
    this._content = content;

    // The rim traces the same path as the clip: a blurred inner glow, a
    // diagonal sheen and a gradient stroke, exactly the reference's three
    // passes. Unique gradient ids keep multiple menus on one page honest.
    const rim = document.createElementNS(svgNS, 'svg');
    rim.setAttribute('class', 'solarium-menuview__rim');
    rim.setAttribute('aria-hidden', 'true');
    const gid = this._menuId;
    rim.innerHTML =
      `<defs>` +
      `<linearGradient id="${gid}-rim" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" style="stop-color:var(--solarium-rim-hi)"/>` +
      `<stop offset=".5" style="stop-color:var(--solarium-rim-lo)"/>` +
      `<stop offset="1" style="stop-color:var(--solarium-rim-hi);stop-opacity:.6"/>` +
      `</linearGradient>` +
      `<linearGradient id="${gid}-sheen" x1="0" y1="0" x2=".5" y2="1">` +
      `<stop offset="0" stop-color="#fff" stop-opacity=".12"/>` +
      `<stop offset=".45" stop-color="#fff" stop-opacity="0"/>` +
      `</linearGradient>` +
      `<clipPath id="${gid}-clip"><path/></clipPath>` +
      `</defs>` +
      `<path class="sheen" fill="url(#${gid}-sheen)" style="mix-blend-mode:soft-light"/>` +
      `<path class="glow" clip-path="url(#${gid}-clip)" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="3" style="filter:blur(1.5px)"/>` +
      `<path class="edge" fill="none" stroke="url(#${gid}-rim)" stroke-width="1"/>`;
    this._rim = rim;
    this._blobPaths = [shadowPath, ...rim.querySelectorAll('path')];
    wrap.append(rim);

    const burst = document.createElement('div');
    burst.className = 'solarium-menuview__burst';
    burst.setAttribute('aria-hidden', 'true');
    this._burst = burst;
    wrap.append(burst);

    menu.append(wrap);
    this._bindMenuDragAndPinch(menu);
    return menu;
  }

  _bindMenuDragAndPinch(menu) {
    const pointers = new Map();
    let dragStart = null;
    let scale = 1;
    let startPinchDist = 0;
    let startPinchScale = 1;
    let wheelTimer = 0;

    const applyTransform = () => {
      menu.style.transformOrigin = '50% 50%';
      menu.style.transform = scale === 1 ? '' : `scale(${scale.toFixed(3)})`;
      if (this.glass) {
        this.glass.liquidGlass.uniforms.glareEdgeSharpness = menu.classList.contains('is-pinching') ? 1 : 0;
        this.glass.draw();
      }
      this.requestDraw();
    };

    const setPinching = active => {
      menu.classList.toggle('is-pinching', active);
      if (this.glass) {
        this.glass.liquidGlass.uniforms.glareEdgeSharpness = active ? 1 : 0;
      }
      this.requestDraw();
    };

    menu.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragStart = { x: e.clientX, y: e.clientY };
      } else if (pointers.size >= 2) {
        const pts = [...pointers.values()];
        startPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
        startPinchScale = scale;
        setPinching(true);
      }
    });

    const onMove = e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
        scale = clamp(startPinchScale * (dist / startPinchDist), 0.65, 1.85);
        setPinching(true);
        applyTransform();
      } else if (dragStart && (e.altKey || e.shiftKey)) {
        const dy = e.clientY - dragStart.y;
        scale = clamp(1 + dy * -0.004, 0.65, 1.85);
        setPinching(true);
        applyTransform();
      }
    };

    const onUp = e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) {
        setPinching(false);
      }
      if (pointers.size === 1) {
        const rem = [...pointers.values()][0];
        dragStart = { x: rem.x, y: rem.y };
      } else if (pointers.size === 0) {
        dragStart = null;
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    menu.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      const delta = -e.deltaY * 0.0015;
      scale = clamp(scale + delta, 0.65, 1.85);
      setPinching(true);
      applyTransform();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => setPinching(false), 320);
    }, { passive: false });
  }

  _decorateItems(entries, parent = null) {
    for (const entry of entries) {
      const { el, item } = entry;
      entry.parent = parent;
      // UIMenuElement.Attributes.hidden removes the element from the menu
      // entirely; it stays in `_items` so indices remain stable.
      if (item.hidden) {
        el.hidden = true;
        el.style.display = 'none';
      }
      if (item.size === 'small') el.classList.add('is-small');
      else if (item.size === 'large') el.classList.add('is-large');
      // The blob reveal staggers rows by this index, like the reference's
      // per-row transition delay.
      el.style.setProperty('--i', String(this._rowIndex++));
      const label = el.querySelector('.menuview__label');
      label.textContent = item.label ?? item.title ?? item.actionTitle ?? item.menuTitle ?? '';
      if (label.textContent.includes('\n')) el.classList.add('has-multiline');
      if (item.subtitle ?? item.actionSubtitle) {
        const subtitle = document.createElement('span');
        subtitle.className = 'solarium-menuview__subtitle';
        subtitle.textContent = item.subtitle ?? item.actionSubtitle;
        label.append(subtitle);
        el.classList.add('has-subtitle');
      }
      // UIMenuElement.State: 'on' draws the checkmark, 'mixed' the dash and
      // 'off' nothing. The legacy `checked` boolean maps onto the same slot.
      const state = item.state ?? (typeof item.checked === 'boolean' ? (item.checked ? 'on' : 'off') : undefined);
      if (state && !item.children?.length) {
        el.setAttribute('role', 'menuitemcheckbox');
        el.setAttribute('aria-checked', state === 'mixed' ? 'mixed' : String(state === 'on'));
        if (state !== 'off') {
          const check = document.createElement('span');
          check.className = 'solarium-menuview__accessory';
          check.setAttribute('aria-hidden', 'true');
          check.textContent = state === 'on' ? '✓' : '–';
          el.append(check);
        }
      }
      if (!item.children?.length) continue;
      const group = document.createElement('div');
      group.className = 'solarium-menuview__group';
      group.id = `${this._menuId}-group-${this._items.indexOf(entry)}`;
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', item.label ?? item.title ?? '');
      entry.group = group;
      entry.inline = !!item.inline;
      el.after(group);
      if (entry.inline) {
        // Inline sections are labels rather than commands and are skipped by
        // both keyboard navigation and press-drag-release selection.
        el.hidden = true;
        const heading = document.createElement('div');
        heading.className = 'solarium-menuview__title';
        heading.textContent = item.label ?? item.title ?? '';
        group.append(heading);
      } else {
        group.hidden = true;
        el.setAttribute('aria-expanded', 'false');
        el.setAttribute('aria-controls', group.id);
        const chevron = document.createElement('span');
        chevron.className = 'solarium-menuview__accessory solarium-menuview__chevron';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.textContent = '›';
        el.append(chevron);
      }
      // The base builder owns trusted icon markup and disabled/destructive
      // styling. Give it a separate owner so nested builds leave our state intact.
      const builder = { opts: { ...this.opts, items: item.children }, _items: [] };
      const children = BaseMenuView.prototype._build.call(builder);
      const childItems = builder._items;
      this._items.splice(this._items.indexOf(entry) + 1, 0, ...childItems);
      group.append(...children.children);
      this._decorateItems(childItems, entry);
    }
  }

  _focusable() {
    return this._items.filter(entry => !entry.item.disabled && !entry.el.hidden &&
      !entry.el.closest('[hidden], [inert]') && !this._hasDisabledParent(entry)).map(entry => entry.el);
  }

  _hasDisabledParent(entry) {
    for (let parent = entry.parent; parent; parent = parent.parent) {
      if (parent.item.disabled) return true;
    }
    return false;
  }

  _setGroupExpanded(entry, expanded) {
    const group = entry.group;
    const from = group.hidden ? 0 : group.getBoundingClientRect().height;
    group.hidden = false;
    group.style.height = '';
    const height = group.getBoundingClientRect().height;
    group.inert = !expanded;
    entry.el.setAttribute('aria-expanded', String(expanded));
    const spring = new LiquidSpring(expanded ? 0.85 : 1, expanded ? 400 : 500);
    spring.target = 1;
    this._groupAnimations.set(entry, { from, to: expanded ? height : 0, spring, last: 0 });
    // Measure the panel at the destination before restoring the current row
    // height. The panel and rows then approach that size on separate springs.
    group.style.height = `${expanded ? height : 0}px`;
    group.style.opacity = expanded ? '1' : '0';
    group.hidden = !expanded;
  }

  _toggleSubmenu(entry, expanded = entry.el.getAttribute('aria-expanded') !== 'true') {
    if (!entry.group || entry.inline || entry.item.disabled) return;
    for (const sibling of this._items) {
      if (sibling !== entry && sibling.parent === entry.parent && sibling.group && !sibling.inline &&
        sibling.el.getAttribute('aria-expanded') === 'true') this._setGroupExpanded(sibling, false);
    }
    this._setGroupExpanded(entry, expanded);
    const from = { ...this._morph.to };
    this._content.style.height = 'auto';
    const measured = this._measure();
    const spring = new LiquidSpring(0.85, 200);
    spring.target = 1;
    this._layoutTransition = { from, to: measured.to, spring, last: 0 };
    this._morph = measured;
    if (prefersReducedMotion()) this._layoutTransition = null;
    else this._morph.to = from;
    this._stepGroups(0);
    this._syncGroupDimming();
    this._syncBlobPanel();
    this.requestDraw();
  }

  _stepGroups(now) {
    for (const [entry, animation] of this._groupAnimations) {
      const dt = Math.min(animation.last ? (now - animation.last) / 1000 : 1 / 60, 1 / 30) /
        Math.max(this.opts.slowMo, 0.001);
      animation.last = now;
      const moving = !prefersReducedMotion() && animation.spring.step(dt);
      const progress = moving ? animation.spring.value : 1;
      if (moving) entry.group.hidden = false;
      entry.group.style.height = `${Math.max(0, lerp(animation.from, animation.to, progress))}px`;
      entry.group.style.opacity = String(clamp(animation.to ? progress : 1 - progress, 0, 1));
      if (!moving) {
        entry.group.hidden = animation.to === 0;
        entry.group.style.height = '';
        entry.group.style.opacity = '';
        this._groupAnimations.delete(entry);
      }
    }
  }

  _syncGroupDimming() {
    for (const entry of this._items) {
      const siblings = this._items.filter(other => other.parent === entry.parent);
      const active = siblings.find(other => other.el.getAttribute('aria-expanded') === 'true');
      entry.el.classList.toggle('is-dimmed', !!active && active !== entry);
    }
  }

  _ensureGlass() {
    // effect 'none' is UIGlassEffect's nil case: no surface is created and
    // the stylesheet's frosted fallback carries the panel instead.
    if (this.effect === 'none') return;
    if (!this.glass) {
      // Forced menu themes must affect the material as well as its label CSS.
      const material = Object.assign(Object.create(Object.getPrototypeOf(this.material)), this.material);
      const resolveTint = this.material.resolveTint.bind(this.material);
      const resolveTone = this.material.resolveBackdropTone.bind(this.material);
      material.resolveBackdropTone = dark => resolveTone(this.opts.theme === 'dark' ? true
        : this.opts.theme === 'light' ? false : dark);
      material.resolveTint = dark => resolveTint(this.opts.theme === 'dark' ? true
        : this.opts.theme === 'light' ? false : dark);
      this.glass = new LiquidGlassView(material, {
        source: this.source,
        sourceBounds: this.sourceBounds,
        backgroundLayers: this.backgroundLayers,
        cornerRadius: this.opts.radius,
      });
      Object.assign(this.glass.element.style, { position: 'absolute', inset: '0', zIndex: '0' });
      this.glass.element.setAttribute('aria-hidden', 'true');
    }
  }

  _syncFallback() {
    if (this._menu) this._menu.dataset.glass = this.glass?.renderer && (this.source || this.backgroundLayers.length) ? 'rendered' : 'fallback';
  }

  open(viaKeyboard = false) {
    if (this._destroyed || this.state === 'open') return;
    this.opts.onMenuWillCreate?.();
    super.open(viaKeyboard);
    if (!this._menu || this._destroyed) return;
    // Replace the base spring with the morph profile, so no other animation
    // can compete for the same transform and opacity.
    this._anims.forEach(animation => animation.cancel());
    this._anims = [];
    this._blur?.classList.add('solarium-menuview__blur');
    this._shade.classList.add('solarium-menuview__shade');
    this._morph = this._measure();
    this._progress = prefersReducedMotion() ? 1 : 0;
    this._didSelectItem = false;
    this._suppressCancel = false;
    this._previewCommit = null;
    this._syncFallback();
    // willShow precedes the animation so the reduced-motion path, which
    // finishes the transition synchronously inside _animateTo, still reports
    // willShow before didShow.
    this.opts.onMenuWillShow?.();
    this._animateTo(1);
    this.requestDraw();
    this._onOpenGlass?.();
  }

  close({ restoreFocus = false } = {}) {
    if (this.state === 'closing') return this._closePromise;
    if (this.state !== 'open') return Promise.resolve(false);
    this._layoutTransition = null;
    this.state = 'closing';
    this.trigger.setAttribute('aria-expanded', 'false');
    this._endPress();
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('scroll', this._onScroll, true);
    this._closePromise = new Promise(resolve => { this._resolveClose = resolve; });
    const promise = this._closePromise;
    this.opts.onMenuWillHide?.();
    // A dismissal without an item press is a cancellation; UIKit reports
    // willCancel alongside willEnd in that case only.
    if (!this._didSelectItem && !this._suppressCancel) this.opts.onMenuWillCancel?.();
    this._animateTo(0, restoreFocus);
    this.requestDraw();
    return promise;
  }

  // A press on the trigger while the menu is up commits the preview, the way
  // tapping the lifted preview in UIContextMenuInteraction does. 'dismiss'
  // reports the press before the menu finishes leaving; 'pop' reports it as
  // the preview lands back, matching the two commit styles.
  _commitPreview() {
    this._previewCommit = this.opts.commitStyle ?? 'dismiss';
    this._suppressCancel = true;
    if (this._previewCommit === 'dismiss') this.opts.onPressMenuPreview?.();
    this.close();
  }

  // Positions the panel-sized children (fallback panel, rows, settled glass)
  // inside the stage at the menu's offset. The stage box itself is fixed for
  // the whole open session; only these children track the live `to` rect, so
  // a submenu resize glides them without recomputing blob coordinates.
  _placeStageChildren(to = this._morph?.to) {
    if (!this._stageBox || !to) return;
    const x = to.left - this._stageBox.x;
    const y = to.top - this._stageBox.y;
    for (const el of [this._panel, this._content]) {
      if (!el) continue;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.width = `${to.width}px`;
      el.style.height = `${to.height}px`;
    }
    if (this._blobMode === 'settled' && this.glass) {
      Object.assign(this.glass.element.style, {
        left: `${x}px`, top: `${y}px`,
        width: `${to.width}px`, height: `${to.height}px`,
      });
    }
  }

  // The glass covers the whole stage while the blob travels — the same trick
  // the reference's backdrop-filtered blob uses — then settles into the
  // menu's own rect with the panel's corner radius once the shape lands.
  _glassToUnion() {
    const glass = this.glass;
    if (!glass || !this._stageBox) return;
    const { w, h } = this._stageBox;
    Object.assign(glass.element.style, {
      left: '0px', top: '0px', width: `${w}px`, height: `${h}px`,
    });
    // The surface itself stays unrounded; the shader draws the blob from the
    // pill and panel frames (see _syncGlassFrames), so refraction, rim light
    // and thickness follow the liquid silhouette, not the stage rectangle.
    glass.setCornerRadius(0);
    glass.shapeMergeSmoothness = (MERGE_WIDTH * 1.25) / h;
    glass.rasterSize = { width: w, height: h };
    glass.captureRasterSize = glass.rasterSize;
    glass.prepareRaster();
    this._syncGlassFrames();
  }

  // Feeds LiquidGlassView the two boxes the blob is made of. Its multi-rect
  // smooth union is the glass-side twin of the SDF in menu-blob.js. The
  // shader has one corner radius for every rect, so it is kept no larger than
  // the smallest rect in play; a rect still smaller than a corner is left out
  // (the other one covers its centre), and the clip-path trims the rest.
  _syncGlassFrames() {
    const glass = this.glass;
    const morph = this._blobMorph;
    if (!glass || !morph || this._blobMode !== 'morph') return;
    const box = ({ L, R, T, B }) => ({ x: L.x, y: T.x, width: R.x - L.x, height: B.x - T.x });
    const frames = [];
    let radius = Infinity;
    for (const rect of [box(morph.a), box(morph.e)]) {
      const half = Math.min(rect.width, rect.height) / 2;
      if (half < 10) continue;
      frames.push(rect);
      radius = Math.min(radius, half);
    }
    const F = morph.F;
    const tall = Math.max(F.B - F.T, 1);
    const grown = clamp((morph.e.B.x - morph.e.T.x) / tall, 0, 1);
    const want = lerp(morph.pillRadius, morph.panelRadius, grown);
    glass.frames = frames;
    glass.cornerRadius = Number.isFinite(radius) ? Math.min(want, radius) : want;
  }

  _glassToMenu() {
    const glass = this.glass;
    if (!glass || !this._morph || !this._stageBox) return;
    const to = this._morph.to;
    const x = to.left - this._stageBox.x;
    const y = to.top - this._stageBox.y;
    Object.assign(glass.element.style, {
      left: `${x}px`, top: `${y}px`,
      width: `${to.width}px`, height: `${to.height}px`,
    });
    glass.frames = [];
    glass.setCornerRadius(to.radius);
    glass.rasterSize = { width: to.width, height: to.height };
    glass.captureRasterSize = glass.rasterSize;
    glass.prepareRaster();
  }

  // Computes the union box once per open and wires the blob morph to it.
  // Everything is measured in stage-local pixels; the stage element itself
  // is positioned relative to the menu afterwards.
  _beginBlob() {
    const to = this._morph.to;
    const pr = this._morph.trigger;
    const pad = 56;
    const pill = {
      l: pr.left, t: pr.top, r: pr.left + pr.width, b: pr.top + pr.height,
    };
    const panel = {
      l: to.left, t: to.top, r: to.left + to.width, b: to.top + to.height,
    };
    const bx = Math.min(pill.l, panel.l) - pad;
    const by = Math.min(pill.t, panel.t) - pad;
    const bw = Math.max(pill.r, panel.r) + pad - bx;
    const bh = Math.max(pill.b, panel.b) + pad - by;
    this._stageBox = { x: bx, y: by, w: bw, h: bh };

    Object.assign(this._wrap.style, {
      left: `${bx - to.left}px`, top: `${by - to.top}px`,
      width: `${bw}px`, height: `${bh}px`,
    });
    for (const svg of this._wrap.querySelectorAll('svg')) {
      svg.setAttribute('viewBox', `0 0 ${bw} ${bh}`);
    }

    const mount = this.opts.container ?? document.body;
    const cr = mount === document.body ? { left: 0, top: 0 } : mount.getBoundingClientRect();
    const ox = cr.left + (mount.clientLeft || 0);
    const oy = cr.top + (mount.clientTop || 0);
    const pillLocal = { l: pill.l - bx, t: pill.t - by, r: pill.r - bx, b: pill.b - by };
    const panelLocal = { l: panel.l - bx, t: panel.t - by, r: panel.r - bx, b: panel.b - by };
    // Jump from the exact middle of the panel & burst outward like a balloon!
    const press = {
      x: (panelLocal.l + panelLocal.r) / 2,
      y: (panelLocal.t + panelLocal.b) / 2,
    };
    const leadV = Math.abs(panelLocal.b - pillLocal.b) >= Math.abs(panelLocal.t - pillLocal.t) ? 'B' : 'T';
    const leadH = Math.abs(panelLocal.r - pillLocal.r) >= Math.abs(panelLocal.l - pillLocal.l) ? 'R' : 'L';

    // Reuse the spring state across a reopen mid-dismissal when the geometry
    // is unchanged, so the blob keeps travelling instead of restarting.
    const box = this._stageBox;
    const sameBox = this._blobBox &&
      Math.abs(this._blobBox.x - box.x) < 1 && Math.abs(this._blobBox.y - box.y) < 1 &&
      Math.abs(this._blobBox.w - box.w) < 1 && Math.abs(this._blobBox.h - box.h) < 1;
    let morph = sameBox ? this._blobMorph : null;
    if (morph) {
      morph.F = { L: panelLocal.l, R: panelLocal.r, T: panelLocal.t, B: panelLocal.b };
      morph.PR = { L: pillLocal.l, R: pillLocal.r, T: pillLocal.t, B: pillLocal.b };
      morph.P = press;
      morph.lead = { v: leadV, h: leadH };
      morph.pillRadius = parseFloat(getComputedStyle(this.morphSource).borderTopLeftRadius) || 0;
      morph.panelRadius = Math.min(to.radius, 32);
      morph.retarget(true);
    } else {
      morph = new LiquidMenuMorph({
        pill: pillLocal, panel: panelLocal, press,
        pillRadius: parseFloat(getComputedStyle(this.morphSource).borderTopLeftRadius) || 0,
        panelRadius: to.radius,
        leadV, leadH,
      });
      morph.retarget(true);
    }
    // Inject bouncy balloon-burst spring parameters (underdamped + explosive outward impulse)
    for (const k of ['L', 'R', 'T', 'B']) {
      const sign = (k === 'R' || k === 'B') ? 1 : -1;
      morph.e[k].k = 340;
      morph.e[k].c = 13.5; // Low damping ratio (~0.36) -> big elastic balloon overshoot & bounce
      morph.e[k].v = sign * 1150; // Explosive outward burst velocity from the center
    }
    if (this._burst) {
      Object.assign(this._burst.style, {
        left: `${press.x}px`,
        top: `${press.y}px`,
      });
      this._burst.classList.remove('is-popping');
      void this._burst.offsetWidth;
      this._burst.classList.add('is-popping');
    }
    this._blobMorph = morph;
    this._blobBox = { x: box.x, y: box.y, w: box.w, h: box.h };

    this._placeStageChildren(to);
    if (this.glass) this._glassToUnion();
    Object.assign(this._face.style, {
      left: `${pillLocal.l}px`, top: `${pillLocal.t}px`,
      width: `${pillLocal.r - pillLocal.l}px`, height: `${pillLocal.b - pillLocal.t}px`,
      display: '',
    });
    this.morphSource.style.visibility = 'hidden';

    this._stage.classList.add('is-entering');
    this._stage.classList.remove('is-live');
    requestAnimationFrame(() => {
      if (this._stage) this._stage.classList.add('is-live');
    });
    this._rim.style.display = '';
    this._blobMode = 'morph';
    this._stage.dataset.mode = 'morph';
    this._blobAnimating = true;
    this._awaitingDidShow = true;
    this._blobLast = 0;
    this._applyBlob();
  }

  _applyBlob() {
    if (!this._blobMorph || !this._stage) return;
    const d = this._blobMorph.outline();
    const clip = `path('${d}')`;
    this._stage.style.clipPath = clip;
    this._stage.style.webkitClipPath = clip;
    for (const path of this._blobPaths) path.setAttribute('d', d);
    this._syncGlassFrames();
  }

  // The blob has landed: the panel is a plain rounded rect again, so the
  // clip-path, rim and union-sized glass all retire into their settled form.
  _settleMorph() {
    this._blobMode = 'settled';
    this._stage.dataset.mode = 'settled';
    this._blobAnimating = false;
    this._stage.classList.remove('is-entering');
    this._stage.style.clipPath = '';
    this._stage.style.webkitClipPath = '';
    this._rim.style.display = 'none';
    if (this.glass) this._glassToMenu();
    this._placeStageChildren(this._morph?.to);
    this._progress = 1;
    if (this._awaitingDidShow) {
      this._awaitingDidShow = false;
      this.opts.onMenuDidShow?.();
    }
  }

  // A submenu resize after landing puts the blob back to work: the clip
  // returns and the panel edges chase the new rect on their springs.
  _enterMorphVisual(animateRows = true) {
    if (this._blobMode === 'morph') return;
    this._blobMode = 'morph';
    this._stage.dataset.mode = 'morph';
    this._blobAnimating = true;
    this._progress = 0;
    if (this.glass) this._glassToUnion();
    this._rim.style.display = '';
    this._applyBlob();
    if (animateRows) {
      this._stage.classList.add('is-entering');
      this._stage.classList.remove('is-live');
      requestAnimationFrame(() => {
        if (this._stage) this._stage.classList.add('is-live');
      });
    }
  }

  // The panel's live rect feeds the blob's panel-edge targets, so a submenu
  // springing open or closed stretches the liquid shape instead of snapping.
  _syncBlobPanel() {
    const morph = this._blobMorph;
    const to = this._morph?.to;
    const box = this._stageBox;
    if (!morph || !to || !box) return;
    const panel = {
      L: to.left - box.x, R: to.left + to.width - box.x,
      T: to.top - box.y, B: to.top + to.height - box.y,
    };
    morph.F = panel;
    morph.panelRadius = Math.min(to.radius, 32);
    if (!morph.closing) {
      for (const k of ['L', 'R', 'T', 'B']) morph.e[k].t = panel[k];
    }
    this._placeStageChildren(to);
  }

  // Measures the final placement once. The blob then animates around these
  // anchors; nothing here changes while the silhouette moves.
  _measure() {
    const o = this.opts;
    const mount = o.container ?? document.body;
    const fixed = mount === document.body;
    let ox = 0;
    let oy = 0;
    let bw = innerWidth;
    let bh = innerHeight;
    if (!fixed) {
      const cr = mount.getBoundingClientRect();
      ox = cr.left + mount.clientLeft;
      oy = cr.top + mount.clientTop;
      bw = mount.clientWidth;
      bh = mount.clientHeight;
    }
    const rect = this.morphSource.getBoundingClientRect();
    const trigger = {
      left: rect.left - ox,
      top: rect.top - oy,
      width: rect.width,
      height: rect.height,
    };

    // Measure the rows once before starting the morph.
    const width = Math.min(o.width, Math.max(1, bw - o.edge * 2));
    const menu = this._menu;
    menu.style.width = `${width}px`;
    menu.style.height = 'auto';
    // The rows live in the stage, which is still 0px wide before the blob is
    // laid out, so give them their final width first or the labels wrap
    // one character per line and the panel measures absurdly tall.
    if (this._content) {
      this._content.style.width = `${width}px`;
      this._content.style.height = 'auto';
      this._content.style.maxHeight = `${Math.max(44, bh - o.edge * 2)}px`;
    }
    const height = Math.max(1, this._content ? this._content.offsetHeight : menu.offsetHeight);
    menu.style.height = `${height}px`;

    const [direction, alignment = 'center'] = o.placement.split('-');
    const aboveSpace = trigger.top;
    const belowSpace = bh - trigger.top - trigger.height;
    let above = direction === 'top' || (direction === 'auto' && aboveSpace > belowSpace);
    if (above && trigger.top - height - o.gap < o.edge && belowSpace > aboveSpace) above = false;
    if (!above && trigger.top + trigger.height + height + o.gap > bh - o.edge && aboveSpace > belowSpace) above = true;
    const preferredLeft = alignment === 'start' ? trigger.left
      : alignment === 'end' ? trigger.left + trigger.width - width
      : trigger.left + (trigger.width - width) / 2;
    let left = clamp(preferredLeft, o.edge, Math.max(o.edge, bw - width - o.edge));
    let top = clamp(above ? trigger.top - height - o.gap : trigger.top + trigger.height + o.gap,
      o.edge, Math.max(o.edge, bh - height - o.edge));
    if (direction === 'morph') {
      // Jump out centered from the middle of the trigger!
      const panelHeight = Math.min(height, bh - o.edge * 2);
      left = clamp(trigger.left + (trigger.width - width) / 2, o.edge,
        Math.max(o.edge, bw - width - o.edge));
      top = clamp(trigger.top + trigger.height + 10, o.edge,
        Math.max(o.edge, bh - panelHeight - o.edge));
      above = top < trigger.top;
    }
    const to = { left, top, width, height: Math.min(height, bh - o.edge * 2), radius: o.radius };
    // Fixed content prevents text reflow throughout the changing silhouette.
    this._content.style.width = `${width}px`;
    this._content.style.height = `${to.height}px`;
    menu.dataset.morph = above ? 'up' : 'down';
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.height = `${to.height}px`;
    menu.style.borderRadius = `${to.radius}px`;
    return { to, trigger, above };
  }

  _frame(now) {
    this._frameHandle = 0;
    if (!this._menu || this._destroyed) return;
    this._stepGroups(now);
    if (this._layoutTransition) {
      const layout = this._layoutTransition;
      const dt = Math.min(layout.last ? (now - layout.last) / 1000 : 1 / 60, 0.05) /
        Math.max(this.opts.slowMo, 0.001);
      layout.last = now;
      const moving = !prefersReducedMotion() && layout.spring.step(dt);
      const progress = moving ? layout.spring.value : 1;
      this._morph.to = { ...layout.to,
        top: lerp(layout.from.top, layout.to.top, progress),
        height: lerp(layout.from.height, layout.to.height, progress) };
      this._applyVisual(this._visual);
      if (!moving) this._layoutTransition = null;
    }
    if (this._transition) {
      if (prefersReducedMotion()) this._finishTransition();
      else this._stepTransition(now);
    }
    // A completed dismissal tears the panel down inside the step above.
    if (!this._menu) return;
    if (this._menu.dataset.glass === 'rendered' &&
      !window.matchMedia('(prefers-reduced-transparency: reduce)').matches) this.glass.draw();
    if (this._transition || this._layoutTransition || this._groupAnimations.size || (this.state === 'open' && this.live && (this.source || this.backgroundLayers.length))) this.requestDraw();
  }


  // ---- transition driver -------------------------------------------------
  // The blob replaces the base class's tween: the edge springs in
  // menu-blob.js are the only clock. These overrides keep the base's
  // `_transition` / `_frame` contract, so requestDraw keeps ticking while the
  // shape is moving and stops once it has landed or left.

  _animateTo(target, restoreFocus = false) {
    this._restoreFocus = restoreFocus;
    this._transition = { target };
    if (target === 1) {
      this._beginBlob();
      if (prefersReducedMotion()) this._finishTransition();
      return;
    }
    // Dismissal: put a landed panel back under the clip, then collapse the
    // edges onto the trigger and fade the rows and face the other way.
    const stage = this._stage;
    if (this._blobMode === 'settled') {
      this._enterMorphVisual(false);
      stage.classList.add('is-entering', 'is-live');
      void stage.offsetWidth;
    }
    stage.classList.remove('is-live');
    this._blobLast = 0;
    this._blobMorph.retarget(false);
    if (prefersReducedMotion()) this._finishTransition();
  }

  _stepTransition(now) {
    const morph = this._blobMorph;
    if (!morph) { this._finishTransition(); return; }
    const slow = Math.max(this.opts.slowMo ?? 1, 0.001);
    const dtMs = this._blobLast ? (now - this._blobLast) / slow : 1000 / 60;
    this._blobLast = now;
    const moving = morph.step(dtMs);
    this._applyBlob();
    if (!moving) this._finishTransition();
  }

  _finishTransition() {
    const transition = this._transition;
    if (!transition) return;
    this._transition = null;
    if (transition.target === 1) {
      this._blobMorph?.e && ['L', 'R', 'T', 'B'].forEach(k => {
        this._blobMorph.e[k].x = this._blobMorph.e[k].t;
        this._blobMorph.e[k].v = 0;
      });
      this._settleMorph();
      return;
    }
    this._blobMode = null;
    this._blobAnimating = false;
    const restore = this._restoreFocus;
    this._teardown();
    if (restore) this.trigger.focus({ preventScroll: true });
  }

  // Layout glides (submenus) are handled by _syncBlobPanel; the base's
  // transform/opacity visual does not apply to a clip-path surface.
  _applyVisual() {
    if (this._blobMorph) this._syncBlobPanel();
  }

  _onMenuKey(event) {
    const entry = this._items.find(item => item.el === document.activeElement);
    if (event.key === 'ArrowRight' && entry?.group && !entry.inline && !entry.item.disabled) {
      event.preventDefault();
      this._toggleSubmenu(entry, true);
      this._focusable().find(el => entry.group.contains(el))?.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'ArrowLeft' && entry) {
      const parent = entry.group && entry.el.getAttribute('aria-expanded') === 'true' && !entry.inline ? entry : entry.parent;
      if (parent && !parent.inline) {
        event.preventDefault();
        this._toggleSubmenu(parent, false);
        parent.el.focus({ preventScroll: true });
        return;
      }
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this._select(document.activeElement);
      return;
    }
    super._onMenuKey(event);
  }

  _select(element) {
    const entry = this._items.find(item => item.el === element);
    if (!entry || entry.item.disabled || this._hasDisabledParent(entry) || element.closest('[hidden], [inert]') ||
      this.state !== 'open' || this._selectionTimer) return;
    if (entry.group) {
      this._toggleSubmenu(entry);
      return;
    }
    element.classList.add('is-active');
    this._didSelectItem = true;
    if (entry.item.keepsMenuPresented) {
      // UIMenuElement.Attributes.keepsMenuPresented: the action fires while
      // the menu stays presented, so there is no dismissal to wait for.
      setTimeout(() => element.classList.remove('is-active'),
        prefersReducedMotion() ? 0 : 160);
      (entry.item.onSelect ?? entry.item.onPress)?.(entry.item);
      this.opts.onSelect?.(entry.item);
      return;
    }
    this._selectionTimer = setTimeout(() => {
      this._selectionTimer = 0;
      this.close({ restoreFocus: this._viaKeyboard }).then(closed => {
        if (!closed || this._destroyed) return;
        (entry.item.onSelect ?? entry.item.onPress)?.(entry.item);
        this.opts.onSelect?.(entry.item);
      });
    }, prefersReducedMotion() ? 0 : 60);
  }

  _teardown() {
    // The interaction reports didHide when the dismissal animation completes,
    // then didCancel if nothing was selected. A 'pop' commit reports the
    // preview press in that same completion block, before didHide.
    const wasPresented = this.state !== 'closed';
    if (wasPresented) {
      if (this._previewCommit === 'pop') this.opts.onPressMenuPreview?.();
      this.opts.onMenuDidHide?.();
      if (!this._didSelectItem && !this._suppressCancel) this.opts.onMenuDidCancel?.();
    }
    this._previewCommit = null;
    this._suppressCancel = false;
    if (this._frameHandle) cancelAnimationFrame(this._frameHandle);
    this._frameHandle = 0;
    clearTimeout(this._selectionTimer);
    this._selectionTimer = 0;
    this._transition = null;
    this._layoutTransition = null;
    this._groupAnimations.clear();
    this._morph = null;
    // The trigger faded under the drop while the menu was up; restore its
    // own appearance so no inline style survives into the closed state.
    this.morphSource.style.transform = this._sourceTransform;
    this.morphSource.style.opacity = this._sourceOpacity;
    this.morphSource.style.filter = this._sourceFilter;
    this.morphSource.style.visibility = this._sourceVisibility;
    this._blobMode = null;
    this._blobMorph = null;
    this._blobBox = null;
    // Reuse the WebGL context on the next opening, avoiding a shader compile on
    // every click. The backing canvas is detached, never left drawing offscreen.
    if (this.glass) {
      if (this.glass.frameHandle) cancelAnimationFrame(this.glass.frameHandle);
      this.glass.frameHandle = 0;
      this.glass.captureUntil = 0;
      this.glass.remove();
    }
    this._resolveClose?.(false);
    this._resolveClose = null;
    this._closePromise = null;
    super._teardown();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.trigger.removeEventListener('pointerdown', this._onTriggerPress);
    if (this._warmupHandle != null) {
      if (window.cancelIdleCallback) window.cancelIdleCallback(this._warmupHandle);
      else clearTimeout(this._warmupHandle);
      this._warmupHandle = null;
    }
    this.trigger.removeEventListener('contextmenu', this._onContextMenu);
    super.destroy();
    this.glass?.dispose();
    this.glass = null;
    if (this._previousControls == null) this.trigger.removeAttribute('aria-controls');
    else this.trigger.setAttribute('aria-controls', this._previousControls);
  }
}

export { MenuView as LiquidGlassMenuView };
export default MenuView;
