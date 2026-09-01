// SPDX-License-Identifier: MIT
using System;
using System.Collections.Generic;

namespace MonsterTruckMania.Generation
{
    public enum FeatureKind { Hill, Crater, Plateau, Ridge }

    /// <summary>One authored landform: a hill, crater, plateau or ridge.</summary>
    /// <remarks>
    /// Plain data with no Unity types so the generator stays testable. The
    /// authoring component converts from its serialised form.
    /// </remarks>
    public sealed class TerrainFeature
    {
        public FeatureKind Kind;
        /// <summary>Centre in world XZ. Unused by ridges, which use Points.</summary>
        public double X, Z;
        public double Radius;
        /// <summary>Height for hill/plateau/ridge, depth for crater.</summary>
        public double Height;
        /// <summary>Plateau only: fraction of the radius used to blend the edge.</summary>
        public double Falloff = 0.35;
        /// <summary>Ridge only: the spine, in world XZ, and its full width.</summary>
        public List<(double X, double Z)> Points;
        public double Width;
    }

    /// <summary>
    /// The height grid, and the single place it is generated.
    /// </summary>
    /// <remarks>
    /// One array feeds everything downstream: the visible mesh, the collider,
    /// and every "how high is the ground here" query used to drop props and
    /// spawn trucks. Deriving those separately is how you get scenery that
    /// floats or sinks, and it is miserable to debug after the fact.
    /// <para/>
    /// Layout is <c>iz * (Segments + 1) + ix</c>, matching the web game so
    /// tracks can be moved between the two.
    /// </remarks>
    public sealed class TerrainField
    {
        public int Segments { get; }
        public double Size { get; }
        /// <summary>World distance between adjacent grid samples.</summary>
        public double ElementSize { get; }
        public double[] Heights { get; }

        public TerrainField(double size, int segments)
        {
            Size = size;
            Segments = segments;
            ElementSize = size / segments;
            Heights = new double[(segments + 1) * (segments + 1)];
        }

        public int Index(int ix, int iz) => iz * (Segments + 1) + ix;
        public double WorldX(int ix) => -Size * 0.5 + ix * ElementSize;
        public double WorldZ(int iz) => -Size * 0.5 + iz * ElementSize;

        /// <summary>Grid column nearest a world X, clamped into the field.</summary>
        public int ColumnAt(double x) =>
            (int)MathUtil.Clamp(Math.Round((x + Size * 0.5) / ElementSize), 0, Segments);

        public int RowAt(double z) =>
            (int)MathUtil.Clamp(Math.Round((z + Size * 0.5) / ElementSize), 0, Segments);

        /// <summary>
        /// Bilinear height at an arbitrary world position.
        /// </summary>
        /// <remarks>
        /// Bilinear rather than nearest because props and spawn points land
        /// between samples: on a 900m field at 180 segments the grid is 5m
        /// across, and snapping to the nearest corner can put a truck half a
        /// metre into a slope.
        /// </remarks>
        public double SampleHeight(double x, double z)
        {
            double gx = MathUtil.Clamp((x + Size * 0.5) / ElementSize, 0, Segments);
            double gz = MathUtil.Clamp((z + Size * 0.5) / ElementSize, 0, Segments);

            int x0 = (int)Math.Floor(gx);
            int z0 = (int)Math.Floor(gz);
            int x1 = Math.Min(x0 + 1, Segments);
            int z1 = Math.Min(z0 + 1, Segments);
            double fx = gx - x0;
            double fz = gz - z0;

            double h00 = Heights[Index(x0, z0)];
            double h10 = Heights[Index(x1, z0)];
            double h01 = Heights[Index(x0, z1)];
            double h11 = Heights[Index(x1, z1)];

            double top = h00 + (h10 - h00) * fx;
            double bottom = h01 + (h11 - h01) * fx;
            return top + (bottom - top) * fz;
        }

        /// <summary>
        /// Build the field: fractal base, then authored features, then the
        /// road carve.
        /// </summary>
        /// <remarks>
        /// The order is the design. Features stack onto the noise, and the
        /// road is carved last so it always wins — otherwise a hill dropped
        /// near the racing line puts a wall across it.
        /// </remarks>
        public static TerrainField Generate(
            double size, int segments, double amplitude, double frequency, int seed,
            IEnumerable<TerrainFeature> features, RoadPath road)
        {
            var field = new TerrainField(size, segments);
            var noise = new ValueNoise2D(seed);
            int n = segments;
            double[] h = field.Heights;

            // Pass 1: fractal ground, with the rim lifted so the world reads
            // as a bowl instead of ending at a visible cliff edge.
            for (int iz = 0; iz <= n; iz++)
            {
                double z = field.WorldZ(iz);
                for (int ix = 0; ix <= n; ix++)
                {
                    double x = field.WorldX(ix);
                    double baseNoise = noise.Fbm(x * frequency, z * frequency, 4);
                    double height = (baseNoise - 0.5) * 2.0 * amplitude;
                    double edge = Math.Max(Math.Abs(x), Math.Abs(z)) / (size * 0.5);
                    height += MathUtil.Smootherstep(0.72, 1.0, edge) * amplitude * 3.5;
                    h[field.Index(ix, iz)] = height;
                }
            }

            // Pass 2: authored landforms.
            if (features != null)
            {
                foreach (TerrainFeature feature in features) field.ApplyFeature(feature);
            }

            // Pass 3: the road, last.
            if (road != null) field.CarveRoad(road);

            return field;
        }

        private void ApplyFeature(TerrainFeature f)
        {
            if (f == null) return;
            int n = Segments;

            if (f.Kind == FeatureKind.Ridge)
            {
                if (f.Points == null || f.Points.Count < 2) return;
                double half = f.Width * 0.5;
                for (int iz = 0; iz <= n; iz++)
                {
                    double z = WorldZ(iz);
                    for (int ix = 0; ix <= n; ix++)
                    {
                        double d = DistanceToPolyline(WorldX(ix), z, f.Points);
                        if (d > half) continue;
                        double t = 1.0 - MathUtil.Smootherstep(0, half, d);
                        Heights[Index(ix, iz)] += f.Height * t;
                    }
                }
                return;
            }

            // Radial features only touch their own footprint, which is what
            // keeps a dozen of them from costing a dozen full-grid passes.
            int minX = (int)MathUtil.Clamp(Math.Floor((f.X - f.Radius + Size * 0.5) / ElementSize), 0, n);
            int maxX = (int)MathUtil.Clamp(Math.Ceiling((f.X + f.Radius + Size * 0.5) / ElementSize), 0, n);
            int minZ = (int)MathUtil.Clamp(Math.Floor((f.Z - f.Radius + Size * 0.5) / ElementSize), 0, n);
            int maxZ = (int)MathUtil.Clamp(Math.Ceiling((f.Z + f.Radius + Size * 0.5) / ElementSize), 0, n);

            for (int iz = minZ; iz <= maxZ; iz++)
            {
                double z = WorldZ(iz);
                for (int ix = minX; ix <= maxX; ix++)
                {
                    double x = WorldX(ix);
                    double dx = x - f.X, dz = z - f.Z;
                    double d = Math.Sqrt(dx * dx + dz * dz);
                    if (d > f.Radius) continue;

                    int i = Index(ix, iz);
                    double t = 1.0 - MathUtil.Smootherstep(0, f.Radius, d);

                    switch (f.Kind)
                    {
                        case FeatureKind.Hill:
                            Heights[i] += f.Height * t * t;
                            break;

                        case FeatureKind.Crater:
                            // A raised lip at 85% of the radius, which is what
                            // makes it read as an impact rather than a dent.
                            double rim = Math.Exp(-Math.Pow((d / f.Radius) - 0.85, 2) / 0.01);
                            Heights[i] -= f.Height * t * t;
                            Heights[i] += f.Height * 0.35 * rim;
                            break;

                        case FeatureKind.Plateau:
                            double blend = 1.0 - MathUtil.Smootherstep(
                                f.Radius * (1.0 - f.Falloff), f.Radius, d);
                            Heights[i] += (f.Height - Heights[i]) * blend;
                            break;
                    }
                }
            }
        }

        /// <summary>
        /// Flatten the ground to road height under the road, blending back out
        /// across the shoulder.
        /// </summary>
        private void CarveRoad(RoadPath road)
        {
            int n = Segments;
            double halfWidth = road.Width * 0.5;
            double outer = halfWidth + road.Shoulder;

            for (int iz = 0; iz <= n; iz++)
            {
                double z = WorldZ(iz);
                for (int ix = 0; ix <= n; ix++)
                {
                    double x = WorldX(ix);
                    int index = road.Closest(x, z, out double lateral);
                    if (index < 0 || lateral > outer) continue;

                    int i = Index(ix, iz);
                    double blend = 1.0 - MathUtil.Smootherstep(halfWidth, outer, lateral);
                    Heights[i] += (road.Points[index].Y - Heights[i]) * blend;
                }
            }
        }

        private static double DistanceToPolyline(double x, double z, List<(double X, double Z)> points)
        {
            double best = double.PositiveInfinity;
            for (int i = 0; i < points.Count - 1; i++)
            {
                double ax = points[i].X, az = points[i].Z;
                double bx = points[i + 1].X, bz = points[i + 1].Z;
                double dx = bx - ax, dz = bz - az;
                double lengthSq = dx * dx + dz * dz;
                double t = lengthSq > 0
                    ? MathUtil.Clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0.0, 1.0)
                    : 0.0;
                double px = ax + dx * t, pz = az + dz * t;
                double d = Math.Sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
                if (d < best) best = d;
            }
            return best;
        }

        /// <summary>
        /// Surface normal at a grid point, from the neighbouring heights.
        /// </summary>
        /// <remarks>
        /// Central differences, so the normal is the average of the slopes
        /// either side rather than one triangle's face normal. Used for
        /// lighting and for the automatic rock-on-steep-ground paint rule.
        /// </remarks>
        public Vec3 NormalAt(int ix, int iz)
        {
            int n = Segments;
            int xl = Math.Max(ix - 1, 0), xr = Math.Min(ix + 1, n);
            int zd = Math.Max(iz - 1, 0), zu = Math.Min(iz + 1, n);

            double dhx = (Heights[Index(xr, iz)] - Heights[Index(xl, iz)]);
            double dhz = (Heights[Index(ix, zu)] - Heights[Index(ix, zd)]);
            double spanX = (xr - xl) * ElementSize;
            double spanZ = (zu - zd) * ElementSize;

            return new Vec3(-dhx / spanX, 1.0, -dhz / spanZ).Normalized;
        }

        /// <summary>Slope in radians at a grid point, from the normal.</summary>
        public double SlopeAt(int ix, int iz) => Math.Acos(MathUtil.Clamp(NormalAt(ix, iz).Y, -1, 1));
    }
}
