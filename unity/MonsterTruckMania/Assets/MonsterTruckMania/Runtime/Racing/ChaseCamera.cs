// SPDX-License-Identifier: MIT
using UnityEngine;
using MonsterTruckMania.Vehicles;

namespace MonsterTruckMania.Racing
{
    public enum CameraMode
    {
        Chase,
        Close,
        Hood,
    }

    /// <summary>
    /// Chase camera.
    /// </summary>
    /// <remarks>
    /// Follows the truck's yaw only. Inheriting pitch and roll is technically
    /// more correct and completely unplayable — one barrel roll and the player
    /// loses all sense of where the ground is. Keeping the camera level and
    /// letting the truck tumble inside the frame is what the originals did.
    /// <para/>
    /// The rigs are framed for a monster truck: the body sits roughly two
    /// metres up and stands another two above that, so they are higher and
    /// further back than a car would need, and they aim above the roofline.
    /// <para/>
    /// Runs in <c>LateUpdate</c> so it sees the truck's final position for the
    /// frame; in <c>Update</c> it trails a frame behind and visibly judders.
    /// </remarks>
    [AddComponentMenu("Monster Truck Mania/Chase Camera")]
    [RequireComponent(typeof(Camera))]
    public sealed class ChaseCamera : MonoBehaviour
    {
        /// <summary>Minimum height the camera keeps above the ground, in metres.</summary>
        private const float GroundClearance = 1.8f;

        [Tooltip("The truck to follow. Set by the race runner when it spawns the field.")]
        public TruckController target;

        public CameraMode mode = CameraMode.Chase;

        [Tooltip("Layers the ground probe raycasts against, to keep the camera above the terrain.")]
        public LayerMask groundLayers = ~0;

        private Camera _camera;
        private Vector3 _position;
        private Vector3 _lookAt;
        private bool _initialised;
        private bool _lookingBack;

        private struct Rig
        {
            public Vector3 Offset;
            /// <summary>How far ahead of the truck the camera aims.</summary>
            public float LookAhead;
            /// <summary>Position smoothing half-life in seconds; lower is tighter.</summary>
            public float Responsiveness;
            public float BaseFov;
        }

        private static Rig RigFor(CameraMode mode)
        {
            switch (mode)
            {
                case CameraMode.Close:
                    return new Rig { Offset = new Vector3(0f, 4.4f, -9.5f), LookAhead = 7f, Responsiveness = 0.06f, BaseFov = 74f };
                case CameraMode.Hood:
                    // Roughly where a driver's head would be, above the front axle.
                    return new Rig { Offset = new Vector3(0f, 1.5f, 1.1f), LookAhead = 16f, Responsiveness = 0.02f, BaseFov = 82f };
                default:
                    return new Rig { Offset = new Vector3(0f, 6.0f, -13.5f), LookAhead = 9f, Responsiveness = 0.10f, BaseFov = 68f };
            }
        }

        private void Awake() => _camera = GetComponent<Camera>();

        /// <summary>Snap to the truck without smoothing, after a respawn or a restart.</summary>
        public void Snap() => _initialised = false;

        public void CycleMode()
        {
            mode = mode == CameraMode.Hood ? CameraMode.Chase : mode + 1;
            Snap();
        }

        public void SetLookingBack(bool lookingBack) => _lookingBack = lookingBack;

        private void LateUpdate()
        {
            if (target == null) return;

            Rig rig = RigFor(mode);
            float dt = Time.deltaTime;

            // Yaw only: strip pitch and roll out of the truck's orientation.
            Vector3 forward = target.transform.forward;
            float truckYaw = Mathf.Atan2(forward.x, forward.z);
            float yaw = _lookingBack ? truckYaw + Mathf.PI : truckYaw;

            Vector3 flatForward = new Vector3(Mathf.Sin(yaw), 0f, Mathf.Cos(yaw));
            Vector3 flatRight = new Vector3(flatForward.z, 0f, -flatForward.x);
            Vector3 anchor = target.transform.position;

            Vector3 desired = anchor
                              + flatForward * rig.Offset.z
                              + flatRight * rig.Offset.x
                              + Vector3.up * rig.Offset.y;

            // Pull back a little with speed, so fast trucks don't fill the frame.
            float speed = target.Speed;
            desired -= flatForward * (Mathf.Clamp01(speed / 45f) * 2.2f);

            Vector3 desiredLookAt = anchor + flatForward * rig.LookAhead + Vector3.up * 2.2f;

            if (!_initialised)
            {
                _position = desired;
                _lookAt = desiredLookAt;
                _initialised = true;
            }
            else
            {
                // Frame-rate independent exponential smoothing.
                float positionBlend = 1f - Mathf.Exp(-dt / Mathf.Max(0.001f, rig.Responsiveness));
                float lookBlend = 1f - Mathf.Exp(-dt / 0.07f);
                _position = Vector3.Lerp(_position, desired, positionBlend);
                _lookAt = Vector3.Lerp(_lookAt, desiredLookAt, lookBlend);
            }

            // Hold the camera clear of the ground. Applied after smoothing so
            // the lift is immediate — easing it in lets the terrain swallow the
            // camera for a few frames on a sharp crest, which is exactly when
            // it matters most.
            if (Physics.Raycast(new Vector3(_position.x, _position.y + 200f, _position.z), Vector3.down,
                                out RaycastHit hit, 400f, groundLayers, QueryTriggerInteraction.Ignore))
            {
                float floor = hit.point.y + GroundClearance;
                if (_position.y < floor) _position.y = floor;
            }

            transform.SetPositionAndRotation(_position, Quaternion.LookRotation(_lookAt - _position, Vector3.up));

            // Widen the lens with speed, for a cheap sense of velocity.
            float targetFov = rig.BaseFov + Mathf.Clamp01(speed / 50f) * 10f;
            _camera.fieldOfView += (targetFov - _camera.fieldOfView) * (1f - Mathf.Exp(-dt / 0.25f));
        }
    }
}
