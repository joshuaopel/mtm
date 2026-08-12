/** Minimal DOM helpers, so screen code reads as structure rather than plumbing. */

type Attributes = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

/** A 0-10 stat readout with a segmented bar. */
export function statRow(label: string, value: number, max = 10): Node[] {
  const meter = el('div', { class: 'meter bevel-in' });
  for (let i = 0; i < max; i++) {
    const filled = i < value;
    meter.append(el('i', { class: filled ? (i >= 7 ? 'on hi' : 'on') : '' }));
  }
  return [
    el('span', { class: 'label', text: label }),
    meter,
    el('span', { class: 'val', text: String(value) }),
  ];
}
