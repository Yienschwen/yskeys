// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { KEY_LAYOUT, fingerHintFor } from '../core/layout';
import { createFingerDiagram, describeKey } from '../ui/finger-diagram';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount() {
  const diagram = createFingerDiagram();
  document.body.append(diagram.element);
  return diagram;
}

function nextKey(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('.finger__key.is-next');
}

describe('finger diagram', () => {
  it('draws a key cap for every printable character and the three extras', () => {
    const { element } = mount();
    const drawn = [...element.querySelectorAll<HTMLElement>('.finger__key')];

    // 94 printable characters collapse onto 47 physical caps (a shifted character lights
    // up the same cap as its plain partner), and the space bar and Enter are drawn but
    // are not part of those rows.
    const printableCaps = new Set(
      [...KEY_LAYOUT.values()]
        .filter((info) => info.kind !== 'space' && info.kind !== 'control')
        .map((info) => `${String(info.row)}:${String(info.col)}`),
    );
    expect(printableCaps.size).toBe(47);
    expect(drawn.length).toBe(printableCaps.size + 2);
    for (const char of [' ', '\n']) {
      expect(drawn.some((key) => key.dataset['char'] === char), char).toBe(true);
    }
  });

  it('draws a shifted character on the same cap as its plain partner', () => {
    const { element, render } = mount();

    render('{');
    const forBrace = nextKey(element);
    render('[');
    expect(nextKey(element)).toBe(forBrace);
  });

  it('starts hidden, since there is nothing to hint at before a drill', () => {
    const { element } = mount();
    expect(element.hidden).toBe(true);
    expect(nextKey(element)).toBeNull();
  });

  it('names the finger and marks the key for the next character', () => {
    const { element, render } = mount();
    render('k');

    expect(element.hidden).toBe(false);
    expect(element.querySelector('.finger__label')?.textContent).toContain('Next: k');
    expect(element.querySelector('.finger__label')?.textContent).toContain('right middle finger');
    expect(nextKey(element)?.dataset['char']).toBe('k');
    expect(nextKey(element)?.dataset['finger']).toBe('r-middle');
    expect(element.dataset['finger']).toBe('r-middle');
  });

  it('moves the mark when the next character changes, marking only one key', () => {
    const { element, render } = mount();
    render('a');
    render('p');

    const marked = element.querySelectorAll('.finger__key.is-next');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.getAttribute('data-char')).toBe('p');
    expect(element.querySelector('.finger__key[data-char="a"]')?.className).not.toContain('is-next');
  });

  it('tells the user to hold Shift for a shifted character', () => {
    const { element, render } = mount();
    render('{');

    const detail = element.querySelector('.finger__detail')?.textContent ?? '';
    expect(element.querySelector('.finger__label')?.textContent).toContain('right little finger');
    expect(detail).toMatch(/Hold Shift/);
    expect(detail).toMatch(/left little finger/);
  });

  it('names the space bar and the newline target in words', () => {
    const { element, render } = mount();

    render(' ');
    expect(element.querySelector('.finger__label')?.textContent).toContain('space');
    expect(nextKey(element)?.dataset['char']).toBe(' ');

    render('\n');
    expect(element.querySelector('.finger__label')?.textContent).toContain('Enter');
    expect(nextKey(element)?.dataset['char']).toBe('\n');

    render('\t');
    expect(element.querySelector('.finger__label')?.textContent).toContain('Tab');
  });

  it('hides itself when the drill is done, and says so for a key it does not know', () => {
    const { element, render } = mount();

    render('中');
    expect(element.hidden).toBe(false);
    expect(element.querySelector('.finger__label')?.textContent).toMatch(/No key/);

    render(null);
    expect(element.hidden).toBe(true);
    expect(nextKey(element)).toBeNull();
  });

  it('agrees with the layout table for every key it can hint', () => {
    const { element, render } = mount();
    for (const char of KEY_LAYOUT.keys()) {
      const hint = fingerHintFor(char);
      if (hint === null) {
        continue;
      }
      render(char);
      // Tab is mapped for attribution but has no cap of its own, so it is exempt from
      // the "the diagram marks it" half of the claim.
      if (char === '\t') {
        continue;
      }
      expect(nextKey(element)?.dataset['finger'], JSON.stringify(char)).toBe(hint.finger);
    }
  });

  it('describes the characters that have no glyph of their own', () => {
    expect(describeKey(' ')).toBe('space');
    expect(describeKey('\n')).toBe('Enter ⏎');
    expect(describeKey('\t')).toBe('Tab');
    expect(describeKey('q')).toBe('q');
  });

  it('marks the keyboard as decorative, because the sentence is the answer', () => {
    const { element } = mount();
    expect(element.querySelector('.finger__keyboard')?.getAttribute('aria-hidden')).toBe('true');
  });
});
