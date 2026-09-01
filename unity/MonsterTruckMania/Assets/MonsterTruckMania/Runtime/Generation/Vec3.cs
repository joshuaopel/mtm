// SPDX-License-Identifier: MIT
namespace MonsterTruckMania.Generation
{
    /// <summary>
    /// A double-precision 3D vector, used only inside the generation code.
    /// </summary>
    /// <remarks>
    /// Deliberately not <c>UnityEngine.Vector3</c>, for two reasons.
    /// <para/>
    /// It keeps this whole namespace free of Unity, so it compiles and runs
    /// under a plain .NET test project — which is how it was checked against
    /// the reference values printed from the original TypeScript rather than
    /// merely believed to match.
    /// <para/>
    /// And it is <c>double</c>. The spline's arc-length reparameterisation
    /// accumulates a running total over 200 segments, and the terrain carve
    /// compares distances against it; doing that in float drifts enough to
    /// move a road edge by a visible amount on a long course. Conversion to
    /// Unity's float <c>Vector3</c> happens once, at the mesh boundary.
    /// </remarks>
    public readonly struct Vec3
    {
        public readonly double X;
        public readonly double Y;
        public readonly double Z;

        public Vec3(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }

        public static Vec3 operator +(Vec3 a, Vec3 b) => new Vec3(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
        public static Vec3 operator -(Vec3 a, Vec3 b) => new Vec3(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
        public static Vec3 operator *(Vec3 a, double s) => new Vec3(a.X * s, a.Y * s, a.Z * s);

        public double this[int axis] => axis == 0 ? X : axis == 1 ? Y : Z;

        public double SqrMagnitude => X * X + Y * Y + Z * Z;
        public double Magnitude => System.Math.Sqrt(SqrMagnitude);

        public Vec3 Normalized
        {
            get
            {
                double m = Magnitude;
                return m > 1e-12 ? this * (1.0 / m) : new Vec3(0, 0, 0);
            }
        }

        public static double Distance(Vec3 a, Vec3 b) => (a - b).Magnitude;
        public static double DistanceSquared(Vec3 a, Vec3 b) => (a - b).SqrMagnitude;

        public static Vec3 Cross(Vec3 a, Vec3 b) => new Vec3(
            a.Y * b.Z - a.Z * b.Y,
            a.Z * b.X - a.X * b.Z,
            a.X * b.Y - a.Y * b.X);

        public static Vec3 Lerp(Vec3 a, Vec3 b, double t) => a + (b - a) * t;

        public override string ToString() => $"({X:R}, {Y:R}, {Z:R})";
    }
}
