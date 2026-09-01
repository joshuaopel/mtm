// SPDX-License-Identifier: MIT
//
// The screen pass: takes the low-resolution render and puts it on the display
// with dithering and colour quantisation.
//
// Deliberately a plain unlit shader on a full-screen quad rather than a URP
// Renderer Feature. The RenderGraph API moved under Renderer Features in
// Unity 6, and this needs to work without being recompiled every time that
// churns. A quad and a texture works in every pipeline and every version.
Shader "Monster Truck Mania/Retro Blit"
{
    Properties
    {
        _MainTex ("Source", 2D) = "white" {}
        _Levels ("Colour levels per channel", Range(2, 64)) = 32
        _DitherStrength ("Dither", Range(0, 2)) = 1
        _Scanline ("Scanline", Range(0, 0.5)) = 0.06
        _Vignette ("Vignette", Range(0, 1)) = 0.22
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" }
        Cull Off
        ZWrite Off
        ZTest Always

        Pass
        {
            Name "RetroBlit"

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "MTM_Retro.hlsl"

            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);

            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                float4 _MainTex_TexelSize;
                half _Levels;
                half _DitherStrength;
                half _Scanline;
                half _Vignette;
            CBUFFER_END

            // The vertex colour is here because this runs as the material on a
            // RawImage: the Canvas feeds tint and, more importantly, the
            // CanvasGroup alpha through it. Ignoring it means fades do nothing.
            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv         : TEXCOORD0;
                float4 color      : COLOR;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv         : TEXCOORD0;
                float4 color      : COLOR;
            };

            Varyings vert (Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                output.color = input.color;
                return output;
            }

            half4 frag (Varyings input) : SV_Target
            {
                half3 color = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, input.uv).rgb;

                // Dither against the *source* pixel grid, not the display's.
                // Sampling the display grid would give a fine screen door over
                // chunky pixels, which reads as an overlay rather than as part
                // of the image.
                float2 sourcePixel = input.uv * _MainTex_TexelSize.zw;
                half threshold = (BayerDither(sourcePixel) - 0.5h) * _DitherStrength;

                // Offset by the dither before quantising: that is what turns
                // banding into a stipple across the boundary instead of a hard
                // edge, which is the whole reason the era dithered.
                color = QuantiseColour(saturate(color + threshold / _Levels), _Levels);

                // Scanlines and vignette, both on the source grid so they
                // scale with the chosen resolution rather than the window.
                //
                // Not named `line`: that is a reserved primitive-type keyword
                // in HLSL (geometry shader input) and using it as a variable
                // fails to compile.
                half scan = 1.0h - _Scanline * (fmod(sourcePixel.y, 2.0) < 1.0 ? 0.0h : 1.0h);
                color *= scan;

                float2 centred = input.uv - 0.5;
                half vignette = 1.0h - saturate(dot(centred, centred) * 2.0) * _Vignette;
                color *= vignette;

                return half4(color * input.color.rgb, input.color.a);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
