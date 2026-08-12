import * as THREE from 'three';

/**
 * The look of the thing.
 *
 * Mid-90s 3D racers ran at 320x240 or 640x480 into a 16-bit framebuffer, so
 * everything was chunky, dithered and drowned in fog to hide the draw
 * distance. We reproduce that honestly: render the scene into a small
 * offscreen target with nearest-neighbour filtering, then blit it up to the
 * display through a shader that ordered-dithers and quantises the colour.
 *
 * Doing it this way (rather than faking it with a CSS filter) means the
 * geometry itself is rasterised at low resolution, which is where most of the
 * period-correct character actually comes from.
 */

export type DetailLevel = 'lo' | 'med' | 'hi';

/** Internal vertical resolution for each detail level. */
const VERTICAL_RES: Record<DetailLevel, number> = {
  lo: 240,
  med: 360,
  hi: 540,
};

/** Colour levels per channel. 32 approximates a 16-bit (5-6-5) framebuffer. */
const COLOR_LEVELS: Record<DetailLevel, number> = {
  lo: 16,
  med: 32,
  hi: 64,
};

const BLIT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BLIT_FRAG = /* glsl */ `
precision mediump float;

uniform sampler2D tSource;
uniform float uLevels;
uniform float uScanline;
uniform float uVignette;
uniform vec2 uSourceSize;

varying vec2 vUv;

// 4x4 ordered (Bayer) dither matrix, normalised to -0.5..0.5.
float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = y * 4 + x;
  float m =
    i == 0  ?  0.0 : i == 1  ?  8.0 : i == 2  ?  2.0 : i == 3  ? 10.0 :
    i == 4  ? 12.0 : i == 5  ?  4.0 : i == 6  ? 14.0 : i == 7  ?  6.0 :
    i == 8  ?  3.0 : i == 9  ? 11.0 : i == 10 ?  1.0 : i == 11 ?  9.0 :
    i == 12 ? 15.0 : i == 13 ?  7.0 : i == 14 ? 13.0 : 5.0;
  return (m / 16.0) - 0.5;
}

void main() {
  vec3 color = texture2D(tSource, vUv).rgb;

  // The scene target holds linear light, and three only applies the output
  // transform when rendering straight to the canvas — not through an
  // intermediate target. We convert here instead, before quantising, so the
  // colour steps land where the eye expects them and the picture isn't dark.
  color = pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.2));

  // Dither in source-pixel space so the pattern stays locked to the chunky
  // pixels rather than crawling across the upscaled image.
  vec2 sourcePixel = vUv * uSourceSize;
  float d = bayer4(floor(sourcePixel)) / uLevels;

  color = floor(color * uLevels + 0.5 + d * uLevels * 0.9) / uLevels;

  // Faint horizontal banding, as if the desktop CRT was never quite in sync.
  float scan = 1.0 - uScanline * step(1.0, mod(sourcePixel.y, 2.0));
  color *= scan;

  float v = distance(vUv, vec2(0.5));
  color *= 1.0 - uVignette * v * v;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

export class RetroRenderer {
  readonly renderer: THREE.WebGLRenderer;

  private target: THREE.WebGLRenderTarget;
  private blitScene = new THREE.Scene();
  private blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blitMaterial: THREE.ShaderMaterial;

  private detail: DetailLevel = 'lo';
  private cssWidth = 1;
  private cssHeight = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1); // the low-res target is our resolution
    this.renderer.autoClear = true;
    this.renderer.shadowMap.enabled = false;

    this.target = new THREE.WebGLRenderTarget(320, 240, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
      type: THREE.UnsignedByteType,
    });
    // The blit shader does the linear-to-display conversion itself, so the
    // target must be sampled raw rather than being decoded a second time.
    this.target.texture.colorSpace = THREE.NoColorSpace;

    this.blitMaterial = new THREE.ShaderMaterial({
      vertexShader: BLIT_VERT,
      fragmentShader: BLIT_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tSource: { value: this.target.texture },
        uLevels: { value: COLOR_LEVELS.lo },
        uScanline: { value: 0.06 },
        uVignette: { value: 0.22 },
        uSourceSize: { value: new THREE.Vector2(320, 240) },
      },
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial);
    quad.frustumCulled = false;
    this.blitScene.add(quad);
  }

  setDetail(detail: DetailLevel): void {
    this.detail = detail;
    this.blitMaterial.uniforms.uLevels.value = COLOR_LEVELS[detail];
    this.blitMaterial.uniforms.uScanline.value = detail === 'lo' ? 0.06 : 0.03;
    this.resize(this.cssWidth, this.cssHeight);
  }

  getDetail(): DetailLevel {
    return this.detail;
  }

  /** Aspect ratio of the internal buffer, for the camera. */
  get aspect(): number {
    return this.target.width / this.target.height;
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.renderer.setSize(this.cssWidth, this.cssHeight, false);

    const aspect = this.cssWidth / this.cssHeight;
    const height = VERTICAL_RES[this.detail];
    // Round to even numbers; odd buffer widths make the dither pattern shimmer
    // when it lands on half-pixel boundaries during the upscale.
    const width = Math.max(2, Math.round((height * aspect) / 2) * 2);

    this.target.setSize(width, height);
    this.blitMaterial.uniforms.uSourceSize.value.set(width, height);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.blitScene, this.blitCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.blitMaterial.dispose();
    this.renderer.dispose();
  }
}
