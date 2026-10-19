// Custom alert/confirm/prompt replacements, styled like the rest of the app
// instead of the browser's native dialogs. Single shared sheet, built once
// and reused — calls are always sequential (a person can only be looking at
// one dialog at a time), so there's no need to queue concurrent opens.

import { quantityStepperHtml, wireQuantitySteppers, parseQuantity } from './fields.js';

let ready = false;

function ensureModal() {
  if (ready) return;
  ready = true;
  const screen = document.querySelector('.screen');
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="modal-overlay compare-overlay" id="app-modal">
      <div class="modal-sheet compare-sheet">
        <h3 class="modal-title" id="app-modal-title"></h3>
        <p class="modal-message" id="app-modal-message"></p>
        <input class="text-input modal-input" id="app-modal-input">
        <div class="modal-actions">
          <button type="button" class="modal-btn-cancel" id="app-modal-cancel"></button>
          <button type="button" class="primary-btn" id="app-modal-confirm"></button>
        </div>
      </div>
    </div>`;
  screen.appendChild(wrap.firstElementChild);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('app-modal').classList.contains('open')) {
      document.getElementById('app-modal-cancel').onclick?.();
    }
  });
}

function showModal({ title, message, confirmLabel, cancelLabel, showInput, inputValue, inputPlaceholder, inputType, inputMode, danger, onConfirm }) {
  ensureModal();
  const overlay = document.getElementById('app-modal');
  const titleEl = document.getElementById('app-modal-title');
  const msgEl = document.getElementById('app-modal-message');
  const input = document.getElementById('app-modal-input');
  const cancelBtn = document.getElementById('app-modal-cancel');
  const confirmBtn = document.getElementById('app-modal-confirm');

  titleEl.textContent = title ?? '';
  titleEl.style.display = title ? '' : 'none';
  msgEl.textContent = message ?? '';
  msgEl.style.display = message ? '' : 'none';
  input.style.display = showInput ? 'block' : 'none';
  const pasteBox = document.getElementById('app-modal-paste');
  if (pasteBox && !document.getElementById('app-modal').classList.contains('open')) pasteBox.style.display = 'none';
  const qtySlot = document.getElementById('app-modal-qty');
  if (qtySlot) qtySlot.style.display = 'none'; // quantityModal() shows it again after this
  input.type = inputType ?? 'text';
  input.inputMode = inputMode ?? '';
  input.value = inputValue ?? '';
  input.placeholder = inputPlaceholder ?? '';
  input.setAttribute('aria-label', message || title || inputPlaceholder || '');
  confirmBtn.textContent = confirmLabel;
  confirmBtn.classList.toggle('danger', !!danger);
  cancelBtn.style.display = cancelLabel == null ? 'none' : '';
  cancelBtn.textContent = cancelLabel ?? '';

  overlay.classList.add('open');
  if (showInput) requestAnimationFrame(() => { input.focus(); input.select(); });

  return new Promise((resolve) => {
    const finish = (value) => {
      // Never leave the (now invisible) field focused: iOS would keep the
      // keyboard state, and main.js would keep the app shortened for it.
      if (overlay.contains(document.activeElement)) document.activeElement.blur();
      overlay.classList.remove('open');
      resolve(value);
    };
    confirmBtn.onclick = () => {
      onConfirm?.(); // inside the tap: what needs a user gesture (share sheet) must start here
      finish(showInput ? input.value : true);
    };
    cancelBtn.onclick = () => finish(showInput ? null : false);
    overlay.onclick = (e) => {
      if (e.target === overlay) cancelBtn.onclick();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') confirmBtn.onclick();
    };
  });
}

export function alertModal(message, { title } = {}) {
  return showModal({ title, message, confirmLabel: 'OK', cancelLabel: null });
}

export function confirmModal(message, { title, confirmLabel = 'Conferma', cancelLabel = 'Annulla', danger = false, onConfirm } = {}) {
  return showModal({ title, message, confirmLabel, cancelLabel, danger, onConfirm });
}

export function promptModal(message, { title, defaultValue = '', placeholder = '', confirmLabel = 'Salva', cancelLabel = 'Annulla', inputType = 'text', inputMode } = {}) {
  return showModal({
    title,
    message,
    confirmLabel,
    cancelLabel,
    showInput: true,
    inputValue: defaultValue,
    inputPlaceholder: placeholder,
    inputType,
    inputMode,
  });
}

// A box to paste into with the system's own "Incolla" (long press): the one
// way to paste that always works on iOS, where reading the clipboard from a
// button can come back empty. Resolves { file } for an image, { url } for a
// link to one, or null if cancelled.
export function pasteModal({ title = 'Incolla la foto', message = 'Tieni premuto nel riquadro e scegli Incolla.' } = {}) {
  ensureModal();
  const sheet = document.querySelector('#app-modal .modal-sheet');
  let box = document.getElementById('app-modal-paste');
  if (!box) {
    box = document.createElement('div');
    box.id = 'app-modal-paste';
    box.className = 'paste-box';
    box.contentEditable = 'true';
    box.setAttribute('role', 'textbox');
    box.setAttribute('aria-label', 'Riquadro dove incollare la foto');
    sheet.insertBefore(box, sheet.querySelector('.modal-actions'));
  }
  box.textContent = '';
  const shown = showModal({ title, message, confirmLabel: 'Fatto', cancelLabel: 'Annulla' });
  box.style.display = '';
  const close = (value) => {
    box.style.display = 'none';
    resolvePaste(value);
  };
  let resolvePaste;
  const result = new Promise((r) => { resolvePaste = r; });
  let handled = false;
  const done = (value) => {
    if (handled) return;
    handled = true;
    document.getElementById('app-modal-confirm').onclick();
    close(value);
  };
  const fail = () => {
    box.textContent = 'Non è un\'immagine: copia la foto (tienila premuta, Copia) e riprova.';
  };
  // An <img> that iOS put in the box itself: a web link is sent as such,
  // anything else (blob:, data:, iOS's internal webkit-fake-url:) is redrawn
  // here into a file, since only this page can read it.
  const fromImg = async (img) => {
    if (/^https?:\/\//i.test(img.src)) return done({ url: img.src });
    try {
      if (!img.complete) await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (blob) return done({ file: blob });
    } catch (err) {
      console.error('pasted image unreadable', err);
    }
    fail();
  };
  // The keyboard's "Incolla da Foto" suggestion inserts the image without a
  // paste event: catch it when it lands in the box.
  box.oninput = () => {
    const img = box.querySelector('img');
    if (img) fromImg(img);
  };
  box.onpaste = (e) => {
    const data = e.clipboardData;
    const file = [...(data?.files ?? [])].find((f) => f.type.startsWith('image/'))
      ?? [...(data?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
    if (file) {
      e.preventDefault();
      return done({ file });
    }
    const html = data?.getData('text/html') ?? '';
    const src = html.match(/<img[^>]+src="([^"]+)"/i)?.[1];
    const text = (data?.getData('text/uri-list') || data?.getData('text/plain') || '').trim();
    const url = [src, text].find((u) => u && /^https?:\/\/\S+$/i.test(u));
    if (url) {
      e.preventDefault();
      return done({ url });
    }
    // iOS often hands over neither a file nor a link: it pastes the image
    // into the box as an <img>. Let the paste happen, then read that.
    box.textContent = '';
    setTimeout(() => {
        const img = box.querySelector('img');
      if (img) fromImg(img);
      else if (!handled) fail();
    }, 60);
  };
  shown.then(() => close(null));
  return result;
}

// "Quante bottiglie?" with the app's one quantity control (− n +). Resolves
// the number, or null when cancelled.
export function quantityModal({ title = 'Quante bottiglie?', message = '', value = 1, min = 1, confirmLabel = 'Aggiungi' } = {}) {
  ensureModal();
  const sheet = document.querySelector('#app-modal .modal-sheet');
  let slot = document.getElementById('app-modal-qty');
  if (!slot) {
    slot = document.createElement('div');
    slot.id = 'app-modal-qty';
    slot.className = 'modal-qty';
    sheet.insertBefore(slot, sheet.querySelector('.modal-actions'));
  }
  slot.innerHTML = quantityStepperHtml({ id: 'app-modal-qty-input', value, min });
  wireQuantitySteppers(slot);
  const input = slot.querySelector('input');
  const shown = showModal({ title, message, confirmLabel, cancelLabel: 'Annulla' });
  slot.style.display = '';
  // showModal resolves true/false; the number is read from the field.
  return shown.then((ok) => {
    const n = parseQuantity(input.value, min).value;
    slot.style.display = 'none';
    return ok ? (n ?? min) : null;
  });
}
