/**
 * Promo shot generator.
 *
 * Builds a hero lineup of every stock truck on a real course and renders it
 * through the game's own retro pipeline, so the artwork is the game rather
 * than a picture of it. Run the dev server, open
 * `/tools/promo/index.html`, and screenshot the page.
 *
 * Everything below the poster chrome comes from `src/` — the terrain, the
 * road, the scatter and the trucks are all built by the shipping code, which
 * means the promo shot cannot drift away from what the game looks like.
 *
 * The framing is tunable from the query string so it can be dialled in
 * without an edit-reload cycle, e.g.
 * `?bearing=336&dist=17&height=2.6&fov=46`.
 */
import * as THREE from 'three';
import { RetroRenderer } from '../../src/core/RetroRenderer';
import { Track } from '../../src/game/Track';
import { buildTruckMesh } from '../../src/game/TruckMesh';
import { TRACKS } from '../../src/data/tracks';
import { VEHICLES } from '../../src/data/vehicles';
import type { MTMTrack, MTMVehicle } from '../../src/game/formats';

const query = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number => {
  const raw = query.get(key);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

/**
 * Where on the loop the shot is staged, in degrees of bearing.
 *
 * Just past the start line, which puts the camera a few metres behind it and
 * runs the chequers across the near ground. Without that the bottom third of
 * the poster is bare dirt.
 */
const BEARING = num('bearing', 2);
/** Camera distance ahead of the lead pair, its height, and lens. */
const DISTANCE = num('dist', 15);
/** Low, so the trucks are looked up at rather than down on. */
const HEIGHT = num('height', 1.2);
const FOV = num('fov', 56);
/** Height of the aim point above the road, which sets the camera's pitch. */
const AIM = num('aim', 3);

/** Low sun, deep sky, thin haze — late afternoon rather than the midday race. */
function heroTrack(base: MTMTrack): MTMTrack {
  return {
    ...base,
    environment: {
      ...base.environment,
      skyZenith: '#1c3866',
      skyHorizon: '#e8a054',
      fogColor: '#b87a44',
      fogDensity: 0.0038,
      // Raking across the formation from the left, so the bodies get a lit
      // side and a shadowed side instead of reading flat.
      sunDirection: [-0.8, 0.24, 0.22],
      sunColor: '#ffd49a',
      ambientColor: '#4e4048',
    },
  };
}

/**
 * Where each truck sits, in metres, relative to the anchor: +along runs away
 * from the camera down the road, +across is to the anchor's right.
 *
 * A shallow arc rather than a deep arrowhead. Depth is what hides a truck: a
 * pair set well back but only a little wider ends up at the same angle from
 * the lens as the pair in front of it and disappears behind them. Keeping the
 * ranks close in depth and spreading them hard sideways gives every truck its
 * own slice of the frame. The outer pairs are turned in towards the camera so
 * the wide lens shows their flanks rather than a flat row of grilles.
 */
const FORMATION: Array<[along: number, across: number, yaw: number]> = [
  [0, -2.7, 0.12],
  [1.8, 2.9, -0.12],
  [5, -10.3, 0.3],
  [6.5, 11, -0.3],
  [11, -17.9, 0.5],
  [12.5, 18.6, -0.5],
];

/** Sit a truck on its own springs, the way the showroom does. */
function rideHeight(vehicle: MTMVehicle): number {
  const p = vehicle.physics;
  const restCompression = Math.min(p.maxSuspensionTravel, 19.6 / (4 * p.suspensionStiffness));
  return p.wheelRadius + (p.suspensionRest - restCompression) - p.axleHeight;
}

function placeTruck(
  track: Track,
  vehicle: MTMVehicle,
  origin: THREE.Vector3,
  forward: THREE.Vector3,
  right: THREE.Vector3,
  slot: [number, number, number],
): THREE.Vector3 {
  const [along, across, yaw] = slot;
  const spot = origin.clone().addScaledVector(forward, along).addScaledVector(right, across);
  spot.y = track.terrain.heightAt(spot.x, spot.z);

  const group = new THREE.Group();
  group.position.copy(spot);
  // Facing back down the road, i.e. straight at the camera.
  group.rotation.y = Math.atan2(-forward.x, -forward.z) + yaw;

  const built = buildTruckMesh(vehicle);
  built.body.position.y = rideHeight(vehicle);
  group.add(built.body);

  for (let i = 0; i < built.wheels.length; i++) {
    const wheel = built.wheels[i];
    const [halfTrack, z] = i < 2 ? vehicle.physics.frontAxle : vehicle.physics.rearAxle;
    wheel.position.set(i % 2 === 0 ? -halfTrack : halfTrack, vehicle.physics.wheelRadius, z);
    group.add(wheel);
  }

  track.scene.add(group);
  return spot;
}

function main(): void {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new RetroRenderer(canvas);
  // The poster wants detail the 320x240 race view deliberately throws away,
  // while keeping the dither and the hard pixel edges that make the look.
  renderer.setDetail('hi');
  renderer.setMirrorEnabled(false);

  const base = TRACKS.find((t) => t.id === 'mesa-speedway') ?? TRACKS[0];
  const track = new Track(heroTrack(base));

  const angle = BEARING * (Math.PI / 180);
  const anchor = track.road.closestTo(Math.sin(angle) * 254, Math.cos(angle) * 254);
  const forward = anchor.tangent.clone().setY(0).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const origin = anchor.point.clone();

  const spots: THREE.Vector3[] = [];
  for (let i = 0; i < FORMATION.length; i++) {
    spots.push(placeTruck(track, VEHICLES[i % VEHICLES.length], origin, forward, right, FORMATION[i]));
  }

  // Hero angle: low and close, ahead of the lead truck, looking back up the
  // road so the formation stacks into the frame under the start gantry.
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 10, 0.4, 2400);
  const eye = origin.clone().addScaledVector(forward, -DISTANCE);
  eye.y = track.terrain.heightAt(eye.x, eye.z) + HEIGHT;
  camera.position.copy(eye);
  camera.lookAt(origin.clone().addScaledVector(forward, 20).setY(origin.y + AIM));
  camera.updateMatrixWorld();

  buildRoster(spots, camera);

  // Framing aid: where each truck actually lands, in normalised screen
  // coordinates, so the layout can be checked rather than eyeballed.
  (window as unknown as { __promo?: unknown }).__promo = spots.map((spot, i) => {
    const ndc = spot.clone().project(camera);
    return {
      name: VEHICLES[i % VEHICLES.length].name,
      x: +((ndc.x * 0.5 + 0.5) * 100).toFixed(1),
      y: +((0.5 - ndc.y * 0.5) * 100).toFixed(1),
      metres: +camera.position.distanceTo(spot).toFixed(1),
    };
  });

  function frame(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.resize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(track.scene, camera);
    // A screenshot tool needs a signal that the first real frame is up.
    document.body.dataset.ready = 'yes';
    requestAnimationFrame(frame);
  }
  frame();
}

/**
 * Name strip along the bottom, ordered left to right as the trucks actually
 * appear. Projecting each one into screen space rather than assuming an order
 * means the strip stays correct whenever the formation is retuned.
 */
function buildRoster(spots: THREE.Vector3[], camera: THREE.Camera): void {
  const roster = document.getElementById('roster');
  if (!roster) return;

  const order = spots
    .map((spot, index) => ({ index, x: spot.clone().project(camera).x }))
    .sort((a, b) => a.x - b.x);

  for (const { index } of order) {
    const vehicle = VEHICLES[index % VEHICLES.length];
    const cell = document.createElement('div');
    cell.className = 'cell';
    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = vehicle.name;
    const klass = document.createElement('span');
    klass.className = 'cl';
    klass.textContent = vehicle.class;
    cell.append(name, klass);
    roster.appendChild(cell);
  }
}

main();
