// SPDX-License-Identifier: MIT
using UnityEngine;
using MonsterTruckMania.Simulation;
using MonsterTruckMania.Vehicles;

namespace MonsterTruckMania.Racing
{
    /// <summary>
    /// Turns the keyboard and a gamepad into a <see cref="DriveInput"/>.
    /// </summary>
    /// <remarks>
    /// Written against the legacy <c>UnityEngine.Input</c> class rather than
    /// the Input System package, to keep the promise that this folder needs no
    /// packages adding. If the project is set to <b>Input System Package
    /// (New)</b> under Player &gt; Active Input Handling, either switch it to
    /// <b>Both</b> or replace this one component — nothing else reads input.
    /// <para/>
    /// Raw axes, not smoothed ones: the drive model already rate-limits the
    /// steering, and smoothing it twice makes a two-tonne truck feel like it
    /// is on ice.
    /// <para/>
    /// It runs in <c>Update</c> and hands the truck its input there, while the
    /// truck consumes it in <c>FixedUpdate</c>. That is deliberate — sampling
    /// input on the physics step drops keypresses shorter than 16ms.
    /// </remarks>
    [AddComponentMenu("Monster Truck Mania/Player Driver")]
    public sealed class PlayerDriver : MonoBehaviour
    {
        [Tooltip("The truck to drive. Set by the race runner, or by hand for a test scene.")]
        public TruckController truck;

        [Tooltip("Optional: pressing the camera key cycles this camera's rig.")]
        public ChaseCamera chaseCamera;

        [Tooltip("Set by the race runner while the grid is held for the countdown.")]
        public bool parked;

        [Header("Keys")]
        public KeyCode handbrakeKey = KeyCode.Space;
        public KeyCode resetKey = KeyCode.R;
        public KeyCode cameraKey = KeyCode.C;
        public KeyCode lookBackKey = KeyCode.B;

        private void Update()
        {
            if (truck == null) return;

            float steer = 0f;
            if (Input.GetKey(KeyCode.LeftArrow) || Input.GetKey(KeyCode.A)) steer -= 1f;
            if (Input.GetKey(KeyCode.RightArrow) || Input.GetKey(KeyCode.D)) steer += 1f;

            float throttle = Input.GetKey(KeyCode.UpArrow) || Input.GetKey(KeyCode.W) ? 1f : 0f;
            float brake = Input.GetKey(KeyCode.DownArrow) || Input.GetKey(KeyCode.S) ? 1f : 0f;

            // A pad, when one is plugged in. Triggers read as a single axis on
            // most pads, positive for the right and negative for the left,
            // which is why they are split rather than added.
            float padSteer = Input.GetAxisRaw("Horizontal");
            if (Mathf.Abs(padSteer) > Mathf.Abs(steer)) steer = padSteer;
            float padDrive = Input.GetAxisRaw("Vertical");
            if (padDrive > throttle) throttle = padDrive;
            if (-padDrive > brake) brake = -padDrive;

            truck.SetInput(new DriveInput
            {
                Steer = Mathf.Clamp(steer, -1f, 1f),
                Throttle = Mathf.Clamp01(throttle),
                Brake = Mathf.Clamp01(brake),
                Handbrake = Input.GetKey(handbrakeKey),
                Parked = parked,
            });

            if (Input.GetKeyDown(resetKey))
            {
                // Keep the heading. Respawning face-on to +Z would point the
                // truck across the road on every course but one.
                float heading = Mathf.Atan2(truck.transform.forward.x, truck.transform.forward.z);
                truck.Respawn(truck.transform.position + Vector3.up * 3f, heading);
            }
            if (chaseCamera != null)
            {
                if (Input.GetKeyDown(cameraKey)) chaseCamera.CycleMode();
                chaseCamera.SetLookingBack(Input.GetKey(lookBackKey));
            }
        }
    }
}
