// SPDX-License-Identifier: MIT
//
// Four-layer terrain ground, PS1 style.
//
// Layer weights arrive in the vertex colour: R is the base, G the second
// layer, B the third, A the fourth. They are written either by the paint
// brush or by the automatic rules in TrackBuilder, and they always sum to
// one, which is why this can add the layers rather than picking between them.
//
// UVs are world metres, so each layer tiles at its own real-world scale and
// the grid resolution does not change how the ground looks.
Shader "Monster Truck Mania/Terrain"
{
    Properties
    {
        [Header(Layers)]
        _Layer0 ("Base", 2D) = "white" {}
        _Layer1 ("Slope / rock", 2D) = "white" {}
        _Layer2 ("Third", 2D) = "white" {}
        _Layer3 ("Verge", 2D) = "white" {}

        _Scale0 ("Base metres per tile", Float) = 8
        _Scale1 ("Slope metres per tile", Float) = 12
        _Scale2 ("Third metres per tile", Float) = 10
        _Scale3 ("Verge metres per tile", Float) = 9

        _Tint0 ("Base tint", Color) = (1,1,1,1)
        _Tint1 ("Slope tint", Color) = (1,1,1,1)
        _Tint2 ("Third tint", Color) = (1,1,1,1)
        _Tint3 ("Verge tint", Color) = (1,1,1,1)

        [Header(PS1)]
        // The console had no sub-pixel precision in its rasteriser: vertices
        // landed on whole screen pixels, which is what makes geometry wobble
        // as the camera moves. 0 turns it off.
        _SnapResolution ("Vertex snap resolution", Float) = 160
        _AmbientBoost ("Ambient", Range(0,1)) = 0.35
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry" }
        LOD 200

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "MTM_Retro.hlsl"

            TEXTURE2D(_Layer0); SAMPLER(sampler_Layer0);
            TEXTURE2D(_Layer1); SAMPLER(sampler_Layer1);
            TEXTURE2D(_Layer2); SAMPLER(sampler_Layer2);
            TEXTURE2D(_Layer3); SAMPLER(sampler_Layer3);

            CBUFFER_START(UnityPerMaterial)
                float _Scale0, _Scale1, _Scale2, _Scale3;
                float4 _Tint0, _Tint1, _Tint2, _Tint3;
                float _SnapResolution;
                float _AmbientBoost;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float2 uv         : TEXCOORD0;
                float4 color      : COLOR;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                // noperspective is the whole affine-mapping trick: the console
                // interpolated texture coordinates linearly in screen space
                // with no perspective divide, which is why its textures swim
                // across large polygons. Doing it here rather than faking it
                // in the fragment shader gets the real artifact for free.
                noperspective float2 uv : TEXCOORD0;
                float3 normalWS   : TEXCOORD1;
                float3 positionWS : TEXCOORD2;
                float4 color      : COLOR;
                float  fogFactor  : TEXCOORD3;
            };

            Varyings vert (Attributes input)
            {
                Varyings output;
                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);

                output.positionCS = SnapVertex(positions.positionCS, _SnapResolution);
                output.positionWS = positions.positionWS;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.uv = input.uv;
                output.color = input.color;
                output.fogFactor = ComputeFogFactor(positions.positionCS.z);
                return output;
            }

            half4 frag (Varyings input) : SV_Target
            {
                // Weights come in already normalised, so this is an add and
                // not a chain of lerps — cheaper, and it means a vertex can
                // legitimately be a three-way blend.
                half4 w = input.color;

                half3 albedo =
                    SAMPLE_TEXTURE2D(_Layer0, sampler_Layer0, input.uv / _Scale0).rgb * _Tint0.rgb * w.r +
                    SAMPLE_TEXTURE2D(_Layer1, sampler_Layer1, input.uv / _Scale1).rgb * _Tint1.rgb * w.g +
                    SAMPLE_TEXTURE2D(_Layer2, sampler_Layer2, input.uv / _Scale2).rgb * _Tint2.rgb * w.b +
                    SAMPLE_TEXTURE2D(_Layer3, sampler_Layer3, input.uv / _Scale3).rgb * _Tint3.rgb * w.a;

                Light mainLight = GetMainLight();
                half ndotl = saturate(dot(normalize(input.normalWS), mainLight.direction));
                // Deliberately flat: no specular, no smooth falloff. The era
                // had vertex lighting and a lookup table, and anything softer
                // reads as modern no matter what the post-process does.
                half3 lighting = mainLight.color * ndotl + _AmbientBoost;

                half3 color = albedo * lighting;
                color = MixFog(color, input.fogFactor);
                return half4(color, 1);
            }
            ENDHLSL
        }

        // Shadow casting, so the terrain occludes itself and props sit in it.
        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }
            ZWrite On
            ZTest LEqual
            ColorMask 0

            HLSLPROGRAM
            #pragma vertex ShadowVert
            #pragma fragment ShadowFrag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"

            float3 _LightDirection;

            struct ShadowAttributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct ShadowVaryings  { float4 positionCS : SV_POSITION; };

            ShadowVaryings ShadowVert (ShadowAttributes input)
            {
                ShadowVaryings output;
                float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);
                float3 normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.positionCS = TransformWorldToHClip(
                    ApplyShadowBias(positionWS, normalWS, _LightDirection));
                return output;
            }

            half4 ShadowFrag (ShadowVaryings input) : SV_Target { return 0; }
            ENDHLSL
        }
    }

    Fallback Off
}
