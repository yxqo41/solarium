/* solarium — 1:1 WebGL2 port of AndroidLiquidGlass (com.kyant.backdrop)
 *
 * `LiquidGlass` is the material description matching AndroidLiquidGlass's
 * BackdropEffectScope (`vibrancy`, `blur`, `lens(refractionHeight, refractionAmount,
 * depthEffect, chromaticAberration)`), `Highlight` (`Default`, `Ambient`, `Plain`),
 * `InnerShadow`, and `onDrawSurface`.
 */

// Must match MAX_RECTANGLES in shaders.js.
export const MAX_RECTANGLES = 16;

const BASE_UNIFORMS = {
  resolution: [0, 0],
  contentsScale: 1,
  touchPoint: [0, 0],
  shapeMergeSmoothness: 0.2,
  cornerRadius: 0,
  cornerRoundnessExponent: 2,
  materialTint: [0, 0, 0, 0],
  glassThickness: 16,               // refractionHeight in CSS px
  refractiveIndex: 32,              // refractionAmount in CSS px
  dispersionStrength: 0,            // chromaticAberration (0 = off, 1 = 7-band spectral)
  fresnelDistanceRange: 4,          // innerShadow radius in CSS px
  fresnelIntensity: 0,              // innerShadow alpha (0..1)
  fresnelEdgeSharpness: 0,          // highlight style: 0 = Default, 1 = Ambient, 2 = Plain
  glareDistanceRange: 0.75,         // highlight width in CSS px (0.5dp..1dp)
  glareAngleConvergence: 1.0,       // highlight falloff (Default = 1.0, ControlCenter = 2.0)
  glareOppositeSideBias: 0,         // depthEffect (0 = off, 1 = on)
  glareIntensity: 0.5,              // highlight alpha (Default = 0.5, Ambient = 0.38, Plain = 0.38)
  glareEdgeSharpness: 0,            // interactive pressProgress (0..1)
  glareDirectionOffset: Math.PI / 4,// highlight angle (45 deg = PI / 4)
  rectangles: [],
};

export class LiquidGlass {
  constructor({
    uniforms = {},
    backgroundTextureSizeCoefficient = 1,
    backgroundTextureScaleCoefficient = 1,
    backgroundTextureBlurRadius = 0,
    tintColor = null,
    shadowOverlay = false,
    backdropTone = null,
    interactive = false,
  } = {}) {
    this.uniforms = { ...BASE_UNIFORMS, ...uniforms };
    this.backgroundTextureSizeCoefficient = backgroundTextureSizeCoefficient;
    this.backgroundTextureScaleCoefficient = backgroundTextureScaleCoefficient;
    this.backgroundTextureBlurRadius = backgroundTextureBlurRadius;
    this.tintColor = tintColor;
    this.shadowOverlay = shadowOverlay;
    this.backdropTone = backdropTone;
    this.interactive = interactive;
  }

  // Matches LiquidSlider.kt & LiquidToggle.kt:
  // lens(10.dp, 14.dp, chromaticAberration = true) for slider
  // lens(5.dp, 10.dp, chromaticAberration = true) for toggle
  // Highlight.Ambient (style = 1, alpha = 0.38), InnerShadow(radius = 4.dp, alpha = 1)
  static thumb({ magnification = 1 } = {}) {
    return new LiquidGlass({
      uniforms: {
        materialTint: [0.9, 0.95, 1.0, 0.12],
        glassThickness: 12,
        refractiveIndex: 28,
        dispersionStrength: 1.0,
        fresnelDistanceRange: 4,
        fresnelIntensity: 0.7,
        fresnelEdgeSharpness: 0,
        glareDistanceRange: 0.85,
        glareAngleConvergence: 1.0,
        glareOppositeSideBias: 0,
        glareIntensity: 0.65,
        glareEdgeSharpness: 0,
        glareDirectionOffset: Math.PI / 4,
      },
      backgroundTextureSizeCoefficient: 1 / magnification,
      backgroundTextureScaleCoefficient: magnification,
      backgroundTextureBlurRadius: 0,
      backdropTone: [1.35, 0.0],
      shadowOverlay: true,
    });
  }

  // Matches LiquidBottomTabs.kt & MagnifierContent.kt:
  // lens(10.dp, 14.dp, chromaticAberration = true), Highlight.Default, InnerShadow(8.dp)
  static lens() {
    return new LiquidGlass({
      uniforms: {
        materialTint: [0, 0, 0, 0.03],
        glassThickness: 12,
        refractiveIndex: 24,
        dispersionStrength: 1.0,
        fresnelDistanceRange: 8,
        fresnelIntensity: 0.8,
        fresnelEdgeSharpness: 0, // Highlight.Default
        glareDistanceRange: 0.85,
        glareAngleConvergence: 1.0,
        glareOppositeSideBias: 0,
        glareIntensity: 0.65,
        glareEdgeSharpness: 0,
        glareDirectionOffset: Math.PI / 4,
      },
      backgroundTextureSizeCoefficient: 1.1,
      backgroundTextureScaleCoefficient: 1,
      backgroundTextureBlurRadius: 0,
      backdropTone: [1.35, 0.0],
      shadowOverlay: true,
    });
  }

  // Matches DialogContent.kt & GlassPlaygroundContent.kt & LiquidBottomTabs container:
  // vibrancy() (saturation = 1.5), minimal blur,
  // lens(24.dp, 48.dp, depthEffect = true), Highlight.Default
  static regular() {
    return new LiquidGlass({
      uniforms: {
        glassThickness: 24,
        refractiveIndex: 48,
        dispersionStrength: 1.0,
        fresnelDistanceRange: 8,
        fresnelIntensity: 0.5,
        fresnelEdgeSharpness: 0, // Highlight.Default
        glareDistanceRange: 0.9,
        glareAngleConvergence: 1.0,
        glareOppositeSideBias: 1, // depthEffect = true
        glareIntensity: 0.65,
        glareEdgeSharpness: 0,
        glareDirectionOffset: Math.PI / 4,
      },
      backgroundTextureSizeCoefficient: 1,
      backgroundTextureScaleCoefficient: 1,
      backgroundTextureBlurRadius: 0.5,
      backdropTone: isDark => (isDark ? [1.5, 0.0] : [1.5, 0.05]),
      tintColor: isDark => (isDark
        ? [0.06, 0.08, 0.14, 0.18]
        : [0.96, 0.98, 1.0, 0.22]),
      shadowOverlay: true,
    });
  }

  // Matches LiquidButton.kt & ControlCenterContent.kt:
  // vibrancy() (saturation = 1.5), minimal blur, lens(14.dp, 28.dp), Highlight.Default
  static clear() {
    return new LiquidGlass({
      uniforms: {
        glassThickness: 14,
        refractiveIndex: 28,
        dispersionStrength: 1.0,
        fresnelDistanceRange: 6,
        fresnelIntensity: 0.5,
        fresnelEdgeSharpness: 0, // Highlight.Default
        glareDistanceRange: 0.9,
        glareAngleConvergence: 1.0,
        glareOppositeSideBias: 1,
        glareIntensity: 0.7,
        glareEdgeSharpness: 0,
        glareDirectionOffset: Math.PI / 4,
      },
      backgroundTextureSizeCoefficient: 1,
      backgroundTextureScaleCoefficient: 1,
      backgroundTextureBlurRadius: 0.2,
      backdropTone: [1.5, 0.0],
      tintColor: [1, 1, 1, 0.08],
      shadowOverlay: true,
      interactive: true,
    });
  }

  static button() {
    return LiquidGlass.clear();
  }

  resolveBackdropTone(isDark) {
    return (typeof this.backdropTone === 'function' ? this.backdropTone(isDark) : this.backdropTone) ?? [1, 0];
  }

  resolveTint(isDark) {
    const tint = typeof this.tintColor === 'function' ? this.tintColor(isDark) : this.tintColor;
    return tint ?? this.uniforms.materialTint;
  }
}
