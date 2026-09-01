// SPDX-License-Identifier: MIT
namespace MonsterTruckMania.Simulation
{
    /// <summary>
    /// The web game's PRNG, so seeded choices land in the same places.
    /// </summary>
    /// <remarks>
    /// mulberry32, ported exactly — including the 32-bit wrapping, which is
    /// what <c>uint</c> arithmetic gives here and what JavaScript's
    /// <c>Math.imul</c> and <c>&gt;&gt;&gt; 0</c> give there. Anything seeded
    /// from track data (prop scatter, AI lane offsets) then matches the
    /// original, which is the difference between "a course that looks like
    /// Mesa Speedway" and "Mesa Speedway".
    /// </remarks>
    public sealed class Rng
    {
        private uint _state;

        public Rng(int seed)
        {
            _state = unchecked((uint)seed);
        }

        /// <summary>Next value in 0..1.</summary>
        public double NextDouble()
        {
            unchecked
            {
                _state += 0x6d2b79f5u;
                uint t = _state;
                t = (uint)((int)(t ^ (t >> 15)) * (int)(t | 1u));
                t ^= t + (uint)((int)(t ^ (t >> 7)) * (int)(t | 61u));
                return (t ^ (t >> 14)) / 4294967296.0;
            }
        }

        public double Range(double min, double max) => min + NextDouble() * (max - min);

        /// <summary>Symmetric jitter around zero.</summary>
        public double Spread(double amount) => (NextDouble() * 2.0 - 1.0) * amount;
    }
}
