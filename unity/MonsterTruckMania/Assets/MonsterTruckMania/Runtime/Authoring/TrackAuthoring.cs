// SPDX-License-Identifier: MIT
using UnityEngine;
using MonsterTruckMania.Generation;

namespace MonsterTruckMania.Authoring
{
    /// <summary>
    /// The track in the scene. Press Rebuild and it regenerates.
    /// </summary>
    /// <remarks>
    /// Everything it makes is ordinary scene geometry — a MeshFilter, a
    /// MeshRenderer and a MeshCollider — created in the editor and saved with
    /// the scene. Nothing is generated at load time.
    /// <para/>
    /// That is deliberate and is the main thing this differs from the web
    /// version, where the terrain appears when the race starts. Here you can
    /// see the ground while you work, drop props onto it, walk the course, and
    /// know that what you are looking at is what ships.
    /// </remarks>
    [ExecuteAlways]
    [AddComponentMenu("Monster Truck Mania/Track Authoring")]
    public class TrackAuthoring : MonoBehaviour
    {
        public TrackAsset track;

        [Header("Generated (do not edit by hand)")]
        [SerializeField] private MeshFilter terrainFilter;
        [SerializeField] private MeshRenderer terrainRenderer;
        [SerializeField] private MeshCollider terrainCollider;
        [SerializeField] private MeshFilter roadFilter;
        [SerializeField] private MeshRenderer roadRenderer;

        [Header("Materials")]
        public Material terrainMaterial;
        public Material roadMaterial;

        [Header("Rebuild")]
        [Tooltip("Generate a collider as well as the visible mesh. Turn off " +
                 "while iterating on a large field — cooking the collision for " +
                 "a 256-segment grid is most of the rebuild time.")]
        public bool buildCollider = true;

        /// <summary>Last built field, kept so the brushes can query heights.</summary>
        public TerrainField Field { get; private set; }
        /// <summary>Last built road, kept for handles and prop snapping.</summary>
        public RoadPath Road { get; private set; }
        public string LastWarning { get; private set; }
        public int LastTerrainVertices { get; private set; }

        /// <summary>
        /// Regenerate the terrain and road meshes from the asset.
        /// </summary>
        /// <remarks>
        /// Safe to call repeatedly. The child objects are reused rather than
        /// recreated, so the scene does not accumulate junk and anything you
        /// have parented to them survives.
        /// </remarks>
        public void Rebuild()
        {
            if (track == null)
            {
                LastWarning = "No track asset assigned.";
                return;
            }

            TrackBuildResult result = TrackBuilder.Build(track);
            Field = result.Field;
            Road = result.Road;
            LastWarning = result.Warning;
            LastTerrainVertices = result.TerrainVertices;

            EnsureChildren();

            AssignMesh(terrainFilter, result.TerrainMesh);
            if (terrainRenderer != null && terrainMaterial != null)
            {
                terrainRenderer.sharedMaterial = terrainMaterial;
            }

            if (terrainCollider != null)
            {
                // Clearing first matters: assigning a mesh that is already set
                // does not always re-cook, and you end up driving on the
                // previous shape of the ground.
                terrainCollider.sharedMesh = null;
                terrainCollider.enabled = buildCollider;
                if (buildCollider) terrainCollider.sharedMesh = result.TerrainMesh;
            }

            AssignMesh(roadFilter, result.RoadMesh);
            if (roadRenderer != null && roadMaterial != null)
            {
                roadRenderer.sharedMaterial = roadMaterial;
            }
        }

        private static void AssignMesh(MeshFilter filter, Mesh mesh)
        {
            if (filter == null) return;
            // Destroy the old one rather than orphaning it: meshes built this
            // way are not assets, so nothing else will ever collect them and a
            // long editing session leaks a few hundred megabytes.
            Mesh previous = filter.sharedMesh;
            filter.sharedMesh = mesh;
            if (previous != null && previous != mesh)
            {
                if (Application.isPlaying) Destroy(previous);
                else DestroyImmediate(previous);
            }
        }

        private void EnsureChildren()
        {
            Transform terrain = FindOrCreate("Terrain");
            terrainFilter = Require<MeshFilter>(terrain);
            terrainRenderer = Require<MeshRenderer>(terrain);
            terrainCollider = Require<MeshCollider>(terrain);

            Transform road = FindOrCreate("Road");
            roadFilter = Require<MeshFilter>(road);
            roadRenderer = Require<MeshRenderer>(road);
        }

        private Transform FindOrCreate(string childName)
        {
            Transform found = transform.Find(childName);
            if (found != null) return found;

            var go = new GameObject(childName);
            go.transform.SetParent(transform, false);
            return go.transform;
        }

        private static T Require<T>(Transform on) where T : Component
        {
            T component = on.GetComponent<T>();
            return component != null ? component : on.gameObject.AddComponent<T>();
        }

        /// <summary>
        /// Ground height at a world position, from the last build.
        /// </summary>
        /// <remarks>
        /// What the prop tools use to drop things onto the terrain. Reads the
        /// height field rather than raycasting, so it works with the collider
        /// turned off and does not care what else is in the scene.
        /// </remarks>
        public bool TryGetHeight(Vector3 world, out float height)
        {
            if (Field == null)
            {
                height = 0f;
                return false;
            }
            height = (float)Field.SampleHeight(world.x, world.z);
            return true;
        }
    }
}
