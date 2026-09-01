// SPDX-License-Identifier: MIT
using System.Collections.Generic;
using UnityEngine;
using MonsterTruckMania.Authoring;
using MonsterTruckMania.Generation;
using MonsterTruckMania.Simulation;
using MonsterTruckMania.Vehicles;

namespace MonsterTruckMania.Racing
{
    /// <summary>
    /// Runs a race: builds the grid, spawns the field, drives the AI, steps the
    /// director and rescues anyone who has stopped being able to race.
    /// </summary>
    /// <remarks>
    /// The Unity end of <see cref="RaceDirector"/>. Everything that decides
    /// anything — gate order, lap times, standings, what the AI asks for — is
    /// in the plain-C# simulation namespace and covered by the offline tests.
    /// This component moves numbers between that and the scene: it writes each
    /// truck's transform onto its <see cref="Racer"/>, and hands each AI's
    /// <see cref="DriveInput"/> to its <see cref="TruckController"/>.
    /// <para/>
    /// It also owns two global physics settings, because every tuning number in
    /// the project assumes them: gravity at 2g, so trucks land instead of
    /// floating, and a 60Hz fixed step to match the original's simulation rate.
    /// Both are restored when the race ends, so entering play mode does not
    /// quietly reconfigure the whole project.
    /// </remarks>
    [AddComponentMenu("Monster Truck Mania/Race Runner")]
    public sealed class RaceRunner : MonoBehaviour
    {
        [Header("Course")]
        [Tooltip("The track to race on. Its road spline becomes the gates and the grid.")]
        public TrackAuthoring track;
        [Min(1)]
        public int laps = 3;

        [Header("Field")]
        [Tooltip("Prefab with a TruckController on it, used for every racer.")]
        public TruckController truckPrefab;
        [Tooltip("The player's truck. Falls back to the built-in baseline when empty.")]
        public VehicleAsset playerVehicle;
        [Tooltip("Trucks the opponents are drawn from, in order. Wraps if there are more racers than entries.")]
        public List<VehicleAsset> opponentVehicles = new List<VehicleAsset>();
        [Range(0, 11)]
        public int opponents = 5;
        public Difficulty difficulty = Difficulty.Pro;
        [Tooltip("Seeds the AI's lane offsets, so a race replays the same way.")]
        public int seed = 1;

        [Header("Scene")]
        public ChaseCamera chaseCamera;

        /// <summary>
        /// 2g. Every suspension, drive and grip number in the project is
        /// calibrated against it — changing it invalidates all of them.
        /// </summary>
        private const float RaceGravity = -19.6f;

        /// <summary>The original ran a fixed 60Hz step, decoupled from rendering.</summary>
        private const float FixedStep = 1f / 60f;

        private RaceCourse _course;
        private RaceDirector _director;
        private readonly List<TruckController> _trucks = new List<TruckController>();
        private readonly List<AIDriver> _drivers = new List<AIDriver>();
        private readonly List<Racer> _entries = new List<Racer>();
        private TruckController _playerTruck;
        private PlayerDriver _playerDriver;

        private Vector3 _savedGravity;
        private float _savedFixedStep;
        private bool _settingsApplied;

        public RaceDirector Director => _director;
        public TruckController PlayerTruck => _playerTruck;

        private void OnEnable()
        {
            _savedGravity = Physics.gravity;
            _savedFixedStep = Time.fixedDeltaTime;
            Physics.gravity = new Vector3(0f, RaceGravity, 0f);
            Time.fixedDeltaTime = FixedStep;
            _settingsApplied = true;
        }

        private void OnDisable()
        {
            if (!_settingsApplied) return;
            Physics.gravity = _savedGravity;
            Time.fixedDeltaTime = _savedFixedStep;
            _settingsApplied = false;
        }

        private void Start() => BeginRace();

        /// <summary>Build the course, spawn the field and start the countdown.</summary>
        public void BeginRace()
        {
            // The road is built, not serialised, so in a fresh play session it
            // does not exist yet even though the meshes in the scene do. Build
            // it rather than racing on nothing.
            if (track != null && track.Road == null) track.Rebuild();
            RoadPath road = track != null ? track.Road : null;

            if (road == null || road.Points.Count == 0)
            {
                Debug.LogError("[mtm] RaceRunner has no track to race on; assign one and rebuild it.", this);
                enabled = false;
                return;
            }

            _course = new RaceCourse(road);
            _director = new RaceDirector(_course, laps);
            ClearField();

            int count = Mathf.Min(opponents + 1, _course.Spawns.Count);
            for (int i = 0; i < count; i++)
            {
                bool isPlayer = i == 0;
                VehicleAsset asset = isPlayer ? playerVehicle : OpponentVehicle(i - 1);
                SpawnPoint slot = _course.Spawns[i];

                TruckController truck = SpawnTruck(asset, slot, isPlayer ? "Player" : $"AI {i}");
                VehicleSpec spec = truck.Spec;

                Racer racer = _director.Add(spec.Id, isPlayer ? "YOU" : spec.Name, isPlayer);
                racer.Position = slot.Position;
                racer.Forward = new Vec3(Mathf.Sin((float)slot.Heading), 0, Mathf.Cos((float)slot.Heading));

                _trucks.Add(truck);
                _entries.Add(racer);
                // One driver per opponent, and a null in the player's slot so
                // the three lists stay index-aligned with the field.
                _drivers.Add(isPlayer ? null : new AIDriver(spec, road, difficulty, seed * 977 + i));

                if (isPlayer)
                {
                    _playerTruck = truck;
                    _playerDriver = truck.GetComponent<PlayerDriver>();
                    if (_playerDriver != null)
                    {
                        _playerDriver.truck = truck;
                        _playerDriver.chaseCamera = chaseCamera;
                    }
                    if (chaseCamera != null)
                    {
                        chaseCamera.target = truck;
                        chaseCamera.Snap();
                    }
                }
            }
        }

        private VehicleAsset OpponentVehicle(int index)
        {
            if (opponentVehicles == null || opponentVehicles.Count == 0) return null;
            return opponentVehicles[index % opponentVehicles.Count];
        }

        private TruckController SpawnTruck(VehicleAsset asset, SpawnPoint slot, string label)
        {
            var position = new Vector3((float)slot.Position.X, (float)slot.Position.Y, (float)slot.Position.Z);
            var rotation = Quaternion.Euler(0f, (float)slot.Heading * Mathf.Rad2Deg, 0f);

            TruckController truck = truckPrefab != null
                ? Instantiate(truckPrefab, position, rotation, transform)
                : BuildBareTruck(position, rotation);

            truck.name = label;
            // After instantiation, not before: Awake has already run by now, so
            // the truck has to be told to adopt this spec.
            truck.Configure(asset);
            return truck;
        }

        /// <summary>
        /// A truck with no art on it, so a scene with no prefab still races.
        /// </summary>
        /// <remarks>
        /// Worth having: it means a fresh scene with a track in it can be
        /// driven immediately, which is how you find out whether the terrain
        /// and the physics agree before modelling anything.
        /// </remarks>
        private static TruckController BuildBareTruck(Vector3 position, Quaternion rotation)
        {
            var go = new GameObject("Truck");
            go.transform.SetPositionAndRotation(position, rotation);
            go.AddComponent<Rigidbody>();
            return go.AddComponent<TruckController>();
        }

        private void ClearField()
        {
            foreach (TruckController truck in _trucks)
            {
                if (truck != null) Destroy(truck.gameObject);
            }
            _trucks.Clear();
            _drivers.Clear();
            _entries.Clear();
            _playerTruck = null;
            _playerDriver = null;
        }

        private void FixedUpdate()
        {
            if (_director == null) return;
            float dt = Time.fixedDeltaTime;

            // Positions first: the director and every AI read this step's state,
            // so writing it after they run gives them a stale frame — which
            // shows up as opponents steering for where the corner used to be.
            for (int i = 0; i < _trucks.Count; i++)
            {
                TruckController truck = _trucks[i];
                if (truck == null) continue;
                Vector3 p = truck.transform.position;
                Vector3 f = truck.transform.forward;
                _entries[i].Position = new Vec3(p.x, p.y, p.z);
                _entries[i].Forward = new Vec3(f.x, f.y, f.z);
                _entries[i].ForwardSpeed = truck.ForwardSpeed;
            }

            _director.Update(dt);

            bool locked = _director.Locked;
            double leader = _director.LeaderProgress();

            for (int i = 0; i < _trucks.Count; i++)
            {
                TruckController truck = _trucks[i];
                if (truck == null) continue;

                AIDriver driver = _drivers[i];
                if (driver != null)
                {
                    var view = new DriverView
                    {
                        Position = _entries[i].Position,
                        Forward = _entries[i].Forward,
                        ForwardSpeed = truck.ForwardSpeed,
                        GroundedWheels = truck.GroundedWheels,
                    };
                    DriveInput input = driver.Step(dt, view, leader, _entries[i].Progress);
                    input.Parked = locked;
                    truck.SetInput(input);
                }
                else if (_playerDriver != null)
                {
                    // The player's own input comes from PlayerDriver in Update.
                    // Setting it here as well would race with that and drop
                    // half the keypresses, so the grid hold is passed across as
                    // a flag — it is the one thing the race needs to say about
                    // the player's controls.
                    _playerDriver.parked = locked;
                }
                else if (locked)
                {
                    // No player driver on the truck at all: hold it directly,
                    // or the countdown is a free head start.
                    truck.SetInput(new DriveInput { Parked = true });
                }

                RescueIfStuck(truck, _entries[i]);
            }
        }

        /// <summary>
        /// Put a truck that has stopped being able to race back on the course.
        /// </summary>
        /// <remarks>
        /// Applied to the whole field deliberately: an AI truck wedged against
        /// a rock is both a dead opponent and a permanent obstacle for
        /// everyone else.
        /// <para/>
        /// The truck goes back to the last gate it actually passed, not to the
        /// nearest point on the racing line — the nearest point would pay out
        /// whatever distance a shortcut across the infield had covered.
        /// </remarks>
        private void RescueIfStuck(TruckController truck, Racer racer)
        {
            DriveModel drive = truck.Drive;
            if (drive == null) return;
            // Inverted trucks are picked up sooner than merely stationary ones:
            // one is never getting going again, the other might.
            bool stuck = drive.NeedsRescue || drive.StuckFor > 5.0;
            if (!stuck) return;

            SpawnPoint slot = _course.RescueAt(racer.NextCheckpoint);
            truck.Respawn(new Vector3((float)slot.Position.X, (float)slot.Position.Y, (float)slot.Position.Z),
                          (float)slot.Heading);
            if (truck == _playerTruck && chaseCamera != null) chaseCamera.Snap();
        }
    }
}
