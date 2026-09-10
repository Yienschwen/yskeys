import { h } from './dom';

/**
 * A single in-flow banner below the header (DESIGN.md §3.1, §5.1). Banners never
 * overlay the drill. Only one is shown at a time: a newer message replaces the
 * previous one, so a burst of failures cannot stack up a wall of text.
 */

export type BannerKind = 'info' | 'warning' | 'error';

export interface BannerAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface BannerOptions {
  readonly kind: BannerKind;
  readonly message: string;
  readonly action?: BannerAction;
  /** Undismissible banners are for conditions the user cannot clear (no storage). */
  readonly dismissible?: boolean;
}

export interface BannerHost {
  readonly element: HTMLElement;
  show(options: BannerOptions): void;
  clear(): void;
}

const ROLE: Record<BannerKind, 'status' | 'alert'> = {
  info: 'status',
  warning: 'status',
  error: 'alert',
};

export function createBannerHost(): BannerHost {
  const element = h('div', 'banner-host');

  function clear(): void {
    element.replaceChildren();
  }

  function show(options: BannerOptions): void {
    const banner = h('div', `banner banner--${options.kind}`);
    banner.setAttribute('role', ROLE[options.kind]);
    banner.append(h('p', 'banner__message', options.message));

    if (options.action || options.dismissible !== false) {
      const actions = h('div', 'banner__actions');
      if (options.action) {
        const button = h('button', 'button button--ghost', options.action.label);
        button.type = 'button';
        button.addEventListener('click', () => {
          options.action?.onClick();
        });
        actions.append(button);
      }
      if (options.dismissible !== false) {
        const dismiss = h('button', 'button button--ghost', 'Dismiss');
        dismiss.type = 'button';
        dismiss.setAttribute('aria-label', 'Dismiss this message');
        dismiss.addEventListener('click', clear);
        actions.append(dismiss);
      }
      banner.append(actions);
    }

    element.replaceChildren(banner);
  }

  return { element, show, clear };
}
