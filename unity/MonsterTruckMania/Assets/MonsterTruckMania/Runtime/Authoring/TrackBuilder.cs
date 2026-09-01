// SPDX-License-Identifier: MIT
using System.Collections.Generic;
using UnityEngine;
using MonsterTruckMania.Generation;

namespace MonsterTruckMania.Authoring
{
    /// <summary>The result of a rebuild: meshes, plus the field they came from.</summary>
    public sealed class TrackBuildResult
    {
        public Mesh TerrainMesh;
        public Mesh RoadMesh;
        public TerrainField Field;
        public RoadPath Road;
        public int TerrainVertices;
        public int RoadVertices;
        public string Warning;
    }

    /// <summary>
    /// Turns a <see cref="TrackAsset"/> into Unity meshes.
    /// </summary>
    /// <remarks>
    /// This is the boundary where double-precision generation becomes float
    /// geometry, and the only place the two representations meet.
    /// <para/>
    /// It runs in the editor, on demand, rather than at load time. That is the
    /// whole point of the approach: the terrain you sculpt and paint is the
    /// terrain that ships, sitting in the scene as an ordinary mesh you can
    /// look at, walk on, and place props against — not something that appears
    /// when you press Play.
    /// </remarks>
    public static class TrackBuilder
    {
        /// <summary>
        /// Unity's 16-bit index buffer tops out here. A 256-segment field is
        /// 66049 vertices, which is already over, so anything past ~180
        /// segments needs the 32-bit format.
        /// </summary>
        private const int SixteenBitLimit = 65000;

        public static TrackBuildResult Build(TrackAsset asset)
        {
            var result = new TrackBuildResult();
            if (asset == null) return result;

            asset.EnsureHandWorkMatchesGrid();

            // 1. The road, from the control points.
            RoadPath road = null;
            if (asset.controlPoints != null && asset.controlPoints.Count >= 2)
            {
                road = new RoadPath(
                    asset.BuildControlPoints(), asset.closedCircuit,
                    asset.roadWidth, asset.shoulder, Mathf.Max(0.5f, asset.roadResolution));
            }
            result.Road = road;

            // 2. The ground, carved by it.
            TerrainField field = TerrainField.Generate(
                asset.terrainSize, asset.segments, asset.amplitude, asset.frequency,
                asset.seed, asset.BuildFeatures(), road);

            // 3. Hand work on top, so a rebuild never discards sculpting.
            ApplySculpt(field, asset);
            result.Field = field;

            result.TerrainMesh = BuildTerrainMesh(field, road, asset, out string warning);
            result.Warning = warning;
            result.TerrainVertices = field.Heights.Length;

            if (road != null && road.Points.Count >= 2)
            {
                result.RoadMesh = BuildRoadMesh(road, asset);
                result.RoadVertices = road.Points.Count * 2;
            }

            return result;
        }

        private static void ApplySculpt(TerrainField field, TrackAsset asset)
        {
            float[] offsets = asset.sculptOffsets;
            if (offsets == null || offsets.Length != field.Heights.Length) return;
            for (int i = 0; i < offsets.Length; i++)
            {
                if (offsets[i] != 0f) field.Heights[i] += offsets[i];
            }
        }

        // ------------------------------------------------------------------
        // Terrain
        // ------------------------------------------------------------------

        private static Mesh BuildTerrainMesh(TerrainField field, RoadPath road, TrackAsset asset,
                                             out string warning)
        {
            warning = null;
            int n = field.Segments;
            int side = n + 1;
            int vertexCount = side * side;

            var vertices = new Vector3[vertexCount];
            var normals = new Vector3[vertexCount];
            var uv = new Vector2[vertexCount];
            var colors = new Color32[vertexCount];

            bool painted = asset.paintWeights != null && asset.paintWeights.Length == vertexCount;

            for (int iz = 0; iz < side; iz++)
            {
                for (int ix = 0; ix < side; ix++)
                {
                    int i = field.Index(ix, iz);
                    vertices[i] = new Vector3(
                        (float)field.WorldX(ix), (float)field.Heights[i], (float)field.WorldZ(iz));

                    Vec3 nrm = field.NormalAt(ix, iz);
                    normals[i] = new Vector3((float)nrm.X, (float)nrm.Y, (float)nrm.Z);

                    // UVs in world metres, so the shader can tile each layer
                    // at its own scale without caring about grid resolution.
                    uv[i] = new Vector2((float)field.WorldX(ix), (float)field.WorldZ(iz));

                    colors[i] = painted && !IsUnpainted(asset.paintWeights[i])
                        ? asset.paintWeights[i]
                        : AutomaticWeights(field, road, asset, ix, iz);
                }
            }

            int quads = n * n;
            var triangles = new int[quads * 6];
            int t = 0;
            for (int iz = 0; iz < n; iz++)
            {
                for (int ix = 0; ix < n; ix++)
                {
                    int a = iz * side + ix;
                    int b = a + 1;
                    int c = a + side;
                    int d = c + 1;

                    triangles[t++] = a; triangles[t++] = c; triangles[t++] = b;
                    triangles[t++] = b; triangles[t++] = c; triangles[t++] = d;
                }
            }

            var mesh = new Mesh { name = "MTM_Terrain" };
            if (vertexCount > SixteenBitLimit)
            {
                // Without this the mesh silently wraps at 65535 and the far
                // half of the terrain folds back onto the near half.
                mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
                warning = $"{vertexCount} vertices: using a 32-bit index buffer. " +
                          "Fine on desktop, but some mobile GPUs will not draw it.";
            }

            mesh.vertices = vertices;
            mesh.normals = normals;
            mesh.uv = uv;
            mesh.colors32 = colors;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>A fully transparent weight means "nobody has painted here".</summary>
        private static bool IsUnpainted(Color32 c) => c.r == 0 && c.g == 0 && c.b == 0 && c.a == 0;

        /// <summary>
        /// Layer weights where nothing has been painted by hand.
        /// </summary>
        /// <remarks>
        /// Rock on steep ground, a worn verge along the racing line, base
        /// everywhere else. This is what makes a freshly generated track look
        /// deliberate before anyone has picked up the brush, and it is why the
        /// paint tool is for saying something specific rather than for doing
        /// all the work.
        /// <para/>
        /// Weights are normalised rather than clamped independently. Letting
        /// them sum past one washes the ground out, because the shader adds
        /// the layers rather than picking between them.
        /// </remarks>
        private static Color32 AutomaticWeights(TerrainField field, RoadPath road, TrackAsset asset,
                                                int ix, int iz)
        {
            double slope = field.SlopeAt(ix, iz) * Mathf.Rad2Deg;
            double rock = MathUtil.Smootherstep(asset.slopeRamp.x, asset.slopeRamp.y, slope);

            // The verge: ground worn bare beside the racing line, fading out
            // by the edge of the shoulder.
            double verge = 0.0;
            if (road != null)
            {
                double x = field.WorldX(ix), z = field.WorldZ(iz);
                if (road.Closest(x, z, out double lateral) >= 0)
                {
                    double inner = road.Width * 0.5;
                    double outer = inner + road.Shoulder;
                    verge = 1.0 - MathUtil.Smootherstep(inner, outer, lateral);
                }
            }

            double baseWeight = MathUtil.Clamp(1.0 - rock - verge, 0.0, 1.0);
            double total = baseWeight + rock + verge;
            if (total <= 1e-6) return new Color32(255, 0, 0, 0);

            return new Color32(
                (byte)(baseWeight / total * 255.0),
                (byte)(rock / total * 255.0),
                0,
                (byte)(verge / total * 255.0));
        }

        // ------------------------------------------------------------------
        // Road ribbon
        // ------------------------------------------------------------------

        private static Mesh BuildRoadMesh(RoadPath road, TrackAsset asset)
        {
            int count = road.Points.Count;
            bool closed = road.Closed;
            int rings = closed ? count + 1 : count;

            var vertices = new Vector3[rings * 2];
            var normals = new Vector3[rings * 2];
            var uv = new Vector2[rings * 2];
            var colors = new Color32[rings * 2];

            float half = asset.roadWidth * 0.5f;
            // Lifted slightly so it never z-fights the terrain it is carved
            // into. 5cm is below what you can see and above float error at
            // several hundred metres from the origin.
            const float lift = 0.05f;
            float distance = 0f;

            for (int r = 0; r < rings; r++)
            {
                int i = r % count;
                Vec3 p = road.Points[i];
                Vec3 right = road.RightAt(i);

                if (r > 0)
                {
                    Vec3 previous = road.Points[(r - 1) % count];
                    distance += (float)Vec3.Distance(p, previous);
                }

                var centre = new Vector3((float)p.X, (float)p.Y + lift, (float)p.Z);
                var side = new Vector3((float)right.X, 0f, (float)right.Z) * half;

                vertices[r * 2] = centre - side;
                vertices[r * 2 + 1] = centre + side;
                normals[r * 2] = Vector3.up;
                normals[r * 2 + 1] = Vector3.up;

                // V runs along the road in metres so the texture never
                // stretches through a corner; U spans the width.
                uv[r * 2] = new Vector2(0f, distance);
                uv[r * 2 + 1] = new Vector2(1f, distance);
                colors[r * 2] = new Color32(255, 255, 255, 255);
                colors[r * 2 + 1] = new Color32(255, 255, 255, 255);
            }

            var triangles = new int[(rings - 1) * 6];
            int t = 0;
            for (int r = 0; r < rings - 1; r++)
            {
                int a = r * 2, b = a + 1, c = a + 2, d = a + 3;
                triangles[t++] = a; triangles[t++] = c; triangles[t++] = b;
                triangles[t++] = b; triangles[t++] = c; triangles[t++] = d;
            }

            var mesh = new Mesh { name = "MTM_Road" };
            if (vertices.Length > SixteenBitLimit)
            {
                mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            }
            mesh.vertices = vertices;
            mesh.normals = normals;
            mesh.uv = uv;
            mesh.colors32 = colors;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
