// SPDX-License-Identifier: MIT
using System.IO;
using UnityEditor;
using UnityEngine;
using MonsterTruckMania.Authoring;
using MonsterTruckMania.Rendering;

namespace MonsterTruckMania.EditorTools
{
    /// <summary>
    /// One-click scene setup.
    /// </summary>
    /// <remarks>
    /// Wiring this by hand is a dozen fiddly steps — create the asset, add the
    /// component, make three materials, point the camera at the blit shader —
    /// and every one of them is a chance to end up staring at a black screen
    /// wondering which step was missed. This does the lot and leaves something
    /// already drivable.
    /// </remarks>
    public static class TrackSetupMenu
    {
        private const string AssetFolder = "Assets/MonsterTruckMania/Generated";

        [MenuItem("Monster Truck Mania/Create Track In Scene", false, 0)]
        public static void CreateTrackInScene()
        {
            Directory.CreateDirectory(AssetFolder);

            TrackAsset track = ScriptableObject.CreateInstance<TrackAsset>();
            track.trackName = "NEW TRACK";
            track.ResetToStarterOval();
            track.EnsureHandWorkMatchesGrid();

            string assetPath = AssetDatabase.GenerateUniqueAssetPath($"{AssetFolder}/New Track.asset");
            AssetDatabase.CreateAsset(track, assetPath);

            var go = new GameObject("Track");
            var authoring = go.AddComponent<TrackAuthoring>();
            authoring.track = track;
            authoring.terrainMaterial = CreateMaterial("Monster Truck Mania/Terrain", "MTM_TerrainMat");
            authoring.roadMaterial = CreateMaterial("Monster Truck Mania/Prop", "MTM_RoadMat");
            if (authoring.roadMaterial != null)
            {
                // A dark road so the untextured default reads as a surface
                // rather than as a white ribbon across the landscape.
                authoring.roadMaterial.SetColor("_BaseColor", new Color(0.32f, 0.28f, 0.24f));
            }

            authoring.Rebuild();

            Undo.RegisterCreatedObjectUndo(go, "Create track");
            Selection.activeGameObject = go;
            SceneView.lastActiveSceneView?.FrameSelected();

            AssetDatabase.SaveAssets();
            Debug.Log($"[MTM] Created {assetPath} and built it. " +
                      "Select the Track object and use the Rebuild button as you edit.");
        }

        [MenuItem("Monster Truck Mania/Add Retro Camera To Main Camera", false, 1)]
        public static void AddRetroCamera()
        {
            Camera camera = Camera.main;
            if (camera == null)
            {
                EditorUtility.DisplayDialog(
                    "No main camera",
                    "Tag a camera as MainCamera first, so there is something to attach to.",
                    "OK");
                return;
            }

            var retro = camera.GetComponent<RetroCamera>();
            if (retro == null) retro = Undo.AddComponent<RetroCamera>(camera.gameObject);

            retro.blitMaterial = CreateMaterial("Monster Truck Mania/Retro Blit", "MTM_RetroBlitMat");
            EditorUtility.SetDirty(retro);

            Debug.Log("[MTM] Retro camera attached. The game now renders at 240p and scales up.");
        }

        private static Material CreateMaterial(string shaderName, string fileName)
        {
            Shader shader = Shader.Find(shaderName);
            if (shader == null)
            {
                Debug.LogError($"[MTM] Shader '{shaderName}' not found. If the project has just " +
                               "been imported, wait for compilation to finish and try again.");
                return null;
            }

            Directory.CreateDirectory(AssetFolder);
            string path = $"{AssetFolder}/{fileName}.mat";
            var existing = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (existing != null) return existing;

            var material = new Material(shader) { name = fileName };
            AssetDatabase.CreateAsset(material, path);
            return material;
        }
    }
}
