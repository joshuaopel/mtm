import { el } from './dom';
import { formatTime, ordinal, type Race } from '../game/Race';
import type { RaceSession } from '../game/RaceSession';

/**
 * In-race overlay: speed, position, lap, timing and standings.
 *
 * Text nodes are cached and written in place. Rebuilding this markup every
 * frame is a guaranteed way to make a 60fps game stutter.
 */
export class Hud {
  readonly root: HTMLElement;

  private speedValue: HTMLElement;
  private positionValue: HTMLElement;
  private lapValue: HTMLElement;
  private timeValue: HTMLElement;
  private bestValue: HTMLElement;
  private lastValue: HTMLElement;
  private standingsBox: HTMLElement;
  private centreMessage: HTMLElement;
  private wrongWay: HTMLElement;
  private offCourse: HTMLElement;
  private offCourseCount: HTMLElement;
  private gearHint: HTMLElement;

  private standingsSignature = '';

  constructor() {
    this.speedValue = el('div', { class: 'big', text: '0' });
    this.positionValue = el('div', { class: 'big', text: '1' });
    this.lapValue = el('div', { class: 'big', text: '1/3' });
    this.timeValue = el('div', { class: 'big', text: '00:00.00' });
    this.bestValue = el('span', { text: '--:--.--' });
    this.lastValue = el('span', { text: '--:--.--' });
    this.standingsBox = el('div', { class: 'standings' });
    this.centreMessage = el('div', { class: 'center-msg' });
    this.wrongWay = el('div', { class: 'wrongway', text: 'WRONG WAY' });
    this.offCourseCount = el('span', { class: 'count', text: '5' });
    this.offCourse = el('div', { class: 'offcourse' }, [
      el('div', { text: 'OFF COURSE' }),
      el('div', { class: 'sub' }, ['RETURN TO THE TRACK', this.offCourseCount]),
    ]);
    this.gearHint = el('div', { class: 'unit', text: 'MPH' });

    this.wrongWay.style.display = 'none';
    this.centreMessage.style.display = 'none';
    this.offCourse.style.display = 'none';

    this.root = el('div', { class: 'hud' }, [
      el('div', { class: 'box tl' }, [
        el('div', { class: 'lbl', text: 'POS' }),
        this.positionValue,
        el('div', { class: 'lbl', text: 'LAP' }),
        this.lapValue,
      ]),
      el('div', { class: 'box tr' }, [
        el('div', { class: 'lbl', text: 'TIME' }),
        this.timeValue,
        el('div', { class: 'lbl' }, ['BEST ', this.bestValue]),
        el('div', { class: 'lbl' }, ['LAST ', this.lastValue]),
      ]),
      el('div', { class: 'box bl' }, [
        el('div', { class: 'lbl', text: 'FIELD' }),
        this.standingsBox,
      ]),
      el('div', { class: 'box br speedo' }, [this.speedValue, this.gearHint]),
      this.centreMessage,
      this.wrongWay,
      this.offCourse,
    ]);
  }

  update(session: RaceSession): void {
    const race = session.race;
    const player = race.player;
    if (!player) return;

    // m/s to mph — the original was an American game and read in mph.
    const mph = Math.round(Math.abs(player.vehicle.forwardSpeed) * 2.23694);
    this.setText(this.speedValue, String(mph));

    this.setText(this.positionValue, ordinal(player.position));
    this.setText(
      this.lapValue,
      `${Math.min(player.lap + 1, race.totalLaps)}/${race.totalLaps}`,
    );
    this.setText(this.timeValue, formatTime(race.phase === 'countdown' ? 0 : race.clock));
    this.setText(this.bestValue, formatTime(player.bestLap));
    this.setText(
      this.lastValue,
      formatTime(player.lapTimes.length ? player.lapTimes[player.lapTimes.length - 1] : null),
    );

    this.updateStandings(race);
    this.updateCentreMessage(session);

    this.updateOffCourse(session);

    // Off course already owns the centre of the screen, and two warnings
    // stacked on top of each other reads as neither.
    const showWrongWay =
      player.wrongWay && race.phase === 'racing' && player.offTrackFor <= 0;
    this.wrongWay.style.display = showWrongWay ? '' : 'none';
  }

  /**
   * The return-to-track countdown.
   *
   * Only shown once the timer is meaningfully running: the recovery ramp
   * leaves a fraction of a second on the clock after a brief excursion, and
   * flashing a warning for that is worse than not warning at all.
   */
  private updateOffCourse(session: RaceSession): void {
    const player = session.race.player;
    const elapsed = player?.offTrackFor ?? 0;
    const showing = session.race.phase === 'racing' && elapsed > 0.35;

    if (!showing) {
      if (this.offCourse.style.display !== 'none') this.offCourse.style.display = 'none';
      return;
    }

    const remaining = Math.max(0, session.boundsSeconds - elapsed);
    this.offCourse.style.display = '';
    // Ceiling, so the last whole second is shown as "1" rather than "0".
    this.setText(this.offCourseCount, String(Math.ceil(remaining)));
    this.offCourse.classList.toggle('urgent', remaining <= 2);
  }

  private updateStandings(race: Race): void {
    const standings = race.standings();
    // Only touch the DOM when the running order actually changes.
    const signature = standings.map((r) => `${r.position}${r.id}`).join('|');
    if (signature === this.standingsSignature) return;
    this.standingsSignature = signature;

    this.standingsBox.replaceChildren();
    for (const racer of standings) {
      const rowClass = racer.isPlayer ? 'me' : '';
      this.standingsBox.append(
        el('span', { class: rowClass, text: `${racer.position}.` }),
        el('span', { class: rowClass, text: racer.name }),
        el('span', {
          class: rowClass,
          text: racer.finished ? 'FIN' : `L${racer.lap + 1}`,
        }),
      );
    }
  }

  private updateCentreMessage(session: RaceSession): void {
    const race = session.race;
    const countdown = race.countdownLabel();

    let text: string | null = null;
    let classes = 'center-msg';

    if (countdown) {
      text = countdown;
      if (countdown === 'GO!') classes += ' go';
    } else if (session.lastEvent) {
      text = session.lastEvent;
      classes += ' small';
    }

    if (text === null) {
      this.centreMessage.style.display = 'none';
      return;
    }
    this.centreMessage.style.display = '';
    this.centreMessage.className = classes;
    this.setText(this.centreMessage, text);
  }

  private setText(node: HTMLElement, value: string): void {
    if (node.textContent !== value) node.textContent = value;
  }
}
