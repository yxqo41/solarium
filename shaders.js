/* solarium — 1:1 WebGL2 port of AndroidLiquidGlass (com.kyant.backdrop)
 *
 * Ported 1:1 from:
 * - backdrop/src/commonMain/kotlin/com/kyant/backdrop/internal/Shaders.kt
 *   (RoundedRectSDF, RoundedRectRefractionShaderString,
 *    RoundedRectRefractionWithDispersionShaderString,
 *    DefaultHighlightShaderString, AmbientHighlightShaderString)
 * - backdrop/src/commonMain/kotlin/com/kyant/backdrop/effects/ColorFilter.kt
 *   (colorControlsColorFilter / vibrancy 1.5x saturation)
 * - backdrop/src/commonMain/kotlin/com/kyant/backdrop/shadow/InnerShadowModifier.kt
 * - app/src/commonMain/kotlin/com/kyant/backdrop/catalog/utils/InteractiveHighlight.kt
 */

export const VERTEX_SHADER = `#version 300 es
precision highp float;

out vec2 v_uv;

void main() {
  vec2 positions[4] = vec2[4](
    vec2(-1.0, -1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0,  1.0),
    vec2( 1.0,  1.0)
  );
  vec2 position = positions[gl_VertexID];
  gl_Position = vec4(position, 0.0, 1.0);
  v_uv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
}`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

const float PI = 3.141592653589793;
const int MAX_RECTANGLES = 16;

uniform vec2 u_resolution;              // Drawable size in device pixels.
uniform float u_contentsScale;          // Device pixels per CSS pixel.
uniform vec2 u_touchPoint;              // Interactive highlight pointer (CSS px)
uniform float u_shapeMergeSmoothness;   // Smooth-union blend width, in view heights.
uniform float u_cornerRadius;           // Corner radius in CSS pixels.
uniform float u_cornerRoundnessExponent;
uniform vec2 u_backdropTone;            // x = saturation (1.5 for vibrancy), y = brightness
uniform vec4 u_materialTint;            // Surface overlay RGBA (onDrawSurface)
uniform float u_glassThickness;         // refractionHeight in CSS pixels
uniform float u_refractiveIndex;        // refractionAmount in CSS pixels (or legacy IOR if < 3.0)
uniform float u_dispersionStrength;     // chromaticAberration (0 = off, >0 = 7-band spectral)
uniform float u_fresnelDistanceRange;   // innerShadow radius in CSS pixels
uniform float u_fresnelIntensity;       // innerShadow alpha (0..1)
uniform float u_fresnelEdgeSharpness;   // highlight style: 0 = Default, 1 = Ambient, 2 = Plain
uniform float u_glareDistanceRange;     // highlight width in CSS pixels
uniform float u_glareAngleConvergence;  // highlight falloff (Default = 1.0, ControlCenter = 2.0)
uniform float u_glareOppositeSideBias;  // depthEffect (0.0 or 1.0)
uniform float u_glareIntensity;         // highlight alpha (Default = 0.5, Ambient = 0.38)
uniform float u_glareEdgeSharpness;     // interactive pressProgress (0..1)
uniform float u_glareDirectionOffset;   // highlight angle in radians (default 45 deg = PI/4)
uniform int u_rectangleCount;
uniform vec4 u_rectangles[MAX_RECTANGLES]; // (x, y, width, height) in CSS px
uniform sampler2D u_background;

// =============================================================================
// Exact RoundedRectSDF from Shaders.kt
// =============================================================================

float sdRoundedRect(vec2 coord, vec2 halfSize, float radius) {
  float r = min(radius, min(halfSize.x, halfSize.y));
  vec2 cornerCoord = abs(coord) - (halfSize - vec2(r));
  float outside = length(max(cornerCoord, 0.0)) - r;
  float inside = min(max(cornerCoord.x, cornerCoord.y), 0.0);
  return outside + inside;
}

vec2 gradSdRoundedRect(vec2 coord, vec2 halfSize, float radius) {
  float r = min(radius, min(halfSize.x, halfSize.y));
  vec2 cornerCoord = abs(coord) - (halfSize - vec2(r));
  if (cornerCoord.x >= 0.0 || cornerCoord.y >= 0.0) {
    vec2 m = max(cornerCoord, 0.0);
    float len = length(m);
    return sign(coord) * (len > 1e-5 ? m / len : vec2(0.0, 1.0));
  } else {
    float gradX = step(cornerCoord.y, cornerCoord.x);
    return sign(coord) * vec2(gradX, 1.0 - gradX);
  }
}

float circleMap(float x) {
  float c = clamp(x, 0.0, 1.0);
  return 1.0 - sqrt(max(1.0 - c * c, 0.0));
}

float smoothUnion(float distanceA, float distanceB, float smoothness) {
  float k = max(smoothness, 0.0001);
  float hermite = clamp(0.5 + 0.5 * (distanceB - distanceA) / k, 0.0, 1.0);
  return mix(distanceB, distanceA, hermite) - k * hermite * (1.0 - hermite);
}

// Evaluates single or multi-rect SDF in device pixels.
float evalShapeSDF(vec2 fragCoordPx, out vec2 outCenteredPx, out vec2 outHalfSizePx, out float outRadiusPx) {
  float scale = u_contentsScale;
  float baseRadiusPx = u_cornerRadius * scale;
  outCenteredPx = fragCoordPx - u_resolution * 0.5;
  outHalfSizePx = u_resolution * 0.5;
  outRadiusPx = min(baseRadiusPx, min(outHalfSizePx.x, outHalfSizePx.y));

  if (u_rectangleCount <= 1) {
    vec4 rect = u_rectangleCount == 1 ? u_rectangles[0] : vec4(0.0, 0.0, u_resolution / scale);
    vec2 halfSize = rect.zw * 0.5 * scale;
    vec2 center = rect.xy * scale + halfSize;
    outCenteredPx = fragCoordPx - center;
    outHalfSizePx = halfSize;
    outRadiusPx = min(baseRadiusPx, min(halfSize.x, halfSize.y));
    return sdRoundedRect(outCenteredPx, halfSize, outRadiusPx);
  }

  float smoothnessPx = max(u_shapeMergeSmoothness * u_resolution.y, 0.1);
  float combinedDist = 1e10;
  bool hasShape = false;
  float bestDist = 1e10;

  for (int i = 0; i < MAX_RECTANGLES; ++i) {
    if (i >= u_rectangleCount) break;
    vec4 rect = u_rectangles[i];
    if (rect.z <= 0.0 || rect.w <= 0.0) continue;
    vec2 halfSize = rect.zw * 0.5 * scale;
    vec2 center = rect.xy * scale + halfSize;
    vec2 cCoord = fragCoordPx - center;
    float r = min(baseRadiusPx, min(halfSize.x, halfSize.y));
    float d = sdRoundedRect(cCoord, halfSize, r);
    if (d < bestDist) {
      bestDist = d;
      outCenteredPx = cCoord;
      outHalfSizePx = halfSize;
      outRadiusPx = r;
    }
    if (!hasShape) {
      combinedDist = d;
      hasShape = true;
    } else {
      combinedDist = smoothUnion(combinedDist, d, smoothnessPx);
    }
  }
  return combinedDist;
}

// =============================================================================
// ColorFilter.kt: colorControlsColorFilter (vibrancy = saturation 1.5)
// =============================================================================

vec4 applyColorControls(vec4 color, float saturation, float brightness) {
  float invSat = 1.0 - saturation;
  vec3 lumaWeights = vec3(0.213, 0.715, 0.072);
  float luma = dot(color.rgb, lumaWeights);
  vec3 saturated = mix(vec3(luma), color.rgb, saturation) + vec3(brightness);
  return vec4(clamp(saturated, 0.0, 1.0), color.a);
}

vec4 sampleBackdrop(vec2 uv) {
  vec4 c = texture(u_background, clamp(uv, vec2(0.001), vec2(0.999)));
  float sat = u_backdropTone.x > 0.0 ? u_backdropTone.x : 1.0;
  float bri = (u_backdropTone.y == 1.0 || u_backdropTone.y == 0.0) ? 0.0 : u_backdropTone.y;
  if (sat != 1.0 || bri != 0.0) {
    c = applyColorControls(c, sat, bri);
  }
  return c;
}

void main() {
  vec2 coord = v_uv * u_resolution;
  float scale = u_contentsScale;

  vec2 centeredCoord;
  vec2 halfSize;
  float radius;
  float sd = evalShapeSDF(coord, centeredCoord, halfSize, radius);

  // 1px anti-aliased outer clip matching Compose Outline clip
  if (sd > 0.75) {
    outColor = vec4(0.0);
    return;
  }

  // Resolve refractionHeight and refractionAmount in device pixels
  float refractionHeight = max(u_glassThickness * scale, 1.0);
  // Support both direct pixel refractionAmount (>= 3.0) and legacy IOR (< 3.0)
  float refractionAmount = (u_refractiveIndex >= 3.0 ? u_refractiveIndex : (u_refractiveIndex - 1.0) * 48.0) * scale;
  float depthEffect = clamp(u_glareOppositeSideBias, 0.0, 1.0);

  // Gradient for refraction & highlight (Shaders.kt lines 79-80 & 116-117)
  float gradRadius = min(radius * 1.5, min(halfSize.x, halfSize.y));
  vec2 baseGrad;
  if (u_rectangleCount <= 1) {
    baseGrad = gradSdRoundedRect(centeredCoord, halfSize, gradRadius);
  } else {
    vec2 c1, c2, h1, h2;
    float r1, r2;
    float gx = evalShapeSDF(coord + vec2(1.0, 0.0), c1, h1, r1) - evalShapeSDF(coord - vec2(1.0, 0.0), c2, h2, r2);
    float gy = evalShapeSDF(coord + vec2(0.0, 1.0), c1, h1, r1) - evalShapeSDF(coord - vec2(0.0, 1.0), c2, h2, r2);
    vec2 g = vec2(gx, gy);
    float glen = length(g);
    baseGrad = glen > 1e-5 ? g / glen : gradSdRoundedRect(centeredCoord, halfSize, gradRadius);
  }

  float centerLen = length(centeredCoord);
  vec2 centerDir = centerLen > 1e-5 ? centeredCoord / centerLen : vec2(0.0);
  vec2 combinedGrad = baseGrad + depthEffect * centerDir;
  float combinedLen = length(combinedGrad);
  vec2 grad = combinedLen > 1e-5 ? combinedGrad / combinedLen : baseGrad;

  // ===========================================================================
  // 1. Lens Refraction & 7-Band Chromatic Aberration (Shaders.kt lines 73-157)
  // ===========================================================================
  vec4 color;
  float clampedSd = min(sd, 0.0);
  if (-clampedSd >= refractionHeight || refractionAmount <= 0.0) {
    color = sampleBackdrop(v_uv);
  } else {
    // Lens.kt passes -refractionAmount so d pulls inward along grad
    float d = circleMap(1.0 - (-clampedSd) / refractionHeight) * (-refractionAmount);
    vec2 refractedCoord = coord + d * grad;
    vec2 refractedUv = refractedCoord / u_resolution;

    if (u_dispersionStrength > 0.001) {
      // Shaders.kt line 120:
      // float dispersionIntensity = chromaticAberration * ((centeredCoord.x * centeredCoord.y) / (halfSize.x * halfSize.y));
      float ca = u_dispersionStrength > 1.5 ? 1.0 : u_dispersionStrength;
      float dispersionIntensity = ca * ((centeredCoord.x * centeredCoord.y) / max(halfSize.x * halfSize.y, 1.0));
      vec2 dispersedUv = (d * grad * dispersionIntensity) / u_resolution;

      color = vec4(0.0);

      vec4 red = sampleBackdrop(refractedUv + dispersedUv);
      color.r += red.r / 3.5;
      color.a += red.a / 7.0;

      vec4 orange = sampleBackdrop(refractedUv + dispersedUv * (2.0 / 3.0));
      color.r += orange.r / 3.5;
      color.g += orange.g / 7.0;
      color.a += orange.a / 7.0;

      vec4 yellow = sampleBackdrop(refractedUv + dispersedUv * (1.0 / 3.0));
      color.r += yellow.r / 3.5;
      color.g += yellow.g / 3.5;
      color.a += yellow.a / 7.0;

      vec4 green = sampleBackdrop(refractedUv);
      color.g += green.g / 3.5;
      color.a += green.a / 7.0;

      vec4 cyan = sampleBackdrop(refractedUv - dispersedUv * (1.0 / 3.0));
      color.g += cyan.g / 3.5;
      color.b += cyan.b / 3.0;
      color.a += cyan.a / 7.0;

      vec4 blue = sampleBackdrop(refractedUv - dispersedUv * (2.0 / 3.0));
      color.b += blue.b / 3.0;
      color.a += blue.a / 7.0;

      vec4 purple = sampleBackdrop(refractedUv - dispersedUv);
      color.r += purple.r / 7.0;
      color.b += purple.b / 3.0;
      color.a += purple.a / 7.0;
    } else {
      color = sampleBackdrop(refractedUv);
    }
  }

  // ===========================================================================
  // 2. Surface Overlay (DrawBackdropModifier.kt: onDrawSurface)
  // ===========================================================================
  if (u_materialTint.a > 0.0) {
    color.rgb = mix(color.rgb, u_materialTint.rgb, u_materialTint.a);
  }

  // ===========================================================================
  // 3. InnerShadow (InnerShadow.kt & InnerShadowModifier.kt)
  // ===========================================================================
  if (u_fresnelIntensity > 0.001 && u_fresnelDistanceRange > 0.0) {
    float shadowRadiusPx = u_fresnelDistanceRange * scale;
    // Offset outline by (0, shadowRadiusPx) and blur by shadowRadiusPx
    vec2 offsetCoord = centeredCoord - vec2(0.0, shadowRadiusPx);
    float offsetSd = sdRoundedRect(offsetCoord, halfSize, radius);
    // Inside the main shape, where the shifted shape is near/outside boundary
    float mask = 1.0 - smoothstep(-shadowRadiusPx, shadowRadiusPx * 0.6, -offsetSd);
    float shadowAlpha = mask * 0.15 * clamp(u_fresnelIntensity, 0.0, 1.0);
    color.rgb = mix(color.rgb, vec3(0.0), shadowAlpha);
  }

  // ===========================================================================
  // 4. InteractiveHighlight (InteractiveHighlight.kt)
  // ===========================================================================
  float pressProgress = clamp(u_glareEdgeSharpness, 0.0, 1.0);
  if (pressProgress > 0.001 || (u_touchPoint.x > 0.0 && u_touchPoint.y > 0.0)) {
    float activeProgress = pressProgress > 0.001 ? pressProgress : 1.0;
    vec2 touchPx = u_touchPoint * scale;
    float minDim = min(u_resolution.x, u_resolution.y);
    float spotRadius = minDim * 1.5;
    float dist = distance(coord, touchPx);
    float spotIntensity = smoothstep(spotRadius, spotRadius * 0.5, dist);
    // BlendMode.Plus: 0.08 base + 0.15 radial spotlight
    color.rgb = clamp(color.rgb + vec3(0.08 * activeProgress + 0.15 * activeProgress * spotIntensity), 0.0, 1.0);
  }

  // ===========================================================================
  // 5. Highlight Rim (DefaultHighlightShaderString & AmbientHighlightShaderString)
  // ===========================================================================
  if (u_glareIntensity > 0.001) {
    // HighlightModifier.kt: strokeWidth = ceil(width.toPx()) * 2f clipped to inside of outline
    float strokeWidthPx = max(u_glareDistanceRange, 0.75) * scale * 2.0;
    float rimMask = 1.0 - smoothstep(0.0, strokeWidthPx, -clampedSd);

    float angle = u_glareDirectionOffset;
    vec2 normal = vec2(cos(angle), sin(angle));
    float dDot = dot(baseGrad, normal);
    float falloff = max(u_glareAngleConvergence, 0.01);
    float intensity = pow(max(abs(dDot), 1e-5), falloff);

    float style = u_fresnelEdgeSharpness;
    if (style > 1.5) {
      // HighlightStyle.Plain: uniform additive white rim (alpha = 0.38)
      color.rgb = clamp(color.rgb + vec3(rimMask * u_glareIntensity), 0.0, 1.0);
    } else if (style > 0.5) {
      // HighlightStyle.Ambient: step(0.0, d) -> white on positive half, black on negative half
      float t = step(0.0, dDot);
      float ambAlpha = clamp(rimMask * intensity * u_glareIntensity, 0.0, 1.0);
      color.rgb = mix(color.rgb, vec3(t), ambAlpha);
    } else {
      // HighlightStyle.Default: BlendMode.Plus directional highlight (angle = 45 deg)
      color.rgb = clamp(color.rgb + vec3(rimMask * intensity * u_glareIntensity), 0.0, 1.0);
    }
  }

  // Premultiplied anti-aliased edge
  float edgeAlpha = 1.0 - smoothstep(-0.75, 0.75, sd);
  outColor = vec4(color.rgb * edgeAlpha, edgeAlpha);
}`;

// Separable Gaussian blur matching Blur.kt
export const BLUR_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_source;
uniform vec2 u_axisStep;
uniform float u_sigma;
uniform float u_radius;

const int MAX_TAPS = 24;

void main() {
  float radius = min(u_radius, float(MAX_TAPS));
  int taps = int(ceil(radius));
  float safeSigma = max(u_sigma, 0.0001);

  vec4 sum = texture(u_source, v_uv);
  float weightSum = 1.0;

  for (int i = 1; i <= MAX_TAPS; ++i) {
    if (i > taps) {
      break;
    }
    float offset = min(float(i), radius);
    float weight = exp(-0.5 * offset * offset / (safeSigma * safeSigma));
    sum += texture(u_source, clamp(v_uv + u_axisStep * offset, vec2(0.001), vec2(0.999))) * weight;
    sum += texture(u_source, clamp(v_uv - u_axisStep * offset, vec2(0.001), vec2(0.999))) * weight;
    weightSum += 2.0 * weight;
  }

  outColor = sum / weightSum;
}`;
