import { el } from './dom';

/**
 * The last-resort screen.
 *
 * Everything else in the UI is a menu you can back out of; this is what gets
 * drawn when the game cannot draw itself. It lives outside the screen stack
 * and paints straight into `#ui`, because the failures it reports — no WebGL,
 * a lost graphics context, an exception that broke the frame loop — are
 * exactly the ones where the rest of the shell cannot be trusted to run.
 *
 * A blank black window is the worst possible outcome here: the player has no
 * way to tell a crash from a slow load, and nobody thinks to open a developer
 * console. Say what happened and what to do about it.
 */
export function showErrorPanel(
  host: HTMLElement,
  options: { title: string; message: string; detail?: unknown; action?: { label: string; onSelect(): void } },
): void {
  const detail = formatDetail(options.detail);

  const children: Node[] = [
    el('div', { class: 'fatal-title', text: options.title }),
    el('div', { class: 'fatal-message', text: options.message }),
  ];
  if (detail) children.push(el('pre', { class: 'fatal-detail bevel-in', text: detail }));

  if (options.action) {
    const button = el('div', { class: 'menu-item sel' }, [el('span', { text: options.action.label })]);
    button.addEventListener('click', () => options.action?.onSelect());
    children.push(el('div', { class: 'menu bevel' }, [button]));
  }

  host.replaceChildren(el('div', { class: 'fatal' }, children));
}

/**
 * Errors reach here as whatever was thrown, which is not always an `Error`.
 * Show the message and the first few stack frames — enough to report a bug,
 * short enough to stay readable on a Deck's screen.
 */
function formatDetail(detail: unknown): string {
  if (detail === undefined || detail === null) return '';
  if (detail instanceof Error) {
    const stack = (detail.stack ?? '').split('\n').slice(0, 6).join('\n');
    return stack || `${detail.name}: ${detail.message}`;
  }
  return String(detail);
}
