/* Adapted from liquid_glass_widgets liquid_morph_physics.dart and
 * glass_morph_controller.dart. See LICENSE-liquid-glass-widgets.
 */

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));

// Flutter Cubic solves x first; evaluating y directly at progress changes
// both the size curve and the time at which the circle becomes a rectangle.
export function cubic(x1, y1, x2, y2, progress) {
  if (progress <= 0 || progress >= 1) return clamp(progress);
  const at = (a, b, t) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t * t + t ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (at(x1, x2, mid) < progress) low = mid;
    else high = mid;
  }
  return at(y1, y2, (low + high) / 2);
}

export function computeMenuMorph(raw, finalDx, finalDy, closing = false) {
  const progress = clamp(raw);
  const undershoot = Math.min(raw, 0);
  const adaptive = Math.abs(finalDy) > 100;
  const amplitude = adaptive ? clamp(250 / Math.abs(finalDy), 0.7, 2.5) : 2.5;
  const t = progress - 1;
  const path = closing ? raw : t * t * ((amplitude + 1) * t + amplitude) + 1 + undershoot;
  const ease = value => cubic(0.35, 0.91, 0.33, 0.97, value);
  const size = (closing ? 1 - ease(1 - progress) : ease(progress)) + undershoot;
  const travel = Math.hypot(finalDx, finalDy);
  const push = adaptive && travel ? Math.min(1, 80 / travel) : 1;
  return {
    progress, path, size,
    radiusProgress: cubic(0.95, 0.05, 0.795, 0.035, clamp(size)),
    driftX: closing ? 0 : clamp(finalDx * (path - size), -8, 8),
    driftY: closing ? 0 : clamp(finalDy * (path - size), -8, 8),
    pushX: undershoot * finalDx * push,
    pushY: undershoot * finalDy * push,
    anchorScale: clamp(1 - progress / 0.4),
    blend: clamp(Math.abs(path - size) * 150, 0, 28),
    scale: raw > 1 ? 1 + (raw - 1) * 0.1 : raw < 0 ? 1 + raw * 0.55 : 1,
    contentOpacity: closing ? clamp((size - 0.5) / 0.45) : clamp((size - 0.25) / 0.55),
    triggerOpacity: closing ? clamp((0.42 - progress) / 0.35) : 1 - clamp(progress / 0.2),
    opacity: closing ? clamp(progress / 0.22) : 1,
  };
}

// UIKit's menu spring, fitted from 60 fps captures of the native menu
// (SwiftUI .spring(response: 0.35, dampingFraction: 0.8) opening, and the
// 150 ms fade UIKit uses to dismiss one). It is evaluated analytically, not
// stepped per frame, so a dropped frame cannot stretch the animation.
export class MenuMorphSpring {
  constructor(from, target) {
    this.from = from;
    this.target = target;
    // A dismissal leaves with the reference's release velocity, so the panel
    // moves on the first frame instead of hanging at the anchor.
    this.velocity = target === 0 ? -2.5 : 0;
    this.omega = 2 * Math.PI / (target === 0 ? 0.22 : 0.35);
    // Underdamped: UIKit lets the menu overshoot by about 2% as it lands.
    this.zeta = 0.8;
  }

  sample(seconds) {
    const { omega, zeta } = this;
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * seconds);
    const a = this.from - this.target;
    const b = (this.velocity + zeta * omega * a) / damped;
    const cosine = Math.cos(damped * seconds);
    const sine = Math.sin(damped * seconds);
    const displacement = decay * (a * cosine + b * sine);
    const velocity = decay * ((b * damped - zeta * omega * a) * cosine -
      (a * damped + zeta * omega * b) * sine);
    const done = Math.abs(displacement) < 0.001 && Math.abs(velocity) < 0.05;
    return { value: done ? this.target : this.target + displacement, velocity, done };
  }
}
