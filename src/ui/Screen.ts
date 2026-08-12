import type { Input } from '../core/Input';
import { el } from './dom';

/** A screen owns a DOM subtree and consumes input while it is on top. */
export interface Screen {
  readonly root: HTMLElement;
  handleInput?(input: Input): void;
  update?(dt: number): void;
  onMount?(): void;
  onUnmount?(): void;
}

export interface MenuEntry {
  label: string;
  /** Right-aligned secondary text. */
  tag?: string;
  disabled?: boolean;
  onSelect?(): void;
}

/**
 * Keyboard/gamepad-driven vertical menu with mouse support.
 *
 * Selection is owned here rather than by each screen so that every menu in
 * the game moves, wraps and highlights identically.
 */
export class Menu {
  readonly root: HTMLElement;
  private entries: MenuEntry[] = [];
  private index = 0;
  private onChange?: (index: number) => void;

  constructor(options: { className?: string; onChange?: (index: number) => void } = {}) {
    this.root = el('div', { class: `menu bevel ${options.className ?? ''}`.trim() });
    this.onChange = options.onChange;
  }

  setEntries(entries: MenuEntry[], keepIndex = true): void {
    this.entries = entries;
    if (!keepIndex) this.index = 0;
    this.index = Math.max(0, Math.min(this.index, entries.length - 1));
    this.render();
  }

  get selectedIndex(): number {
    return this.index;
  }

  select(index: number): void {
    if (this.entries.length === 0) return;
    // Wrap around; a menu that stops at the ends feels broken with a pad.
    const count = this.entries.length;
    this.index = ((index % count) + count) % count;
    this.render();
    this.onChange?.(this.index);
  }

  private render(): void {
    this.root.replaceChildren();
    this.entries.forEach((entry, i) => {
      const classes = ['menu-item'];
      if (i === this.index) classes.push('sel');
      if (entry.disabled) classes.push('disabled');

      const item = el('div', { class: classes.join(' ') }, [
        el('span', { text: entry.label }),
        ...(entry.tag ? [el('span', { class: 'tag', text: entry.tag })] : []),
      ]);

      item.addEventListener('mouseenter', () => {
        if (!entry.disabled) this.select(i);
      });
      item.addEventListener('click', () => {
        if (entry.disabled) return;
        this.select(i);
        entry.onSelect?.();
      });

      this.root.append(item);
    });
  }

  handleInput(input: Input): void {
    // Counted, not flagged: two taps inside one frame must move two entries.
    const delta = input.pressedCount('down') - input.pressedCount('up');
    if (delta !== 0) this.select(this.index + delta);
    if (input.pressed('confirm')) {
      const entry = this.entries[this.index];
      if (entry && !entry.disabled) entry.onSelect?.();
    }
  }
}
