// SPDX-License-Identifier: MIT
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using MonsterTruckMania.Authoring;
using MonsterTruckMania.Generation;

namespace MonsterTruckMania.EditorTools
{
    /// <summary>
    /// The track editor: drag the spline, rebuild, sculpt, paint.
    /// </summary>
    /// <remarks>
    /// The design rule throughout is that the scene view shows the real thing.
    /// The line drawn between control points is the actual generated
    /// centreline, sampled from the same <see cref="RoadPath"/> the terrain is
    /// carved against — not a Bézier approximation of it. That is why this
    /// does not use Unity's Splines package: it is Bézier, the road is
    /// centripetal Catmull-Rom, and an editor that shows you a different curve
    /// from the one it builds is worse than no preview at all.
    /// </remarks>
    [CustomEditor(typeof(TrackAuthoring))]
    public class TrackAuthoringEditor : Editor
    {
        // Named EditTool, not Tool: UnityEditor already has a Tool enum, and
        // a nested type with the same name silently shadows it inside this
        // class while being ambiguous anywhere else.
        private enum EditTool { None, Spline, Sculpt, Paint }
        private enum SculptMode { Raise, Lower, Smooth, Flatten }

        private static EditTool _tool = EditTool.Spline;
        private static SculptMode _sculptMode = SculptMode.Raise;
        private static float _brushRadius = 30f;
        private static float _brushStrength = 1.5f;
        private static int _paintLayer = 0;
        private static bool _autoRebuild;

        private int _selectedPoint = -1;
        private double _lastStrokeTime;
        private bool _strokeDirty;

        // ------------------------------------------------------------------
        // Inspector
        // ------------------------------------------------------------------

        public override void OnInspectorGUI()
        {
            var authoring = (TrackAuthoring)target;

            DrawDefaultInspector();

            if (authoring.track == null)
            {
                EditorGUILayout.HelpBox(
                    "Assign a Track asset. Create one with Assets > Create > " +
                    "Monster Truck Mania > Track.", MessageType.Info);
                return;
            }

            EditorGUILayout.Space();
            DrawRebuildBar(authoring);
            EditorGUILayout.Space();
            DrawToolbar();

            switch (_tool)
            {
                case EditTool.Spline: DrawSplinePanel(authoring); break;
                case EditTool.Sculpt: DrawSculptPanel(authoring); break;
                case EditTool.Paint: DrawPaintPanel(authoring); break;
            }

            if (!string.IsNullOrEmpty(authoring.LastWarning))
            {
                EditorGUILayout.HelpBox(authoring.LastWarning, MessageType.Warning);
            }
        }

        private void DrawRebuildBar(TrackAuthoring authoring)
        {
            using (new EditorGUILayout.HorizontalScope())
            {
                GUI.backgroundColor = new Color(0.6f, 0.9f, 0.6f);
                if (GUILayout.Button("Rebuild", GUILayout.Height(30)))
                {
                    Rebuild(authoring);
                }
                GUI.backgroundColor = Color.white;

                _autoRebuild = GUILayout.Toggle(_autoRebuild, "Auto", "Button",
                                                GUILayout.Width(50), GUILayout.Height(30));
            }

            if (_autoRebuild)
            {
                EditorGUILayout.HelpBox(
                    "Auto rebuilds when you let go of a handle. Turn it off on a " +
                    "large field — a 256-segment grid is a quarter of a million " +
                    "vertices and cooking its collider is not interactive.",
                    MessageType.None);
            }

            if (authoring.LastTerrainVertices > 0)
            {
                EditorGUILayout.LabelField(
                    "Last build",
                    $"{authoring.LastTerrainVertices:N0} terrain vertices" +
                    (authoring.Road != null ? $", {authoring.Road.Points.Count:N0} road samples, " +
                                              $"{authoring.Road.Length:N0}m" : ""));
            }
        }

        private static void DrawToolbar()
        {
            _tool = (EditTool)GUILayout.Toolbar((int)_tool,
                new[] { "Off", "Spline", "Sculpt", "Paint" }, GUILayout.Height(24));
        }

        private void DrawSplinePanel(TrackAuthoring authoring)
        {
            TrackAsset track = authoring.track;
            EditorGUILayout.HelpBox(
                "Drag the handles in the scene view. Shift-click a segment to " +
                "insert a point, and select one and press Delete to remove it.",
                MessageType.None);

            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Starter oval"))
                {
                    Undo.RecordObject(track, "Reset road");
                    track.ResetToStarterOval(track.terrainSize * 0.28f);
                    EditorUtility.SetDirty(track);
                    Rebuild(authoring);
                }
                using (new EditorGUI.DisabledScope(_selectedPoint < 0))
                {
                    if (GUILayout.Button("Delete selected"))
                    {
                        DeletePoint(track, _selectedPoint);
                        _selectedPoint = -1;
                        Rebuild(authoring);
                    }
                }
            }

            EditorGUILayout.LabelField("Control points", track.controlPoints.Count.ToString());
            if (track.controlPoints.Count < 2)
            {
                EditorGUILayout.HelpBox("A road needs at least two points.", MessageType.Warning);
            }
        }

        private void DrawSculptPanel(TrackAuthoring authoring)
        {
            EditorGUILayout.HelpBox(
                "Drag in the scene view to sculpt. Hold Ctrl to invert. " +
                "Sculpting is stored as offsets on top of the generated ground, " +
                "so rebuilding keeps it.",
                MessageType.None);

            _sculptMode = (SculptMode)EditorGUILayout.EnumPopup("Mode", _sculptMode);
            BrushFields();

            if (authoring.Field == null)
            {
                EditorGUILayout.HelpBox("Rebuild once before sculpting.", MessageType.Warning);
            }

            if (GUILayout.Button("Clear all sculpting"))
            {
                if (EditorUtility.DisplayDialog(
                        "Clear sculpting",
                        "Discard every height offset painted onto this track? " +
                        "This cannot be undone from here.", "Discard", "Cancel"))
                {
                    Undo.RecordObject(authoring.track, "Clear sculpting");
                    System.Array.Clear(authoring.track.sculptOffsets, 0,
                                       authoring.track.sculptOffsets.Length);
                    EditorUtility.SetDirty(authoring.track);
                    Rebuild(authoring);
                }
            }
        }

        private void DrawPaintPanel(TrackAuthoring authoring)
        {
            TrackAsset track = authoring.track;
            EditorGUILayout.HelpBox(
                "Drag to paint a layer in. Unpainted ground falls back to the " +
                "automatic rules — rock on steep slopes, a worn verge by the road.",
                MessageType.None);

            var names = new string[4];
            for (int i = 0; i < 4; i++)
            {
                names[i] = track.layers != null && i < track.layers.Length && track.layers[i] != null
                    ? $"{i + 1}. {track.layers[i].name}"
                    : $"{i + 1}.";
            }
            _paintLayer = GUILayout.SelectionGrid(_paintLayer, names, 2);
            BrushFields();

            if (authoring.Field == null)
            {
                EditorGUILayout.HelpBox("Rebuild once before painting.", MessageType.Warning);
            }

            if (GUILayout.Button("Clear all painting"))
            {
                if (EditorUtility.DisplayDialog(
                        "Clear painting",
                        "Discard every painted weight and go back to the automatic " +
                        "rules everywhere?", "Discard", "Cancel"))
                {
                    Undo.RecordObject(track, "Clear painting");
                    System.Array.Clear(track.paintWeights, 0, track.paintWeights.Length);
                    EditorUtility.SetDirty(track);
                    Rebuild(authoring);
                }
            }
        }

        private static void BrushFields()
        {
            _brushRadius = EditorGUILayout.Slider("Radius (m)", _brushRadius, 2f, 200f);
            _brushStrength = EditorGUILayout.Slider("Strength", _brushStrength, 0.05f, 10f);
        }

        // ------------------------------------------------------------------
        // Scene view
        // ------------------------------------------------------------------

        private void OnSceneGUI()
        {
            var authoring = (TrackAuthoring)target;
            if (authoring.track == null) return;

            DrawRoadPreview(authoring);

            switch (_tool)
            {
                case EditTool.Spline: SplineHandles(authoring); break;
                case EditTool.Sculpt:
                case EditTool.Paint: BrushInteraction(authoring); break;
            }
        }

        /// <summary>
        /// Draw the centreline the game will actually build.
        /// </summary>
        /// <remarks>
        /// Sampled from a real <see cref="RoadPath"/>, not from the control
        /// polygon, so the curvature you see between two handles is the
        /// curvature the terrain gets carved to.
        /// </remarks>
        private static void DrawRoadPreview(TrackAuthoring authoring)
        {
            TrackAsset track = authoring.track;
            if (track.controlPoints == null || track.controlPoints.Count < 2) return;

            // Coarser than the build: this runs on every repaint, and at 1.5m
            // spacing a 1500m course is a thousand line segments per frame.
            var road = new RoadPath(track.BuildControlPoints(), track.closedCircuit,
                                    track.roadWidth, track.shoulder, 4f);

            int count = road.Points.Count;
            if (count < 2) return;

            var centre = new Vector3[count + (track.closedCircuit ? 1 : 0)];
            for (int i = 0; i < centre.Length; i++)
            {
                Vec3 p = road.Points[i % count];
                centre[i] = new Vector3((float)p.X, (float)p.Y, (float)p.Z);
            }

            Handles.color = new Color(1f, 0.7f, 0.15f);
            Handles.DrawAAPolyLine(4f, centre);

            // The edges of the carved corridor, which is what decides how much
            // of the landscape the road eats.
            DrawOffsetLine(road, track.roadWidth * 0.5f, new Color(1f, 1f, 1f, 0.5f));
            DrawOffsetLine(road, -track.roadWidth * 0.5f, new Color(1f, 1f, 1f, 0.5f));
            float outer = track.roadWidth * 0.5f + track.shoulder;
            DrawOffsetLine(road, outer, new Color(0.4f, 0.8f, 1f, 0.35f));
            DrawOffsetLine(road, -outer, new Color(0.4f, 0.8f, 1f, 0.35f));
        }

        private static void DrawOffsetLine(RoadPath road, float offset, Color color)
        {
            int count = road.Points.Count;
            var line = new Vector3[count + 1];
            for (int i = 0; i <= count; i++)
            {
                int k = i % count;
                Vec3 p = road.Points[k];
                Vec3 r = road.RightAt(k);
                line[i] = new Vector3(
                    (float)(p.X + r.X * offset), (float)p.Y, (float)(p.Z + r.Z * offset));
            }
            Handles.color = color;
            Handles.DrawAAPolyLine(2f, line);
        }

        private void SplineHandles(TrackAuthoring authoring)
        {
            TrackAsset track = authoring.track;
            List<Vector3> points = track.controlPoints;
            bool changed = false;

            for (int i = 0; i < points.Count; i++)
            {
                float size = HandleUtility.GetHandleSize(points[i]) * 0.12f;

                Handles.color = i == _selectedPoint ? Color.yellow : new Color(1f, 0.5f, 0.1f);
                if (Handles.Button(points[i], Quaternion.identity, size, size * 1.4f, Handles.SphereHandleCap))
                {
                    _selectedPoint = i;
                    Repaint();
                }

                if (i != _selectedPoint) continue;

                EditorGUI.BeginChangeCheck();
                Vector3 moved = Handles.PositionHandle(points[i], Quaternion.identity);
                if (EditorGUI.EndChangeCheck())
                {
                    Undo.RecordObject(track, "Move road point");
                    points[i] = moved;
                    EditorUtility.SetDirty(track);
                    changed = true;
                }
            }

            HandleInsertAndDelete(authoring, track, points, ref changed);

            if (changed && _autoRebuild) Rebuild(authoring);
        }

        private void HandleInsertAndDelete(TrackAuthoring authoring, TrackAsset track,
                                           List<Vector3> points, ref bool changed)
        {
            Event e = Event.current;

            if (e.type == EventType.MouseDown && e.button == 0 && e.shift)
            {
                // Insert into whichever segment the click is nearest, so a new
                // point lands where it was asked for rather than at the end.
                Ray ray = HandleUtility.GUIPointToWorldRay(e.mousePosition);
                var ground = new Plane(Vector3.up, Vector3.zero);
                if (ground.Raycast(ray, out float distance))
                {
                    Vector3 hit = ray.GetPoint(distance);
                    if (authoring.TryGetHeight(hit, out float y)) hit.y = y;

                    int insertAfter = NearestSegment(points, hit, track.closedCircuit);
                    Undo.RecordObject(track, "Insert road point");
                    points.Insert(insertAfter + 1, hit);
                    _selectedPoint = insertAfter + 1;
                    EditorUtility.SetDirty(track);
                    changed = true;
                    e.Use();
                }
            }

            if (e.type == EventType.KeyDown && (e.keyCode == KeyCode.Delete || e.keyCode == KeyCode.Backspace)
                && _selectedPoint >= 0)
            {
                DeletePoint(track, _selectedPoint);
                _selectedPoint = -1;
                changed = true;
                e.Use();
            }
        }

        private static void DeletePoint(TrackAsset track, int index)
        {
            if (index < 0 || index >= track.controlPoints.Count) return;
            if (track.controlPoints.Count <= 2)
            {
                Debug.LogWarning("[MTM] A road needs at least two control points.");
                return;
            }
            Undo.RecordObject(track, "Delete road point");
            track.controlPoints.RemoveAt(index);
            EditorUtility.SetDirty(track);
        }

        private static int NearestSegment(List<Vector3> points, Vector3 target, bool closed)
        {
            int best = 0;
            float bestDistance = float.MaxValue;
            int last = closed ? points.Count : points.Count - 1;
            for (int i = 0; i < last; i++)
            {
                Vector3 a = points[i];
                Vector3 b = points[(i + 1) % points.Count];
                float d = HandleUtility.DistancePointLine(target, a, b);
                if (d < bestDistance)
                {
                    bestDistance = d;
                    best = i;
                }
            }
            return best;
        }

        // ------------------------------------------------------------------
        // Brushes
        // ------------------------------------------------------------------

        private void BrushInteraction(TrackAuthoring authoring)
        {
            if (authoring.Field == null) return;

            Event e = Event.current;
            // Take control of the scene view so dragging paints instead of
            // rubber-band selecting.
            int id = GUIUtility.GetControlID(FocusType.Passive);
            if (e.type == EventType.Layout) HandleUtility.AddDefaultControl(id);

            Ray ray = HandleUtility.GUIPointToWorldRay(e.mousePosition);
            if (!RaycastField(authoring.Field, ray, out Vector3 hit)) return;

            Handles.color = _tool == EditTool.Sculpt
                ? new Color(0.4f, 1f, 0.5f, 0.9f)
                : new Color(0.4f, 0.7f, 1f, 0.9f);
            Handles.DrawWireDisc(hit, Vector3.up, _brushRadius);
            Handles.DrawWireDisc(hit, Vector3.up, _brushRadius * 0.5f);

            if ((e.type == EventType.MouseDown || e.type == EventType.MouseDrag) && e.button == 0
                && !e.alt)
            {
                bool invert = e.control || e.command;
                if (_tool == EditTool.Sculpt) ApplySculpt(authoring, hit, invert);
                else ApplyPaint(authoring, hit, invert);
                e.Use();
            }

            if (e.type == EventType.MouseUp && _strokeDirty)
            {
                _strokeDirty = false;
                Rebuild(authoring);
            }

            SceneView.RepaintAll();
        }

        /// <summary>
        /// March along the ray until it drops below the height field.
        /// </summary>
        /// <remarks>
        /// Deliberately not a physics raycast: the brushes have to work with
        /// the collider turned off — which is exactly when you want them,
        /// because that is how a big field stays responsive — and must not
        /// pick up whatever props are lying on the ground.
        /// </remarks>
        private static bool RaycastField(TerrainField field, Ray ray, out Vector3 hit)
        {
            hit = default;
            const float maxDistance = 4000f;
            float step = Mathf.Max(1f, (float)field.ElementSize * 0.5f);

            float previous = 0f;
            bool previousAbove = true;
            for (float d = 1f; d < maxDistance; d += step)
            {
                Vector3 p = ray.GetPoint(d);
                float ground = (float)field.SampleHeight(p.x, p.z);
                bool above = p.y > ground;

                if (!above && previousAbove && d > 1f)
                {
                    // Bisect the crossing so the brush centre does not jitter
                    // by half a step as the camera moves.
                    float lo = previous, hi = d;
                    for (int i = 0; i < 12; i++)
                    {
                        float mid = (lo + hi) * 0.5f;
                        Vector3 m = ray.GetPoint(mid);
                        if (m.y > (float)field.SampleHeight(m.x, m.z)) lo = mid; else hi = mid;
                    }
                    hit = ray.GetPoint((lo + hi) * 0.5f);
                    return true;
                }

                previous = d;
                previousAbove = above;
            }
            return false;
        }

        private void ApplySculpt(TrackAuthoring authoring, Vector3 centre, bool invert)
        {
            TrackAsset track = authoring.track;
            TerrainField field = authoring.Field;
            track.EnsureHandWorkMatchesGrid();

            Undo.RecordObject(track, "Sculpt terrain");

            float sign = invert ? -1f : 1f;
            if (_sculptMode == SculptMode.Lower) sign = -sign;

            ForEachVertexInBrush(field, centre, (i, ix, iz, falloff) =>
            {
                switch (_sculptMode)
                {
                    case SculptMode.Raise:
                    case SculptMode.Lower:
                        track.sculptOffsets[i] += sign * _brushStrength * falloff;
                        break;

                    case SculptMode.Smooth:
                    {
                        // Average the neighbours' final heights, then move the
                        // offset towards whatever would produce that.
                        double target = NeighbourAverage(field, ix, iz);
                        double current = field.Heights[i];
                        track.sculptOffsets[i] += (float)((target - current) * falloff * 0.5);
                        break;
                    }

                    case SculptMode.Flatten:
                    {
                        double target = field.SampleHeight(centre.x, centre.z);
                        double current = field.Heights[i];
                        track.sculptOffsets[i] += (float)((target - current) * falloff * 0.5);
                        break;
                    }
                }
            });

            EditorUtility.SetDirty(track);
            MarkStroke(authoring);
        }

        private static double NeighbourAverage(TerrainField field, int ix, int iz)
        {
            int n = field.Segments;
            double total = 0;
            int count = 0;
            for (int dz = -1; dz <= 1; dz++)
            {
                for (int dx = -1; dx <= 1; dx++)
                {
                    int x = ix + dx, z = iz + dz;
                    if (x < 0 || x > n || z < 0 || z > n) continue;
                    total += field.Heights[field.Index(x, z)];
                    count++;
                }
            }
            return count > 0 ? total / count : field.Heights[field.Index(ix, iz)];
        }

        private void ApplyPaint(TrackAuthoring authoring, Vector3 centre, bool erase)
        {
            TrackAsset track = authoring.track;
            TerrainField field = authoring.Field;
            track.EnsureHandWorkMatchesGrid();

            Undo.RecordObject(track, "Paint terrain");

            ForEachVertexInBrush(field, centre, (i, ix, iz, falloff) =>
            {
                Color32 c = track.paintWeights[i];
                var w = new float[4] { c.r / 255f, c.g / 255f, c.b / 255f, c.a / 255f };

                // An untouched vertex is all zeroes, which the builder reads as
                // "use the automatic rules". The first stroke has to seed it
                // with the base layer or painting 20% of layer 2 would make the
                // ground 80% nothing.
                if (c.r == 0 && c.g == 0 && c.b == 0 && c.a == 0) w[0] = 1f;

                float amount = Mathf.Clamp01(falloff * _brushStrength * 0.15f);
                if (erase) amount = -amount;
                w[_paintLayer] = Mathf.Clamp01(w[_paintLayer] + amount);

                // Renormalise so the four always sum to one: the shader adds
                // the layers, so letting them drift washes the ground out or
                // darkens it.
                float total = w[0] + w[1] + w[2] + w[3];
                if (total < 1e-4f) { w[0] = 1f; total = 1f; }
                for (int k = 0; k < 4; k++) w[k] /= total;

                track.paintWeights[i] = new Color32(
                    (byte)(w[0] * 255f), (byte)(w[1] * 255f),
                    (byte)(w[2] * 255f), (byte)(w[3] * 255f));
            });

            EditorUtility.SetDirty(track);
            MarkStroke(authoring);
        }

        private delegate void VertexAction(int index, int ix, int iz, float falloff);

        private void ForEachVertexInBrush(TerrainField field, Vector3 centre, VertexAction action)
        {
            int n = field.Segments;
            int radius = Mathf.CeilToInt(_brushRadius / (float)field.ElementSize) + 1;
            int cx = field.ColumnAt(centre.x);
            int cz = field.RowAt(centre.z);

            for (int iz = Mathf.Max(0, cz - radius); iz <= Mathf.Min(n, cz + radius); iz++)
            {
                for (int ix = Mathf.Max(0, cx - radius); ix <= Mathf.Min(n, cx + radius); ix++)
                {
                    float dx = (float)field.WorldX(ix) - centre.x;
                    float dz = (float)field.WorldZ(iz) - centre.z;
                    float d = Mathf.Sqrt(dx * dx + dz * dz);
                    if (d > _brushRadius) continue;

                    // Smooth falloff, so a stroke does not leave a visible
                    // circular rim where the brush ended.
                    float falloff = 1f - Mathf.SmoothStep(0f, _brushRadius, d);
                    action(field.Index(ix, iz), ix, iz, falloff);
                }
            }
        }

        /// <summary>
        /// Rebuild while dragging, but not on every single mouse move.
        /// </summary>
        /// <remarks>
        /// Regenerating a large field takes long enough that doing it per
        /// mouse-move makes the brush feel stuck. Throttling to a few times a
        /// second keeps it responsive, and the mouse-up rebuild guarantees the
        /// final state is correct however the throttle landed.
        /// </remarks>
        private void MarkStroke(TrackAuthoring authoring)
        {
            _strokeDirty = true;
            double now = EditorApplication.timeSinceStartup;
            if (now - _lastStrokeTime < 0.2) return;
            _lastStrokeTime = now;
            Rebuild(authoring);
        }

        private static void Rebuild(TrackAuthoring authoring)
        {
            authoring.Rebuild();
            EditorUtility.SetDirty(authoring);
            if (!Application.isPlaying)
            {
                UnityEditor.SceneManagement.EditorSceneManager.MarkSceneDirty(
                    authoring.gameObject.scene);
            }
        }
    }
}
