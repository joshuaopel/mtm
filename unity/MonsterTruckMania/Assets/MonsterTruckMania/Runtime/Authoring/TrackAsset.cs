// SPDX-License-Identifier: MIT
using System;
using System.Collections.Generic;
using UnityEngine;
using MonsterTruckMania.Generation;

namespace MonsterTruckMania.Authoring
{
    [Serializable]
    public class SerializedFeature
    {
        public FeatureKind kind = FeatureKind.Hill;
        public Vector2 position;
        public float radius = 80f;
        [Tooltip("Height for hill, plateau and ridge. Depth for crater.")]
        public float height = 20f;
        [Range(0.05f, 1f)]
        [Tooltip("Plateau only: how much of the radius is spent blending the edge.")]
        public float falloff = 0.35f;

        [Tooltip("Ridge only: the spine, in world XZ.")]
        public List<Vector2> ridgePoints = new List<Vector2>();
        [Tooltip("Ridge only: full width across the spine.")]
        public float ridgeWidth = 140f;

        public TerrainFeature ToFeature()
        {
            var f = new TerrainFeature
            {
                Kind = kind,
                X = position.x,
                Z = position.y,
                Radius = radius,
                Height = height,
                Falloff = falloff,
                Width = ridgeWidth,
            };
            if (kind == FeatureKind.Ridge && ridgePoints != null)
            {
                f.Points = new List<(double, double)>(ridgePoints.Count);
                foreach (Vector2 p in ridgePoints) f.Points.Add((p.x, p.y));
            }
            return f;
        }
    }

    /// <summary>One of the four terrain layers the ground shader blends.</summary>
    [Serializable]
    public class TerrainLayer
    {
        public string name = "dirt";
        public Texture2D texture;
        [Tooltip("World metres one tile of the texture covers.")]
        public float metresPerTile = 8f;
        public Color tint = Color.white;
    }

    /// <summary>
    /// A track: control points, terrain settings, and whatever sculpting and
    /// painting has been done on top.
    /// </summary>
    /// <remarks>
    /// An asset rather than scene data so a track can be version-controlled,
    /// diffed and swapped between scenes. The heavy arrays — the sculpt
    /// offsets and the paint weights — live here too, which is what lets the
    /// generator be re-run at any time without losing hand work: generation
    /// rebuilds the base, then these are applied on top.
    /// </remarks>
    [CreateAssetMenu(fileName = "New Track", menuName = "Monster Truck Mania/Track", order = 0)]
    public class TrackAsset : ScriptableObject
    {
        [Header("Identity")]
        public string trackName = "NEW TRACK";
        [TextArea(2, 4)] public string blurb = "";
        [Range(1, 5)] public int difficulty = 2;
        [Min(1)] public int laps = 3;

        [Header("Road")]
        [Tooltip("Control points in world space. The road is a centripetal " +
                 "Catmull-Rom through these, matching the original game.")]
        public List<Vector3> controlPoints = new List<Vector3>();
        public bool closedCircuit = true;
        [Min(4f)] public float roadWidth = 22f;
        [Tooltip("How far past the road edge the terrain blends back to its " +
                 "natural height. A wide shoulder gives forgiving run-off.")]
        [Min(0f)] public float shoulder = 18f;
        [Tooltip("Spacing of the resampled centreline. Tighter follows a " +
                 "complex curve more faithfully and costs more vertices.")]
        [Range(0.5f, 8f)] public float roadResolution = 1.5f;

        [Header("Terrain")]
        [Min(50f)] public float terrainSize = 900f;
        [Tooltip("Grid resolution. 180 gives a 5m grid on a 900m field.")]
        [Range(16, 512)] public int segments = 180;
        [Min(0f)] public float amplitude = 12f;
        public float frequency = 0.006f;
        public int seed = 1101;
        public List<SerializedFeature> features = new List<SerializedFeature>();

        [Header("Ground")]
        public TerrainLayer[] layers = new TerrainLayer[4]
        {
            new TerrainLayer { name = "dirt", metresPerTile = 8f },
            new TerrainLayer { name = "rock", metresPerTile = 12f },
            new TerrainLayer { name = "grass", metresPerTile = 10f },
            new TerrainLayer { name = "sand", metresPerTile = 9f },
        };

        [Tooltip("Degrees of slope at which the second layer fully takes over. " +
                 "Measured rather than guessed: starting the ramp at 20 turned " +
                 "half of the original game's courses to rock, because rolling " +
                 "terrain spends a lot of its area between 20 and 40 degrees.")]
        public Vector2 slopeRamp = new Vector2(32f, 52f);

        [Header("Hand work (applied on top of generation)")]
        [Tooltip("Per-vertex height offsets from the sculpt brush. Survives a " +
                 "rebuild, which is the point: regenerating must not throw away " +
                 "an afternoon of sculpting.")]
        public float[] sculptOffsets = Array.Empty<float>();

        [Tooltip("Per-vertex layer weights from the paint brush, RGBA across " +
                 "the four layers. Empty means the automatic rules decide.")]
        public Color32[] paintWeights = Array.Empty<Color32>();

        /// <summary>Vertices in the height grid for the current settings.</summary>
        public int VertexCount => (segments + 1) * (segments + 1);

        /// <summary>
        /// Drop hand work that no longer fits the grid.
        /// </summary>
        /// <remarks>
        /// Changing <c>segments</c> changes what a vertex index means, so
        /// keeping the old arrays would smear the sculpt across the terrain
        /// at the wrong scale. Discarding is the honest option, and the
        /// inspector warns before it happens rather than after.
        /// </remarks>
        public void EnsureHandWorkMatchesGrid()
        {
            int n = VertexCount;
            if (sculptOffsets == null || sculptOffsets.Length != n) sculptOffsets = new float[n];
            if (paintWeights == null || paintWeights.Length != n) paintWeights = new Color32[n];
        }

        public bool HasHandWork =>
            (sculptOffsets != null && sculptOffsets.Length > 0) ||
            (paintWeights != null && paintWeights.Length > 0);

        public List<TerrainFeature> BuildFeatures()
        {
            var result = new List<TerrainFeature>();
            if (features == null) return result;
            foreach (SerializedFeature f in features)
            {
                if (f != null) result.Add(f.ToFeature());
            }
            return result;
        }

        public List<Vec3> BuildControlPoints()
        {
            var result = new List<Vec3>(controlPoints.Count);
            foreach (Vector3 p in controlPoints) result.Add(new Vec3(p.x, p.y, p.z));
            return result;
        }

        /// <summary>An oval to start from, so a new asset is drivable immediately.</summary>
        public void ResetToStarterOval(float radius = 250f)
        {
            controlPoints.Clear();
            const int count = 12;
            for (int i = 0; i < count; i++)
            {
                float a = i / (float)count * Mathf.PI * 2f;
                // A little height variation, because a dead-flat starter track
                // teaches you nothing about how the terrain carve behaves.
                float y = Mathf.Sin(a * 2f) * 6f;
                controlPoints.Add(new Vector3(Mathf.Sin(a) * radius, y, Mathf.Cos(a) * radius));
            }
            closedCircuit = true;
        }
    }
}
