// SPDX-License-Identifier: MIT
using System.Collections.Generic;
using UnityEngine;
using MonsterTruckMania.Simulation;

namespace MonsterTruckMania.Racing
{
    /// <summary>
    /// Position, lap, clock, speed and the running order.
    /// </summary>
    /// <remarks>
    /// Drawn with IMGUI on purpose. A UGUI HUD is prefabs and layout groups
    /// and a font asset — none of which can be authored outside the editor —
    /// and this project's whole point is that a track becomes driveable
    /// without any of that. So this reads out everything the race director
    /// knows, in the right places on screen, using nothing but code. Replace it
    /// with a canvas when the game has art; nothing else depends on it.
    /// <para/>
    /// The layout follows the web game's: position and lap top left, clock top
    /// right, running order bottom left, speed bottom right.
    /// </remarks>
    [AddComponentMenu("Monster Truck Mania/Race HUD")]
    public sealed class RaceHud : MonoBehaviour
    {
        [Tooltip("The race to read. Found on this object or its parents when empty.")]
        public RaceRunner runner;

        [Tooltip("Scales the whole readout. A Deck's screen wants about 1.4.")]
        [Range(0.5f, 3f)]
        public float scale = 1f;

        private GUIStyle _box;
        private GUIStyle _label;
        private GUIStyle _big;
        private GUIStyle _centre;

        private static readonly Color Amber = new Color(1f, 0.69f, 0.13f);
        private static readonly Color Paper = new Color(0.91f, 0.89f, 0.82f);

        private void Awake()
        {
            if (runner == null) runner = GetComponentInParent<RaceRunner>();
        }

        private void EnsureStyles()
        {
            if (_box != null) return;

            var background = new Texture2D(1, 1);
            background.SetPixel(0, 0, new Color(0.08f, 0.08f, 0.06f, 0.72f));
            background.Apply();

            _box = new GUIStyle(GUI.skin.box) { padding = new RectOffset(10, 10, 8, 8) };
            _box.normal.background = background;
            _label = new GUIStyle(GUI.skin.label) { fontSize = 12, richText = false };
            _label.normal.textColor = Paper;
            _big = new GUIStyle(_label) { fontSize = 30, fontStyle = FontStyle.Bold };
            _big.normal.textColor = Amber;
            _centre = new GUIStyle(_big) { fontSize = 54, alignment = TextAnchor.MiddleCenter };
        }

        private void OnGUI()
        {
            RaceDirector director = runner != null ? runner.Director : null;
            if (director == null) return;

            EnsureStyles();
            Matrix4x4 saved = GUI.matrix;
            GUI.matrix = Matrix4x4.TRS(Vector3.zero, Quaternion.identity, Vector3.one * scale);

            float width = Screen.width / scale;
            float height = Screen.height / scale;
            Racer player = director.Player;

            if (player != null)
            {
                GUILayout.BeginArea(new Rect(12, 12, 150, 90), _box);
                GUILayout.Label("POS", _label);
                GUILayout.Label(RaceDirector.Ordinal(player.PositionIndex), _big);
                GUILayout.Label($"LAP  {Mathf.Min(player.Lap + 1, director.TotalLaps)}/{director.TotalLaps}", _label);
                GUILayout.EndArea();

                GUILayout.BeginArea(new Rect(width - 212, 12, 200, 84), _box);
                GUILayout.Label("TIME", _label);
                GUILayout.Label(RaceDirector.FormatTime(director.Clock), _big);
                GUILayout.Label($"BEST {RaceDirector.FormatTime(player.BestLap)}", _label);
                GUILayout.EndArea();
            }

            List<Racer> standings = director.Standings();
            GUILayout.BeginArea(new Rect(12, height - 26 - standings.Count * 16, 220, standings.Count * 16 + 26), _box);
            GUILayout.Label("FIELD", _label);
            for (int i = 0; i < standings.Count; i++)
            {
                Racer racer = standings[i];
                Color previous = GUI.color;
                if (racer.IsPlayer) GUI.color = Amber;
                GUILayout.Label($"{racer.PositionIndex}. {racer.Name}  L{racer.Lap + 1}", _label);
                GUI.color = previous;
            }
            GUILayout.EndArea();

            if (runner.PlayerTruck != null)
            {
                // Miles per hour: the original's speedo was imperial, and the
                // numbers are half the fun of a monster truck.
                int mph = Mathf.RoundToInt(Mathf.Abs(runner.PlayerTruck.ForwardSpeed) * 2.23694f);
                GUILayout.BeginArea(new Rect(width - 132, height - 78, 120, 66), _box);
                GUILayout.Label(mph.ToString(), _big);
                GUILayout.Label("MPH", _label);
                GUILayout.EndArea();
            }

            string countdown = director.CountdownLabel();
            if (countdown != null)
            {
                GUI.color = countdown == "GO!" ? new Color(0.35f, 0.75f, 0.13f) : Amber;
                GUI.Label(new Rect(0, height * 0.35f, width, 80), countdown, _centre);
                GUI.color = Color.white;
            }
            else if (player != null && player.WrongWay)
            {
                GUI.color = new Color(0.88f, 0.13f, 0.13f);
                GUI.Label(new Rect(0, height * 0.28f, width, 60), "WRONG WAY", _centre);
                GUI.color = Color.white;
            }

            if (director.Phase == RacePhase.Finished && player != null)
            {
                GUI.Label(new Rect(0, height * 0.42f, width, 80),
                          $"FINISHED {RaceDirector.Ordinal(player.PositionIndex)}", _centre);
            }

            GUI.matrix = saved;
        }
    }
}
