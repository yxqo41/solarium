/* solarium — a JavaScript port of LiquidGlassKit
 * (https://github.com/DnV1eX/LiquidGlassKit, Swift + Metal).
 *
 * The Swift controls animate with UIView's spring parameters. CSS easing curves
 * cannot express an overshoot that settles, and several of the ported motions
 * (the lens squash, the thumb morph) also need to drive a value frame by frame,
 * so they share this small damped-oscillator solver instead.
 */

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// UIKit spring parameters measured on the iOS 27.2 simulator through the
// public CASpringAnimation properties of UIView.animate. These are the damping
// ratios used by the reference's thumb, lens and position animations. Store
// omega * duration so each measured curve scales to the caller's duration.
// The corresponding native parameters are retained in the test fixtures.
const UIKIT_FREQUENCIES = {
  0.6: 11.0334553193819,
  0.7: 9.83964652115601,
  1: 9.23341372440328,
  0.8: 8.99429663751452,
};

// Normalised progress for the reference's duration-based animation API. The
// measured curves cover its call sites; other ratios use a settling-envelope
// approximation rather than pretending we measured every possible spring.
export function springProgress(duration = 0.4, damping = 0.7) {
  const safeDuration = Math.max(duration, 0.001);
  const ratio = clamp(damping, 0.05, 1);
  const residual = 0.001;
  const frequencyDuration = UIKIT_FREQUENCIES[ratio]
    ?? -Math.log(residual * Math.sqrt(1 - ratio * ratio)) / ratio;
  const omega = frequencyDuration / safeDuration;

  const curve = ratio >= 1
    // Critically damped: no overshoot, the plain exponential approach.
    ? t => 1 - Math.exp(-omega * t) * (1 + omega * t)
    : (() => {
      const dampedOmega = omega * Math.sqrt(1 - ratio * ratio);
      return t => {
        const envelope = Math.exp(-ratio * omega * t);
        return 1 - envelope * (
          Math.cos(dampedOmega * t) +
          (ratio * omega / dampedOmega) * Math.sin(dampedOmega * t)
        );
      };
    })();

  // Normalisation removes the tiny residual so completion lands exactly at
  // the target. Progress stays dimensionless; the oscillator takes seconds.
  const landing = curve(safeDuration);
  return t => (t >= 1 ? 1 : curve(clamp(t, 0, 1) * safeDuration) / landing);
}

// Runs the spring on the next frames and reports eased progress. Returns a
// cancel function, which the controls keep so a new gesture can interrupt an
// in-flight morph the way `beginFromCurrentState` does in the original.
export function animateSpring({ duration, damping, onFrame, onDone }) {
  if (prefersReducedMotion()) {
    onFrame(1);
    if (onDone) {
      onDone();
    }
    return () => {};
  }

  const progress = springProgress(duration, damping);
  const startedAt = performance.now();
  let handle = 0;
  let cancelled = false;

  const step = now => {
    if (cancelled) {
      return;
    }
    if (prefersReducedMotion()) {
      onFrame(1, 1);
      if (onDone) onDone();
      return;
    }
    const elapsed = Math.min((now - startedAt) / 1000 / Math.max(duration, 0.001), 1);
    onFrame(progress(elapsed), elapsed);
    if (elapsed < 1) {
      handle = requestAnimationFrame(step);
    } else {
      handle = 0;
      if (onDone) {
        onDone();
      }
    }
  };

  handle = requestAnimationFrame(step);

  return () => {
    cancelled = true;
    if (handle) {
      cancelAnimationFrame(handle);
      handle = 0;
    }
  };
}

// The menu morph cannot use springProgress above: its channels each carry a
// native response/damping pair recovered from MorphAnimationSettings, two of
// them start after a fitted delay, and the position channel begins with an
// initial velocity that a from-rest spring cannot reproduce (the recorded
// trace shows the centre hanging almost still for 50ms and then overshooting
// by 40%). This evaluates the closed form directly so a channel can be sampled
// at any elapsed time in seconds; omega = 2*pi/response keeps the same
// convention as the spring() helper in ../menuview.js.
function rawSpringStep(elapsed, { response, damping, delay = 0, velocity = 0 }) {
  const t = elapsed - delay;
  if (t <= 0) return 0;
  const omega = (2 * Math.PI) / response;
  if (damping >= 1) {
    // Critically damped with an initial velocity: the velocity term replaces
    // the plain (1 + omega*t) factor so the derivative at t=0 is exactly
    // `velocity` instead of zero.
    return 1 - Math.exp(-omega * t) * (1 + (omega - velocity) * t);
  }
  const dampedOmega = omega * Math.sqrt(1 - damping * damping);
  const envelope = Math.exp(-damping * omega * t);
  const c = (damping * omega - velocity) / dampedOmega;
  return 1 - envelope * (Math.cos(dampedOmega * t) + c * Math.sin(dampedOmega * t));
}

// Normalised progress for one morph channel. The raw spring is still moving
// when the phase deadline arrives (its residual is a few percent), so the
// curve is divided by its value at `duration`: completion then lands exactly
// on 1 while the overshoot in between passes through unflattened. Progress
// stays 0 through the channel's delay, and callers interpolate from/to values
// with it, which is how the same evaluator serves both the entrance and the
// dismissal.
export function springChannel(params, duration) {
  const landing = rawSpringStep(duration, params) || 1;
  return elapsed => (elapsed >= duration ? 1 : rawSpringStep(elapsed, params) / landing);
}

export function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
