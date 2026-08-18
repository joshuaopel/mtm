/**
 * Keyboard + gamepad input with edge detection.
 *
 * Everything the game reads goes through named actions so the driving code
 * never touches key codes, and so a gamepad can feed the same actions with
 * analogue precision where it has it.
 */

export type Action =
  | 'throttle'
  | 'brake'
  | 'left'
  | 'right'
  | 'handbrake'
  | 'reset'
  | 'camera'
  | 'lookBack'
  | 'mirror'
  | 'pause'
  | 'confirm'
  | 'back'
  | 'up'
  | 'down';

const KEY_MAP: Record<string, Action[]> = {
  ArrowUp: ['throttle', 'up'],
  KeyW: ['throttle', 'up'],
  ArrowDown: ['brake', 'down'],
  KeyS: ['brake', 'down'],
  ArrowLeft: ['left'],
  KeyA: ['left'],
  ArrowRight: ['right'],
  KeyD: ['right'],
  Space: ['handbrake'],
  KeyR: ['reset'],
  KeyC: ['camera'],
  KeyB: ['lookBack'],
  KeyM: ['mirror'],
  Escape: ['pause', 'back'],
  Enter: ['confirm'],
  NumpadEnter: ['confirm'],
  Backspace: ['back'],
};

/** Standard-mapping gamepad buttons that feed each action. */
const PAD_BUTTON_MAP: Record<number, Action[]> = {
  0: ['confirm'], // A
  1: ['back'], // B
  2: ['handbrake'], // X
  3: ['reset'], // Y
  4: ['lookBack'], // LB
  5: ['camera'], // RB
  8: ['mirror'], // Back/Select
  6: ['brake'], // LT (digital fallback)
  7: ['throttle'], // RT (digital fallback)
  9: ['pause'], // Start
  12: ['up'],
  13: ['down'],
  14: ['left'],
  15: ['right'],
};

const DEADZONE = 0.18;

export class Input {
  private held = new Set<Action>();
  /**
   * Presses seen this frame, counted rather than flagged.
   *
   * A set would collapse two taps of the same key inside one frame into one
   * event and silently lose the second — which shows up as a menu that skips
   * entries when you move quickly through it.
   */
  private pressedThisFrame = new Map<Action, number>();
  private releasedThisFrame = new Set<Action>();
  private queued: Action[] = [];

  /** Analogue values sourced from a gamepad, if one is connected. */
  private padSteer = 0;
  private padThrottle = 0;
  private padBrake = 0;
  private padPrevButtons = new Set<Action>();

  private onKeyDown = (e: KeyboardEvent): void => {
    const actions = KEY_MAP[e.code];
    if (!actions) return;
    // Keep the browser from scrolling the page out from under the canvas.
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    for (const a of actions) {
      this.held.add(a);
      this.queued.push(a);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const actions = KEY_MAP[e.code];
    if (!actions) return;
    for (const a of actions) {
      this.held.delete(a);
      this.releasedThisFrame.add(a);
    }
  };

  private onBlur = (): void => {
    // Dropping focus mid-corner should not leave the throttle pinned.
    this.held.clear();
  };

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Call once per frame, before anything reads input. */
  update(): void {
    this.pressedThisFrame = new Map();
    for (const action of this.queued) {
      this.pressedThisFrame.set(action, (this.pressedThisFrame.get(action) ?? 0) + 1);
    }
    this.queued = [];
    this.releasedThisFrame.clear();
    this.pollGamepad();
  }

  private pollGamepad(): void {
    this.padSteer = 0;
    this.padThrottle = 0;
    this.padBrake = 0;

    const pads = navigator.getGamepads?.() ?? [];
    const pad = Array.from(pads).find((p): p is Gamepad => !!p && p.connected);
    if (!pad) {
      this.padPrevButtons.clear();
      return;
    }

    const stick = pad.axes[0] ?? 0;
    if (Math.abs(stick) > DEADZONE) {
      // Rescale past the deadzone so the usable range is still the full 0..1.
      this.padSteer = (stick - Math.sign(stick) * DEADZONE) / (1 - DEADZONE);
    }

    // Triggers report as buttons with an analogue `value` in standard mapping.
    this.padThrottle = pad.buttons[7]?.value ?? 0;
    this.padBrake = pad.buttons[6]?.value ?? 0;

    const nowDown = new Set<Action>();
    for (const [index, actions] of Object.entries(PAD_BUTTON_MAP)) {
      if (!pad.buttons[Number(index)]?.pressed) continue;
      for (const a of actions) nowDown.add(a);
    }
    for (const a of nowDown) {
      if (!this.padPrevButtons.has(a)) {
        this.pressedThisFrame.set(a, (this.pressedThisFrame.get(a) ?? 0) + 1);
      }
    }
    this.padPrevButtons = nowDown;
  }

  /** True while the action is held. */
  down(action: Action): boolean {
    if (this.held.has(action)) return true;
    if (action === 'throttle') return this.padThrottle > 0.1;
    if (action === 'brake') return this.padBrake > 0.1;
    if (action === 'left') return this.padSteer < -0.1;
    if (action === 'right') return this.padSteer > 0.1;
    return this.padPrevButtons.has(action);
  }

  /** True only on the frame the action went down. */
  pressed(action: Action): boolean {
    return this.pressedThisFrame.has(action);
  }

  /**
   * How many times the action was pressed this frame. Menus use this so a
   * fast double-tap moves two entries instead of one.
   */
  pressedCount(action: Action): number {
    return this.pressedThisFrame.get(action) ?? 0;
  }

  /** Steering axis, -1 (left) to 1 (right). */
  steerAxis(): number {
    if (Math.abs(this.padSteer) > 0.05) return this.padSteer;
    return (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
  }

  /** Throttle, 0 to 1. */
  throttleAxis(): number {
    return Math.max(this.padThrottle, this.held.has('throttle') ? 1 : 0);
  }

  /** Brake / reverse, 0 to 1. */
  brakeAxis(): number {
    return Math.max(this.padBrake, this.held.has('brake') ? 1 : 0);
  }

  /** Drop queued edges, e.g. when switching screens. */
  flush(): void {
    this.pressedThisFrame.clear();
    this.queued = [];
  }
}
