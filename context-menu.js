/* Adapted from react-native-ios-context-menu (MIT, Dominic Go).
 * See LICENSE-react-native-ios-context-menu.
 *
 * The package is a thin shell over UIKit's UIContextMenuInteraction: its real
 * contribution is the menu description model — RNIMenuItem (a UIMenu),
 * RNIMenuActionItem (a UIAction) and RNIMenuPreviewConfig — plus the event
 * lifecycle the interaction reports. This module ports that model onto the
 * item shape the solarium MenuView already renders, so a caller can describe
 * a menu the way the iOS package does:
 *
 *   {
 *     type: 'menu',                       // or 'action' / omitted
 *     menuTitle: 'Share',                 // actionTitle for a leaf
 *     actionSubtitle: ' Sends a copy ',
 *     menuState: 'on' | 'off' | 'mixed',  // UIMenuElement.State
 *     menuAttributes: ['disabled', 'destructive', 'hidden', 'keepsMenuPresented'],
 *     menuOptions: ['displayInline', 'destructive'],   // UIMenu.Options
 *     menuItems: [ ... ],                 // children; makes this a submenu
 *     menuPreferredElementSize: 'small' | 'medium' | 'large',
 *   }
 *
 * The animation itself is not in the package — UIKit owns it — so the morph
 * in menu-morph.js stays the port of what the interaction actually does.
 *
 * Icons are the one field not translated: the package resolves SF Symbol
 * names, asset catalogs and remote images natively, while `icon` here takes
 * the solarium markup directly (an SVG string or a node). An `iconType:
 * 'NONE'` config still clears the slot, matching the native side.
 */

const ACTION_TYPES = new Set(['action']);
const MENU_TYPES = new Set(['menu']);
// RNIDeferredMenuElement resolves its children asynchronously through a
// native round-trip. A DOM menu has no equivalent channel, so deferred
// elements are skipped rather than rendered empty.
const DEFERRED_TYPES = new Set(['deferred']);

const STATES = new Set(['on', 'off', 'mixed']);
const SIZES = new Set(['small', 'medium', 'large']);
const INLINE_OPTIONS = new Set(['displayInline', 'inline']);
const DESTRUCTIVE_OPTIONS = new Set(['destructive']);

const list = value => (Array.isArray(value) ? value : value == null ? [] : [value]);

function first(item, keys) {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

// UIMenuElement.Attributes and UIMenu.Options arrive as parallel string
// lists on the native side; both are accepted here under either name.
function flagsOf(item, keys) {
  return new Set(list(first(item, keys)).filter(flag => typeof flag === 'string'));
}

// A destructive UIMenu renders every descendant action destructive, which is
// what `menuOptions: ['destructive']` means on a submenu.
function normalizeElement(item, inherited = {}) {
  if (!item || typeof item !== 'object') return null;
  const type = item.type ?? item.kind;
  if (DEFERRED_TYPES.has(type)) return null;
  // Separators carry no label by design; pass them through untouched.
  if (item.separator === true) return { ...item, separator: true };

  const attributes = flagsOf(item, ['menuAttributes', 'attributes']);
  const options = flagsOf(item, ['menuOptions', 'options']);
  const destructive = !!inherited.destructive || item.destructive === true ||
    attributes.has('destructive') || options.has('destructive');

  const children = first(item, ['menuItems', 'children', 'items']);
  const normalized = {
    ...item,
    label: first(item, ['label', 'title', 'actionTitle', 'menuTitle']) ?? '',
    subtitle: first(item, ['subtitle', 'actionSubtitle']),
    icon: (item.icon ?? item.image)?.iconType === 'NONE' ? undefined : item.icon ?? item.image,
    key: first(item, ['key', 'actionKey', 'id']),
    disabled: item.disabled === true || attributes.has('disabled'),
    destructive,
    hidden: item.hidden === true || attributes.has('hidden'),
    keepsMenuPresented: item.keepsMenuPresented === true || attributes.has('keepsMenuPresented'),
    inline: item.inline === true || [...options].some(flag => INLINE_OPTIONS.has(flag)),
    separator: item.separator === true,
  };

  const state = first(item, ['state', 'menuState']);
  if (STATES.has(state)) normalized.state = state;
  else if (typeof item.checked === 'boolean') normalized.checked = item.checked;

  const size = first(item, ['size', 'elementSize', 'preferredElementSize', 'menuPreferredElementSize']);
  if (SIZES.has(size)) normalized.size = size;

  if (Array.isArray(children) && children.length) {
    normalized.children = children
      .map(child => normalizeElement(child, { destructive }))
      .filter(Boolean);
    if (!normalized.children.length) {
      // Every child was deferred or invalid; a submenu with nothing to show
      // degrades to a disabled row rather than a dead chevron.
      delete normalized.children;
      if (MENU_TYPES.has(type)) normalized.disabled = true;
    }
  } else if (MENU_TYPES.has(type) || first(item, ['menuItems', 'children', 'items']) !== undefined) {
    // An empty UIMenu is presented disabled rather than as a dead chevron.
    normalized.children = [];
    normalized.disabled = true;
  }

  if (!ACTION_TYPES.has(type) && !normalized.children) {
    // Untyped leaf: the RN model treats a bare actionTitle as an action.
    if (normalized.label === '' && !item.actionTitle) return null;
  }
  return normalized;
}

// Accepts the package's root `menuConfig` ({ menuTitle, menuItems, ... }),
// a bare array of elements, or the solarium-native item list, and returns
// solarium items. `title` is surfaced separately because the base builder
// has no slot for a root menu title.
export function normalizeMenuConfig(config) {
  if (Array.isArray(config)) {
    return { title: undefined, items: config.map(item => normalizeElement(item)).filter(Boolean) };
  }
  if (!config || typeof config !== 'object') {
    return { title: undefined, items: [] };
  }
  const options = flagsOf(config, ['menuOptions', 'options']);
  const items = first(config, ['menuItems', 'items', 'children']);
  return {
    title: first(config, ['title', 'menuTitle', 'label']),
    destructive: options.has('destructive'),
    items: list(items).map(item => normalizeElement(item, { destructive: options.has('destructive') })).filter(Boolean),
  };
}

export function normalizeMenuItems(items) {
  return normalizeMenuConfig(items).items;
}
