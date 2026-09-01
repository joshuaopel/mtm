// SPDX-License-Identifier: MIT
using UnityEngine;
using UnityEngine.UI;

namespace MonsterTruckMania.Rendering
{
    /// <summary>
    /// Renders the game at a low resolution and puts it on screen through the
    /// dither and quantise pass.
    /// </summary>
    /// <remarks>
    /// The geometry is genuinely rasterised small — 320x240 by default — and
    /// then scaled up with point filtering. That matters: most of the period
    /// character comes from triangles being rasterised at low resolution, and
    /// a filter over a crisp modern render does not look the same. It is also
    /// what makes the vertex snapping in the shaders visible at all.
    /// <para/>
    /// The presentation is a Canvas with a RawImage rather than a URP Renderer
    /// Feature or an <c>OnPostRender</c> blit. Renderer Features moved to
    /// RenderGraph in Unity 6 and the API is still settling, and
    /// <c>OnPostRender</c> does not fire under URP at all — it is a built-in
    /// pipeline callback, and using it here would produce a black screen with
    /// no error to explain it. A Canvas works in every pipeline and every
    /// version.
    /// </remarks>
    [ExecuteAlways]
    [RequireComponent(typeof(Camera))]
    [AddComponentMenu("Monster Truck Mania/Retro Camera")]
    public class RetroCamera : MonoBehaviour
    {
        public enum Preset { Playstation240, Playstation480, Native }

        [Header("Resolution")]
        public Preset preset = Preset.Playstation240;
        [Tooltip("Used when the preset is Native. Width follows from the " +
                 "display aspect, so the image is never stretched.")]
        [Range(120, 1080)] public int customHeight = 240;

        [Header("Look")]
        [Tooltip("Material using Monster Truck Mania/Retro Blit.")]
        public Material blitMaterial;
        [Tooltip("Colour levels per channel. 32 matches the console's 15-bit framebuffer.")]
        [Range(2, 64)] public int colourLevels = 32;
        [Range(0f, 2f)] public float dither = 1f;
        [Range(0f, 0.5f)] public float scanline = 0.06f;
        [Range(0f, 1f)] public float vignette = 0.22f;

        private Camera _camera;
        private RenderTexture _target;
        private Canvas _canvas;
        private RawImage _image;
        private int _builtWidth, _builtHeight;

        private static readonly int LevelsId = Shader.PropertyToID("_Levels");
        private static readonly int DitherId = Shader.PropertyToID("_DitherStrength");
        private static readonly int ScanlineId = Shader.PropertyToID("_Scanline");
        private static readonly int VignetteId = Shader.PropertyToID("_Vignette");

        private int TargetHeight => preset switch
        {
            Preset.Playstation240 => 240,
            Preset.Playstation480 => 480,
            _ => customHeight,
        };

        private void OnEnable()
        {
            _camera = GetComponent<Camera>();
            Refresh();
        }

        private void OnDisable() => Release();

        private void LateUpdate() => Refresh();

        private void Refresh()
        {
            EnsureTarget();
            EnsureCanvas();
            PushSettings();
        }

        private void EnsureTarget()
        {
            if (_camera == null) _camera = GetComponent<Camera>();

            int height = Mathf.Max(16, TargetHeight);
            float aspect = Screen.height > 0 ? (float)Screen.width / Screen.height : 4f / 3f;
            int width = Mathf.Max(16, Mathf.RoundToInt(height * aspect));

            if (_target != null && _builtWidth == width && _builtHeight == height)
            {
                // Unity drops render textures on some events (resolution
                // changes, entering play mode); recreate rather than render
                // into a dead handle.
                if (_target.IsCreated()) return;
            }

            Release();

            _target = new RenderTexture(width, height, 24, RenderTextureFormat.Default)
            {
                name = "MTM_RetroTarget",
                // Point filtering is not optional. Bilinear turns the chunky
                // pixels into a blur and throws away the entire look.
                filterMode = FilterMode.Point,
                wrapMode = TextureWrapMode.Clamp,
                antiAliasing = 1,
                useMipMap = false,
            };
            _target.Create();
            _builtWidth = width;
            _builtHeight = height;
            _camera.targetTexture = _target;
        }

        private void EnsureCanvas()
        {
            if (_canvas == null)
            {
                Transform existing = transform.Find("RetroPresent");
                GameObject go = existing != null
                    ? existing.gameObject
                    : new GameObject("RetroPresent", typeof(Canvas), typeof(RawImage));
                go.transform.SetParent(transform, false);

                // Explicit rather than ??: Unity overloads == on Object, and
                // relying on null-coalescing around it is the kind of thing
                // that works until the object is destroyed rather than absent.
                _canvas = go.GetComponent<Canvas>();
                if (_canvas == null) _canvas = go.AddComponent<Canvas>();
                _image = go.GetComponent<RawImage>();
                if (_image == null) _image = go.AddComponent<RawImage>();

                _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
                // Above anything the game puts on screen, since this is the
                // game's picture rather than an overlay on it.
                _canvas.sortingOrder = -100;
            }

            if (_image == null) return;

            _image.texture = _target;
            _image.material = blitMaterial;
            _image.raycastTarget = false;

            var rect = _image.rectTransform;
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
        }

        private void PushSettings()
        {
            if (blitMaterial == null) return;
            blitMaterial.SetFloat(LevelsId, colourLevels);
            blitMaterial.SetFloat(DitherId, dither);
            blitMaterial.SetFloat(ScanlineId, scanline);
            blitMaterial.SetFloat(VignetteId, vignette);
        }

        private void Release()
        {
            if (_camera != null && _camera.targetTexture == _target) _camera.targetTexture = null;
            if (_target == null) return;

            _target.Release();
            if (Application.isPlaying) Destroy(_target); else DestroyImmediate(_target);
            _target = null;
            _builtWidth = _builtHeight = 0;
        }
    }
}
