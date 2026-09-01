// SPDX-License-Identifier: MIT
using System;

namespace MonsterTruckMania.Generation
{
    /// <summary>
    /// Hashed-lattice value noise, bit-for-bit identical to the web game's
    /// <c>ValueNoise2D</c> and the Blender add-on's Python port.
    /// </summary>
    /// <remarks>
    /// Three implementations of the same function now exist, which is only
    /// tolerable because all three are pinned to the same printed reference
    /// values. Change the formula here and
    /// <c>unity/tests/GenerationTests.cs</c> fails immediately.
    /// <para/>
    /// The hash is written against JavaScript's semantics, because that is
    /// where it started: <c>Math.imul</c> is a 32-bit multiply that wraps, and
    /// <c>&gt;&gt;&gt;</c> is a logical shift on the unsigned pattern. In C#
    /// that means doing the arithmetic in <c>uint</c> and letting it wrap,
    /// which <c>unchecked</c> makes explicit rather than accidental.
    /// </remarks>
    public sealed class ValueNoise2D
    {
        private readonly uint _seed;

        public ValueNoise2D(int seed)
        {
            _seed = unchecked((uint)seed);
        }

        private double Hash(int ix, int iy)
        {
            unchecked
            {
                // All of this stays in uint on purpose. Mixing int and uint
                // in C# promotes to long, which stops the wraparound the hash
                // depends on and quietly produces different terrain.
                uint h = (uint)ix * 374761393u + (uint)iy * 668265263u + _seed;
                h = (h ^ (h >> 13)) * 1274126177u;
                return (h ^ (h >> 16)) / 4294967296.0;
            }
        }

        private static double Smoothstep(double t) => t * t * (3.0 - 2.0 * t);

        public double Sample(double x, double y)
        {
            int x0 = (int)Math.Floor(x);
            int y0 = (int)Math.Floor(y);
            double fx = Smoothstep(x - x0);
            double fy = Smoothstep(y - y0);

            double n00 = Hash(x0, y0);
            double n10 = Hash(x0 + 1, y0);
            double n01 = Hash(x0, y0 + 1);
            double n11 = Hash(x0 + 1, y0 + 1);

            double top = n00 + (n10 - n00) * fx;
            double bottom = n01 + (n11 - n01) * fx;
            return top + (bottom - top) * fy;
        }

        /// <summary>Fractal sum of octaves, normalised back to roughly 0..1.</summary>
        public double Fbm(double x, double y, int octaves = 4, double lacunarity = 2.0, double gain = 0.5)
        {
            double amplitude = 1.0;
            double frequency = 1.0;
            double total = 0.0;
            double norm = 0.0;
            for (int i = 0; i < octaves; i++)
            {
                total += Sample(x * frequency, y * frequency) * amplitude;
                norm += amplitude;
                amplitude *= gain;
                frequency *= lacunarity;
            }
            return total / norm;
        }
    }

    /// <summary>Small helpers the generation code leans on.</summary>
    public static class MathUtil
    {
        public static double Clamp(double value, double low, double high)
            => value < low ? low : value > high ? high : value;

        /// <summary>
        /// Ken Perlin's second smoothstep. Used for feature falloff, where the
        /// zero second derivative at each end is what stops a hill meeting the
        /// surrounding ground in a visible crease.
        /// </summary>
        public static double Smootherstep(double edge0, double edge1, double x)
        {
            double span = edge1 - edge0;
            if (span == 0.0) span = 1e-6;
            double t = Clamp((x - edge0) / span, 0.0, 1.0);
            return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
        }
    }
}
