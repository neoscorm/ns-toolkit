// An explanation before the browser's system window "Allow this site to view and copy files?".
// The system window cannot be changed, so we explain beforehand what is about to happen.
// The browser window opens only on a click of the button — that click also gives the needed
// "user activation", without which showDirectoryPicker will not open.

import { h, icon } from './dom';

/** Shows the explanation. true — the user pressed "Choose folder", false — cancelled */
export function confirmFolderAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'notice', 'aria-labelledby': 'notice-title' });
    let answer = false;

    const choose = h(
      'button',
      {
        type: 'button',
        class: 'button button-primary',
        on: {
          click: () => {
            answer = true;
            dialog.close();
          },
        },
      },
      icon('folder'),
      h('span', null, 'Choose folder'),
    );
    const cancel = h(
      'button',
      { type: 'button', class: 'button button-quiet', on: { click: () => dialog.close() } },
      h('span', null, 'Cancel'),
    );

    dialog.append(
      h('div', { class: 'notice-body' },
        h('h2', { id: 'notice-title' }, 'Your browser will ask for access'),
        h('p', null, 'After you click “Choose folder”, the browser shows its own window. It asks whether this site may view and copy files in the folder you pick.'),
        h('p', null, 'Click ', h('strong', null, 'Allow'), '. Access is read-only: nothing is uploaded, changed or deleted. Files are read here, in your browser.'),
        h('div', { class: 'notice-actions' }, cancel, choose),
      ),
    );

    // Closing in any way (buttons, Escape) — remove the dialog from the page and answer
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    choose.focus();
  });
}
