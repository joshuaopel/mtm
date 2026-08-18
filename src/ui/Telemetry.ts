import { el } from './dom';
import { dampingVerdict, handlingNumbers, wheelieVerdict } from '../game/handling';
import type { RaceSession } from '../game/RaceSession';

/**
 * Tuning readout for the player's truck.
 *
 * The vehicle format stores the raw physics inputs the simulation consumes,
 * none of which tell you how the truck will feel. This turns them into the
 * numbers that do — ride frequency, damping ratio, how close the truck runs
 * to lifting its nose — and shows live suspension travel beside them, so a
 * change to a spring rate can be judged without guessing.
 */
export class Telemetry {
  readonly root: HTMLElement;

  private derived: HTMLElement;
  private live: HTMLElement;
  private travelBars: HTMLElement[] = [];
  private travelValues: HTMLElement[] = [];
  private lastVehicleId = '';

  constructor() {
    this.derived = el('div', { class: 'telemetry-grid' });
    this.live = el('div', { class: 'telemetry-grid' });

    const wheels = el('div', { class: 'telemetry-wheels' });
    for (const label of ['FL', 'FR', 'RL', 'RR']) {
      const fill = el('i');
      const value = el('span', { class: 'v', text: '—' });
      this.travelBars.push(fill);
      this.travelValues.push(value);
      wheels.append(
        el('span', { class: 'k', text: label }),
        el('div', { class: 'travel bevel-in' }, [fill]),
        value,
      );
    }

    this.root = el('div', { class: 'telemetry bevel' }, [
      el('div', { class: 'telemetry-title', text: 'TUNING' }),
      this.derived,
      el('div', { class: 'telemetry-title', text: 'SUSPENSION TRAVEL' }),
      wheels,
      el('div', { class: 'telemetry-title', text: 'LIVE' }),
      this.live,
      el('div', { class: 'telemetry-hint', text: 'F1 HIDES THIS' }),
    ]);
  }

  update(session: RaceSession): void {
    const vehicle = session.playerVehicle;
    const physics = vehicle.definition.physics;

    // The derived block only changes when the truck does, so rebuild it then
    // rather than every frame.
    if (vehicle.definition.id !== this.lastVehicleId) {
      this.lastVehicleId = vehicle.definition.id;
      this.rebuildDerived(session);
    }

    const travel = physics.maxSuspensionTravel;
    const minLength = physics.suspensionRest - travel;
    for (let i = 0; i < 4; i++) {
      const wheel = vehicle.raycast.wheelInfos[i];
      if (!wheel) continue;
      // 0 = fully extended (droop), 1 = fully compressed (bump stop).
      const fraction = clamp01((physics.suspensionRest - wheel.suspensionLength) / travel);
      this.travelBars[i].style.width = `${(fraction * 100).toFixed(0)}%`;
      this.travelBars[i].className = fraction > 0.92 ? 'bottomed' : '';
      setText(
        this.travelValues[i],
        wheel.suspensionLength <= minLength + 0.01
          ? 'BOTTOM'
          : `${wheel.suspensionLength.toFixed(2)}m`,
      );
    }

    this.rebuildLive(session);
  }

  private rebuildDerived(session: RaceSession): void {
    const definition = session.playerVehicle.definition;
    const h = handlingNumbers(definition.physics);

    this.derived.replaceChildren(
      ...row('TRUCK', definition.name),
      ...row('MASS', `${definition.physics.mass} kg`),
      ...row('RIDE FREQ', `${h.rideFrequency.toFixed(2)} Hz`),
      ...row(
        'REBOUND',
        `${h.reboundDamping.toFixed(2)} (${dampingVerdict(h.reboundDamping)})`,
      ),
      ...row(
        'COMPRESS',
        `${h.compressionDamping.toFixed(2)} (${dampingVerdict(h.compressionDamping)})`,
      ),
      ...row('RIDE HEIGHT', `${h.rideHeight.toFixed(2)} m`),
      ...row('SQUAT', `${h.restCompression.toFixed(2)} m`),
      ...row('BUMP LEFT', `${h.bumpHeadroom.toFixed(2)} m`),
      ...row('LAUNCH', `${h.launchAcceleration.toFixed(1)} m/s²`),
      ...row(
        'WHEELIE',
        `${(h.wheelieMargin * 100).toFixed(0)}% (${wheelieVerdict(h.wheelieMargin)})`,
      ),
    );
  }

  private rebuildLive(session: RaceSession): void {
    const vehicle = session.playerVehicle;
    const speed = vehicle.forwardSpeed;

    this.live.replaceChildren(
      ...row('SPEED', `${(speed * 2.23694).toFixed(0)} mph / ${speed.toFixed(1)} m/s`),
      ...row('WHEELS DOWN', `${vehicle.groundedWheels} / 4`),
      ...row('UPRIGHT', vehicle.uprightness.toFixed(2)),
      ...row('STUCK FOR', `${vehicle.stuckFor.toFixed(1)} s`),
      ...row(
        'HEIGHT',
        `${(vehicle.position.y - session.track.terrain.heightAt(vehicle.position.x, vehicle.position.z)).toFixed(2)} m`,
      ),
    );
  }
}

function row(key: string, value: string): Node[] {
  return [el('span', { class: 'k', text: key }), el('span', { class: 'v', text: value })];
}

function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
