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

/**
 * Rear-view mirror geometry.
 *
 * Deliberately tiny — a period-correct mirror was a strip of pixels, and
 * rendering the whole world a second time at full resolution would roughly
 * halve the frame rate for something you glance at.
 */
const MIRROR_ASPECT = 3.2;
const MIRROR_WIDTH = 256;
const MIRROR_HEIGHT = Math.round(MIRROR_WIDTH / MIRROR_ASPECT);
/** Width of the mirror in clip space, i.e. a fraction of the screen width. */
const MIRROR_CLIP_WIDTH = 0.62;
const MIRROR_TOP_MARGIN = 0.035;

/**
 * Fullscreen pass: writes clip-space coordinates directly and ignores the
 * model matrix entirely, so the quad always covers the viewport.
 */
const BLIT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Inset pass, for the mirror. Identical output except that it *does* respect
 * the object transform — without this the mirror inherits the fullscreen
 * shader above and paints itself over the entire scene.
 */
const INSET_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BLIT_FRAG = /* glsl */ `
precision mediump float;

uniform sampler2D tSource;
uniform float uLevels;
uniform float uScanline;
uniform float uVignette;
uniform vec2 uSourceSize;
// 1.0 for the rear-view mirror, which reverses left and right like glass.
uniform float uFlipX;

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
  vec2 uv = vec2(mix(vUv.x, 1.0 - vUv.x, uFlipX), vUv.y);
  vec3 color = texture2D(tSource, uv).rgb;

  // The scene target holds linear light, and three only applies the output
  // transform when rendering straight to the canvas — not through an
  // intermediate target. We convert here instead, before quantising, so the
  // colour steps land where the eye expects them and the picture isn't dark.
  color = pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.2));

  // Dither in source-pixel space so the pattern stays locked to the chunky
  // pixels rather than crawling across the upscaled image.
  vec2 sourcePixel = uv * uSourceSize;
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

  /** Rear-view mirror: its own low-res target composited over the main image. */
  private mirrorTarget: THREE.WebGLRenderTarget;
  private mirrorMaterial: THREE.ShaderMaterial;
  private mirrorQuad: THREE.Mesh;
  private mirrorFrame: THREE.Mesh;
  private mirrorEnabled = true;
  /** Drawn this frame — false when no mirror camera was supplied. */
  private mirrorVisible = false;

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
        uFlipX: { value: 0 },
      },
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial);
    quad.frustumCulled = false;
    this.blitScene.add(quad);

    // --- rear-view mirror ---------------------------------------------
    this.mirrorTarget = new THREE.WebGLRenderTarget(MIRROR_WIDTH, MIRROR_HEIGHT, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
      type: THREE.UnsignedByteType,
    });
    this.mirrorTarget.texture.colorSpace = THREE.NoColorSpace;

    this.mirrorMaterial = new THREE.ShaderMaterial({
      vertexShader: INSET_VERT,
      fragmentShader: BLIT_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tSource: { value: this.mirrorTarget.texture },
        uLevels: { value: COLOR_LEVELS.lo },
        uScanline: { value: 0.05 },
        // No vignette: the mirror is small, and darkening its corners just
        // makes it harder to spot a truck coming up behind you.
        uVignette: { value: 0.0 },
        uSourceSize: { value: new THREE.Vector2(MIRROR_WIDTH, MIRROR_HEIGHT) },
        uFlipX: { value: 1 },
      },
    });

    // Uses INSET_VERT, so its position and scale below are honoured and it
    // lands as a small panel rather than covering the screen.
    this.mirrorQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mirrorMaterial);
    this.mirrorQuad.frustumCulled = false;
    this.mirrorQuad.renderOrder = 2;

    this.mirrorFrame = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x14140f }),
    );
    this.mirrorFrame.frustumCulled = false;
    this.mirrorFrame.renderOrder = 1;

    this.blitScene.add(this.mirrorFrame);
    this.blitScene.add(this.mirrorQuad);
    this.layoutMirror();
  }

  /**
   * Size and place the mirror in clip space.
   *
   * Clip space is -1..1 on both axes regardless of the window shape, so a
   * quad's on-screen aspect is (width / height) * screenAspect. The height is
   * solved from that to keep the mirror showing its true 3:1 view instead of
   * being stretched by the window.
   */
  private layoutMirror(): void {
    const screenAspect = this.cssWidth / this.cssHeight;
    const width = MIRROR_CLIP_WIDTH;
    const height = (width * screenAspect) / MIRROR_ASPECT;
    const centreY = 1 - height / 2 - MIRROR_TOP_MARGIN;

    this.mirrorQuad.scale.set(width, height, 1);
    this.mirrorQuad.position.set(0, centreY, 0);

    // A couple of pixels of surround, sized in each axis so the border reads
    // as even thickness on screen.
    const borderX = 0.012;
    const borderY = borderX * screenAspect;
    this.mirrorFrame.scale.set(width + borderX, height + borderY, 1);
    this.mirrorFrame.position.set(0, centreY, 0);
  }

  /** Show or hide the rear-view mirror. */
  setMirrorEnabled(enabled: boolean): void {
    this.mirrorEnabled = enabled;
  }

  get isMirrorEnabled(): boolean {
    return this.mirrorEnabled;
  }

  /** Aspect ratio the mirror camera should use. */
  get mirrorAspect(): number {
    return MIRROR_ASPECT;
  }

  setDetail(detail: DetailLevel): void {
    this.detail = detail;
    this.blitMaterial.uniforms.uLevels.value = COLOR_LEVELS[detail];
    this.blitMaterial.uniforms.uScanline.value = detail === 'lo' ? 0.06 : 0.03;
    this.mirrorMaterial.uniforms.uLevels.value = COLOR_LEVELS[detail];
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
    this.layoutMirror();
  }

  /**
   * Draw the scene, optionally with a rear-view mirror inset.
   *
   * The mirror is a second full pass over the scene from a backward-facing
   * camera, so it costs roughly what its pixel count costs — which is why the
   * mirror target is small.
   */
  render(scene: THREE.Scene, camera: THREE.Camera, mirrorCamera?: THREE.Camera | null): void {
    const showMirror = this.mirrorEnabled && !!mirrorCamera;

    if (showMirror && mirrorCamera) {
      this.renderer.setRenderTarget(this.mirrorTarget);
      this.renderer.clear();
      this.renderer.render(scene, mirrorCamera);
    }

    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    // Toggle visibility rather than adding and removing from the scene, so
    // the mirror's material and geometry stay warm between frames.
    if (showMirror !== this.mirrorVisible) {
      this.mirrorVisible = showMirror;
      this.mirrorQuad.visible = showMirror;
      this.mirrorFrame.visible = showMirror;
    }

    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.blitScene, this.blitCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.blitMaterial.dispose();
    this.mirrorTarget.dispose();
    this.mirrorMaterial.dispose();
    this.mirrorQuad.geometry.dispose();
    this.mirrorFrame.geometry.dispose();
    (this.mirrorFrame.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
