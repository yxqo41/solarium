/* solarium — a JavaScript port of LiquidGlassKit
 * (https://github.com/DnV1eX/LiquidGlassKit, Swift + Metal).
 *
 * The Metal original owns a device, a command queue and a blur pipeline shared
 * by every glass view. A canvas on the web is bound to exactly one WebGL
 * context, so each glass view gets its own renderer, and `LiquidGlassRenderer`
 * is that per-view bundle: program, uniforms, the captured backdrop and the
 * two framebuffers the blur ping-pongs through.
 *
 * `ZeroCopyBridge` has no counterpart here and is not ported: the backdrop
 * arrives as a canvas that is drawn with drawImage and uploaded with
 * texImage2D, which is already the cheapest path available in a browser.
 */

import { MAX_RECTANGLES } from './liquid-glass.js';
import { BLUR_SHADER, FRAGMENT_SHADER, VERTEX_SHADER } from './shaders.js';

// 16 rectangles of 4 floats each, matching the shader's uniform array.
const MAX_RECTANGLE_FLOATS = MAX_RECTANGLES * 4;

const UNIFORM_NAMES = [
  'u_resolution',
  'u_contentsScale',
  'u_touchPoint',
  'u_shapeMergeSmoothness',
  'u_cornerRadius',
  'u_cornerRoundnessExponent',
  'u_materialTint',
  'u_backdropTone',
  'u_glassThickness',
  'u_refractiveIndex',
  'u_dispersionStrength',
  'u_fresnelDistanceRange',
  'u_fresnelIntensity',
  'u_fresnelEdgeSharpness',
  'u_glareDistanceRange',
  'u_glareAngleConvergence',
  'u_glareOppositeSideBias',
  'u_glareIntensity',
  'u_glareEdgeSharpness',
  'u_glareDirectionOffset',
];

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`solarium: shader compilation failed — ${log}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || 'unknown error';
    gl.deleteProgram(program);
    throw new Error(`solarium: program link failed — ${log}`);
  }
  return program;
}

export class LiquidGlassRenderer {
  // Probing is cached because constructing a throwaway context per control is
  // both slow and, in some browsers, rate-limited.
  static isSupported() {
    if (LiquidGlassRenderer.supported === undefined) {
      LiquidGlassRenderer.supported = Boolean(document.createElement('canvas').getContext('webgl2'));
    }
    return LiquidGlassRenderer.supported;
  }

  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      // The shader writes premultiplied colours (the edge anti-aliasing fades
      // RGB and alpha together), so the context has to agree.
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) {
      throw new Error('solarium: WebGL2 is unavailable');
    }

    this.gl = gl;
    this.canvas = canvas;
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.blurProgram = createProgram(gl, VERTEX_SHADER, BLUR_SHADER);
    this.vao = gl.createVertexArray();

    this.locations = {};
    for (const name of UNIFORM_NAMES) {
      // A uniform the shader does not read (u_touchPoint today) is optimised
      // out and reports a null location; the setters below skip those.
      this.locations[name] = gl.getUniformLocation(this.program, name);
    }
    this.rectanglesLocation = gl.getUniformLocation(this.program, 'u_rectangles');
    this.backgroundLocation = gl.getUniformLocation(this.program, 'u_background');

    this.blurLocations = {
      source: gl.getUniformLocation(this.blurProgram, 'u_source'),
      axisStep: gl.getUniformLocation(this.blurProgram, 'u_axisStep'),
      sigma: gl.getUniformLocation(this.blurProgram, 'u_sigma'),
      radius: gl.getUniformLocation(this.blurProgram, 'u_radius'),
    };

    this.backgroundTexture = this.createTexture();
    this.backgroundWidth = 0;
    this.backgroundHeight = 0;
    this.hasBackground = false;
    this.blurTargets = [null, null];
    this.rectangles = new Float32Array(MAX_RECTANGLE_FLOATS);

    // Uploading top row first is what the vertex shader's flipped UVs expect.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  createTexture() {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  // Takes the already-rendered capture canvas, mirroring the texture the
  // original's zero-copy bridge produces.
  setBackground(source) {
    const gl = this.gl;
    const width = source.width;
    const height = source.height;
    if (!width || !height) {
      return;
    }

    gl.bindTexture(gl.TEXTURE_2D, this.backgroundTexture);
    const resized = this.backgroundWidth !== width || this.backgroundHeight !== height;
    if (resized) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    this.hasBackground = true;

    if (resized) {
      this.backgroundWidth = width;
      this.backgroundHeight = height;
      this.disposeTargets();
    }
  }

  resize(width, height) {
    if (this.canvas.width !== width) {
      this.canvas.width = width;
    }
    if (this.canvas.height !== height) {
      this.canvas.height = height;
    }
  }

  draw(uniforms, blurSigma) {
    if (!this.hasBackground) {
      return;
    }

    const gl = this.gl;
    const background = blurSigma > 0 ? this.blur(blurSigma) : this.backgroundTexture;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    this.setUniforms(uniforms);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, background);
    if (this.backgroundLocation) {
      gl.uniform1i(this.backgroundLocation, 0);
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  setUniforms(uniforms) {
    const gl = this.gl;
    const locations = this.locations;
    const set = (name, upload) => {
      const location = locations[name];
      if (location) {
        upload(location);
      }
    };

    set('u_resolution', location => gl.uniform2fv(location, uniforms.resolution));
    set('u_contentsScale', location => gl.uniform1f(location, uniforms.contentsScale));
    set('u_touchPoint', location => gl.uniform2fv(location, uniforms.touchPoint));
    set('u_shapeMergeSmoothness', location => gl.uniform1f(location, uniforms.shapeMergeSmoothness));
    set('u_cornerRadius', location => gl.uniform1f(location, uniforms.cornerRadius));
    set('u_cornerRoundnessExponent', location => gl.uniform1f(location, uniforms.cornerRoundnessExponent));
    set('u_materialTint', location => gl.uniform4fv(location, uniforms.materialTint));
    set('u_backdropTone', location => gl.uniform2fv(location, uniforms.backdropTone));
    set('u_glassThickness', location => gl.uniform1f(location, uniforms.glassThickness));
    set('u_refractiveIndex', location => gl.uniform1f(location, uniforms.refractiveIndex));
    set('u_dispersionStrength', location => gl.uniform1f(location, uniforms.dispersionStrength));
    set('u_fresnelDistanceRange', location => gl.uniform1f(location, uniforms.fresnelDistanceRange));
    set('u_fresnelIntensity', location => gl.uniform1f(location, uniforms.fresnelIntensity));
    set('u_fresnelEdgeSharpness', location => gl.uniform1f(location, uniforms.fresnelEdgeSharpness));
    set('u_glareDistanceRange', location => gl.uniform1f(location, uniforms.glareDistanceRange));
    set('u_glareAngleConvergence', location => gl.uniform1f(location, uniforms.glareAngleConvergence));
    set('u_glareOppositeSideBias', location => gl.uniform1f(location, uniforms.glareOppositeSideBias));
    set('u_glareIntensity', location => gl.uniform1f(location, uniforms.glareIntensity));
    set('u_glareEdgeSharpness', location => gl.uniform1f(location, uniforms.glareEdgeSharpness));
    set('u_glareDirectionOffset', location => gl.uniform1f(location, uniforms.glareDirectionOffset));

    // The whole array is uploaded in one call: dynamic indexing of a uniform
    // array is not portable when the elements are set individually.
    const rects = uniforms.rectangles;
    const count = Math.min(rects.length, MAX_RECTANGLES);
    this.rectangles.fill(0);
    for (let i = 0; i < count; i += 1) {
      const rect = rects[i];
      this.rectangles[i * 4] = rect.x;
      this.rectangles[i * 4 + 1] = rect.y;
      this.rectangles[i * 4 + 2] = rect.width;
      this.rectangles[i * 4 + 3] = rect.height;
    }
    if (this.rectanglesLocation) {
      gl.uniform4fv(this.rectanglesLocation, this.rectangles);
    }
    if (this.locations.u_rectangleCount === undefined) {
      this.locations.u_rectangleCount = gl.getUniformLocation(this.program, 'u_rectangleCount');
    }
    if (this.locations.u_rectangleCount) {
      gl.uniform1i(this.locations.u_rectangleCount, count);
    }
  }

  // Two passes, horizontal then vertical. An even number of passes also keeps
  // the image upright without extra bookkeeping: each pass into a framebuffer
  // flips rows, because the shader's UVs are upper-left while a framebuffer's
  // first row is its bottom.
  blur(sigma) {
    const gl = this.gl;
    const targets = this.ensureTargets();
    if (!targets) {
      return this.backgroundTexture;
    }

    const radius = Math.min(Math.max(sigma * 3, 1), 24);
    gl.useProgram(this.blurProgram);
    gl.uniform1f(this.blurLocations.sigma, sigma);
    gl.uniform1f(this.blurLocations.radius, radius);
    gl.uniform1i(this.blurLocations.source, 0);

    const passes = [
      { target: targets[0], step: [1 / this.backgroundWidth, 0] },
      { target: targets[1], step: [0, 1 / this.backgroundHeight] },
    ];

    let source = this.backgroundTexture;
    for (const pass of passes) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, pass.target.framebuffer);
      gl.viewport(0, 0, this.backgroundWidth, this.backgroundHeight);
      gl.uniform2fv(this.blurLocations.axisStep, pass.step);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      source = pass.target.texture;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    return source;
  }

  ensureTargets() {
    if (!this.backgroundWidth || !this.backgroundHeight) {
      return null;
    }
    if (this.blurTargets[0]) {
      return this.blurTargets;
    }

    const gl = this.gl;
    this.blurTargets = [0, 1].map(() => {
      const texture = this.createTexture();
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        this.backgroundWidth, this.backgroundHeight, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null
      );
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { texture, framebuffer };
    });
    return this.blurTargets;
  }

  disposeTargets() {
    const gl = this.gl;
    for (const target of this.blurTargets) {
      if (target) {
        gl.deleteFramebuffer(target.framebuffer);
        gl.deleteTexture(target.texture);
      }
    }
    this.blurTargets = [null, null];
  }

  dispose() {
    const gl = this.gl;
    this.disposeTargets();
    gl.deleteTexture(this.backgroundTexture);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.blurProgram);
    this.hasBackground = false;
  }
}
