// SPDX-License-Identifier: MIT
using System.IO;
using UnityEditor;
using UnityEngine;
using MonsterTruckMania.Authoring;
using MonsterTruckMania.Racing;
using MonsterTruckMania.Rendering;
using MonsterTruckMania.Simulation;
using MonsterTruckMania.Vehicles;

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

        [MenuItem("Monster Truck Mania/Set Up Race In Scene", false, 2)]
        public static void SetUpRace()
        {
            var track = Object.FindFirstObjectByType<TrackAuthoring>();
            if (track == null)
            {
                EditorUtility.DisplayDialog(
                    "No track in the scene",
                    "Run Create Track In Scene first, so there is a course to race on.",
                    "OK");
                return;
            }

            Camera camera = Camera.main;
            if (camera == null)
            {
                EditorUtility.DisplayDialog(
                    "No main camera",
                    "Tag a camera as MainCamera first, so the race has something to look through.",
                    "OK");
                return;
            }

            var chase = camera.GetComponent<ChaseCamera>();
            if (chase == null) chase = Undo.AddComponent<ChaseCamera>(camera.gameObject);

            var existing = Object.FindFirstObjectByType<RaceRunner>();
            GameObject go = existing != null ? existing.gameObject : new GameObject("Race");
            RaceRunner runner = existing != null ? existing : go.AddComponent<RaceRunner>();
            if (go.GetComponent<RaceHud>() == null) go.AddComponent<RaceHud>();

            runner.track = track;
            runner.chaseCamera = chase;
            runner.playerVehicle = EnsureVehicleAsset(StockVehicles.BoulderHog());
            runner.opponentVehicles.Clear();
            foreach (VehicleSpec spec in StockVehicles.All())
            {
                if (spec.Id == runner.playerVehicle.id) continue;
                runner.opponentVehicles.Add(EnsureVehicleAsset(spec));
            }

            // The truck the runner spawns has no art on it, so a bare scene is
            // driveable immediately. Assign a prefab to the runner when there
            // is one to look at.
            runner.truckPrefab = null;

            if (existing == null) Undo.RegisterCreatedObjectUndo(go, "Set up race");
            EditorUtility.SetDirty(runner);
            Selection.activeGameObject = go;
            AssetDatabase.SaveAssets();

            Debug.Log("[MTM] Race set up: press Play. The trucks have no bodies yet — " +
                      "assign a prefab with a TruckController to the runner when you model one.");
        }

        /// <summary>
        /// Make an editable asset out of a stock truck, once.
        /// </summary>
        /// <remarks>
        /// The roster lives in code so the offline tests can check it against
        /// the web game's numbers, but tuning a truck by editing a C# literal
        /// and waiting for a domain reload is miserable. This gives each one an
        /// asset to edit, and leaves an existing one alone so your tuning is
        /// not overwritten the next time you run the menu item.
        /// </remarks>
        private static VehicleAsset EnsureVehicleAsset(VehicleSpec spec)
        {
            Directory.CreateDirectory(AssetFolder);
            string path = $"{AssetFolder}/{spec.Id}.asset";
            var existing = AssetDatabase.LoadAssetAtPath<VehicleAsset>(path);
            if (existing != null) return existing;

            VehicleAsset asset = ScriptableObject.CreateInstance<VehicleAsset>();
            asset.CopyFrom(spec);
            AssetDatabase.CreateAsset(asset, path);
            return asset;
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
