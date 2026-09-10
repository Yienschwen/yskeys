// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBannerHost } from '../ui/banner';

let host: ReturnType<typeof createBannerHost> | null = null;

afterEach(() => {
  host = null;
  document.body.innerHTML = '';
});

function mount(): ReturnType<typeof createBannerHost> {
  host = createBannerHost();
  document.body.append(host.element);
  return host;
}

describe('banner host', () => {
  it('announces errors with role=alert so they interrupt', () => {
    const banner = mount();
    banner.show({ kind: 'error', message: 'history is not being saved' });
    const node = banner.element.querySelector('.banner');
    expect(node?.getAttribute('role')).toBe('alert');
    expect(node?.className).toContain('banner--error');
    expect(banner.element.textContent).toContain('history is not being saved');
  });

  it('announces info and warning politely', () => {
    const banner = mount();
    banner.show({ kind: 'info', message: 'merged' });
    expect(banner.element.querySelector('.banner')?.getAttribute('role')).toBe('status');
    banner.show({ kind: 'warning', message: 'trimmed' });
    expect(banner.element.querySelector('.banner')?.getAttribute('role')).toBe('status');
  });

  it('replaces the previous banner instead of stacking them', () => {
    const banner = mount();
    banner.show({ kind: 'warning', message: 'first' });
    banner.show({ kind: 'warning', message: 'second' });
    expect(banner.element.querySelectorAll('.banner')).toHaveLength(1);
    expect(banner.element.textContent).toContain('second');
    expect(banner.element.textContent).not.toContain('first');
  });

  it('dismisses and can be cleared', () => {
    const banner = mount();
    banner.show({ kind: 'info', message: 'hello' });
    const dismiss = banner.element.querySelector('button');
    expect(dismiss?.textContent).toBe('Dismiss');
    dismiss?.click();
    expect(banner.element.querySelector('.banner')).toBeNull();

    banner.show({ kind: 'info', message: 'again' });
    banner.clear();
    expect(banner.element.textContent).toBe('');
  });

  it('omits the dismiss control when the condition cannot be cleared', () => {
    const banner = mount();
    banner.show({ kind: 'error', message: 'storage unavailable', dismissible: false });
    expect(banner.element.querySelector('button')).toBeNull();
  });

  it('runs the action without dismissing itself', () => {
    const banner = mount();
    const onClick = vi.fn();
    banner.show({ kind: 'info', message: 'replaced', action: { label: 'Undo', onClick } });

    const action = banner.element.querySelector('button');
    expect(action?.textContent).toBe('Undo');
    action?.click();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(banner.element.querySelector('.banner')).not.toBeNull();
  });
});
