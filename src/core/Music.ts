/**
 * Background music.
 *
 * Streamed through an `HTMLAudioElement` rather than decoded into the Web
 * Audio graph the engine noise uses. A song is minutes long and megabytes
 * big; decoding it would hold the whole thing in memory as raw samples and
 * stall the first race while it finished. An audio element starts playing
 * from the first buffered chunk and costs nothing to keep around.
 *
 * Browsers refuse to start audio before a user gesture, so like `EngineAudio`
 * everything here tolerates being called too early — `unlock()` is what
 * actually gets sound out, and it is safe to call more than once.
 */

/** Seconds to fade between tracks, and in and out of silence. */
const FADE = 0.9;

export class MusicPlayer {
  private element: HTMLAudioElement | null = null;
  private playlist: string[] = [];
  /** What we intend to be playing — not necessarily what has loaded yet. */
  private current: string | null = null;
  private enabled = true;
  private volume = 0.55;
  private unlocked = false;
  private fadeTimer: number | null = null;

  /** Every audio file found in the content folder, in discovery order. */
  setPlaylist(urls: readonly string[]): void {
    this.playlist = [...urls];
  }

  get hasMusic(): boolean {
    return this.playlist.length > 0;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Call from a user gesture. Starts whatever was already requested. */
  unlock(): void {
    this.unlocked = true;
    if (this.enabled && this.current) this.start(this.current);
  }

  /**
   * Ask for a specific track, or for "anything" when passed nothing.
   *
   * Requesting what is already playing is a no-op, which is what keeps a song
   * running across the title screen, the menus and into the race instead of
   * restarting at every screen change.
   */
  request(url?: string | null): void {
    const wanted = url ?? this.current ?? this.playlist[0] ?? null;
    if (!wanted || wanted === this.current) {
      this.current = wanted;
      return;
    }
    this.current = wanted;
    if (this.enabled && this.unlocked) this.start(wanted);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.fadeTo(0, () => this.element?.pause());
      return;
    }
    if (!this.unlocked) return;
    if (this.element && this.current) {
      void this.element.play().catch(() => undefined);
      this.fadeTo(this.volume);
    } else if (this.current) {
      this.start(this.current);
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.element && this.enabled) this.element.volume = this.volume;
  }

  getVolume(): number {
    return this.volume;
  }

  private start(url: string): void {
    // Swapping the src mid-fade would cut the outgoing track dead, so the new
    // one only begins once the old has faded out.
    const begin = (): void => {
      const element = this.ensureElement();
      element.src = url;
      element.volume = 0;
      void element.play().then(
        () => this.fadeTo(this.volume),
        // Autoplay refused, or the file is missing or not a format this
        // browser decodes. Either way the game carries on in silence.
        () => undefined,
      );
    };

    if (this.element && !this.element.paused) this.fadeTo(0, begin);
    else begin();
  }

  private ensureElement(): HTMLAudioElement {
    if (this.element) return this.element;
    const element = new Audio();
    element.preload = 'auto';
    element.loop = false;
    element.volume = 0;
    // Advance through the playlist so a single short song does not loop
    // audibly, but a lone track still repeats rather than falling silent.
    element.addEventListener('ended', () => this.next());
    this.element = element;
    return element;
  }

  private next(): void {
    if (this.playlist.length === 0) return;
    if (this.playlist.length === 1) {
      this.start(this.playlist[0]);
      return;
    }
    const index = this.current ? this.playlist.indexOf(this.current) : -1;
    this.current = this.playlist[(index + 1) % this.playlist.length];
    this.start(this.current);
  }

  /**
   * Linear ramp on the element's own volume; no audio graph involved.
   *
   * Interpolated against the clock rather than by counting ticks. A busy
   * frame or a background tab throttles the interval, and a per-tick delta
   * then stretches the fade out indefinitely — which meant switching music
   * off left the song quietly playing on at low volume instead of stopping.
   */
  private fadeTo(target: number, done?: () => void): void {
    const element = this.element;
    if (!element) {
      done?.();
      return;
    }
    if (this.fadeTimer !== null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }

    const from = element.volume;
    const started = performance.now();

    const finish = (): void => {
      if (this.fadeTimer !== null) clearInterval(this.fadeTimer);
      this.fadeTimer = null;
      element.volume = Math.max(0, Math.min(1, target));
      done?.();
    };

    if (Math.abs(target - from) < 1e-3) {
      finish();
      return;
    }

    this.fadeTimer = window.setInterval(() => {
      const t = (performance.now() - started) / (FADE * 1000);
      if (t >= 1) {
        finish();
        return;
      }
      element.volume = Math.max(0, Math.min(1, from + (target - from) * t));
    }, 1000 / 30);
  }

  dispose(): void {
    if (this.fadeTimer !== null) clearInterval(this.fadeTimer);
    this.element?.pause();
    this.element = null;
  }
}
