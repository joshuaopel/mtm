// SPDX-License-Identifier: MIT
#ifndef MTM_RETRO_INCLUDED
#define MTM_RETRO_INCLUDED

// Shared PS1 vertex maths, so the terrain, the props and the vehicles all
// wobble by the same rules. A mismatch here is immediately visible: geometry
// that snaps against geometry that does not looks broken rather than retro.

/// Quantise a clip-space position onto a low-resolution screen grid.
///
/// The console transformed vertices with fixed-point integer maths and had no
/// sub-pixel precision, so vertices landed on whole pixels of a 320x240-ish
/// screen. As the camera moves they jump between pixels, which is the source
/// of the characteristic wobble — and of the way textures visibly shear on
/// large polygons near the camera.
///
/// `resolution` is the virtual vertical pixel count to snap to. Lower is more
/// aggressive. Zero disables it, which is the right choice for anything that
/// must not shimmer, like a UI quad in world space.
float4 SnapVertex(float4 positionCS, float resolution)
{
    if (resolution <= 0.0) return positionCS;

    // Snapping has to happen in NDC, after the perspective divide, or the
    // grid would be in clip space and vary with depth. Multiplying back by w
    // afterwards puts it into the space the rasteriser expects.
    float2 grid = float2(resolution * (_ScreenParams.x / max(_ScreenParams.y, 1.0)), resolution);
    float2 ndc = positionCS.xy / positionCS.w;
    ndc = floor(ndc * grid) / grid;
    positionCS.xy = ndc * positionCS.w;
    return positionCS;
}

/// Quantise a colour to a fixed number of levels per channel.
///
/// The console's framebuffer was 15-bit, so 32 levels per channel. Banding is
/// the point, not an artifact to hide.
half3 QuantiseColour(half3 color, half levels)
{
    return floor(color * levels + 0.5) / levels;
}

/// 4x4 ordered Bayer threshold for a screen position.
///
/// Dithering is what made 15-bit colour tolerable at the time, and it is the
/// other half of the look: without it, quantisation alone just posterises.
half BayerDither(float2 screenPosition)
{
    const half bayer[16] =
    {
         0.0h,  8.0h,  2.0h, 10.0h,
        12.0h,  4.0h, 14.0h,  6.0h,
         3.0h, 11.0h,  1.0h,  9.0h,
        15.0h,  7.0h, 13.0h,  5.0h
    };
    int2 p = int2(fmod(screenPosition, 4.0));
    return bayer[p.y * 4 + p.x] / 16.0h;
}

#endif // MTM_RETRO_INCLUDED
