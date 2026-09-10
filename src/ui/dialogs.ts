import type { ExportFile, ImportMode } from '../store/transfer';
import { h } from './dom';
import { formatCount } from './format';

/**
 * Native `<dialog>` prompts (DESIGN.md §4.2). Both resolve a promise rather than
 * taking callbacks, so the caller reads top to bottom.
 */

/** Typed confirmation for the destructive action (PROJECT.md F11). */
export const CLEAR_PHRASE = 'clear all';

export function clearConfirmationMatches(value: string): boolean {
  return value.trim().toLowerCase() === CLEAR_PHRASE;
}

export function askImportMode(file: ExportFile): Promise<ImportMode | null> {
  return runDialog<ImportMode | null>(null, (close) => {
    const body = h('div', 'dialog__body');
    body.append(h('h2', 'dialog__title', 'Import history'));
    body.append(
      h(
        'p',
        'dialog__text',
        `This file holds ${formatCount(file.aggregates.totalSessions)} sessions and ` +
          `${formatCount(file.aggregates.totalKeystrokes)} keystrokes, exported ${describeDate(file.exportedAt)} ` +
          `by version ${file.app.version}.`,
      ),
    );
    body.append(
      h(
        'p',
        'dialog__text',
        'Replace discards what is stored here. Merge adds the file on top. ' +
          'Either way the file\u2019s settings become yours.',
      ),
    );

    const actions = h('div', 'dialog__actions');
    const replace = h('button', 'button button--danger', 'Replace');
    replace.type = 'button';
    replace.addEventListener('click', () => {
      close('replace');
    });
    const merge = h('button', 'button button--primary', 'Merge');
    merge.type = 'button';
    merge.addEventListener('click', () => {
      close('merge');
    });
    const cancel = h('button', 'button', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      close(null);
    });
    actions.append(merge, replace, cancel);
    body.append(actions);
    return body;
  });
}

/**
 * Fallback for when the browser blocks the download (PROJECT.md F8). The JSON is put
 * in a selected textarea rather than the clipboard, because the clipboard API needs a
 * secure context and the site answers on plain http too.
 */
export function showExportFallback(text: string): Promise<void> {
  return runDialog<void>(undefined, (close) => {
    const body = h('div', 'dialog__body');
    body.append(h('h2', 'dialog__title', 'Copy your export'));
    body.append(
      h(
        'p',
        'dialog__text',
        'This browser blocked the download, so select all of the text below and save it to a file yourself.',
      ),
    );
    const area = h('textarea', 'textarea');
    area.readOnly = true;
    area.rows = 12;
    area.value = text;
    body.append(area);

    const actions = h('div', 'dialog__actions');
    const closeButton = h('button', 'button button--primary', 'Done');
    closeButton.type = 'button';
    closeButton.addEventListener('click', () => {
      close(undefined);
    });
    actions.append(closeButton);
    body.append(actions);

    queueMicrotask(() => {
      area.focus();
      area.select();
    });
    return body;
  });
}

export function confirmClear(sessionCount: number): Promise<boolean> {  return runDialog<boolean>(false, (close) => {
    const body = h('div', 'dialog__body');
    body.append(h('h2', 'dialog__title', 'Clear all history?'));
    body.append(
      h(
        'p',
        'dialog__text',
        `This deletes ${formatCount(sessionCount)} sessions, every counter and your settings. ` +
          'It cannot be undone, so export first if you are not sure.',
      ),
    );

    const field = h('label', 'field');
    field.append(h('span', 'field__label', `Type "${CLEAR_PHRASE}" to confirm`));
    const input = h('input', 'input');
    input.type = 'text';
    input.autocomplete = 'off';
    field.append(input);
    body.append(field);

    const actions = h('div', 'dialog__actions');
    const confirm = h('button', 'button button--danger', 'Clear everything');
    confirm.type = 'button';
    confirm.disabled = true;
    confirm.addEventListener('click', () => {
      close(true);
    });
    const cancel = h('button', 'button', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      close(false);
    });
    input.addEventListener('input', () => {
      confirm.disabled = !clearConfirmationMatches(input.value);
    });
    actions.append(confirm, cancel);
    body.append(actions);

    // Focus the field so the dialog can be completed from the keyboard alone.
    queueMicrotask(() => {
      input.focus();
    });
    return body;
  });
}

function runDialog<T>(
  cancelValue: T,
  build: (close: (value: T) => void) => HTMLElement,
): Promise<T> {
  return new Promise<T>((resolve) => {
    const dialog = h('dialog', 'dialog');
    let settled = false;

    const finish = (value: T): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (typeof dialog.close === 'function') {
        dialog.close();
      }
      dialog.remove();
      resolve(value);
    };

    dialog.addEventListener('cancel', () => {
      finish(cancelValue);
    });
    dialog.append(build(finish));
    document.body.append(dialog);

    // happy-dom has no modal support, so fall back to the open attribute.
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  });
}

function describeDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 'at an unknown time';
  }
  return `on ${new Date(timestamp).toISOString().slice(0, 10)}`;
}
