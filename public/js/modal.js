// Custom alert/confirm/prompt replacements, styled like the rest of the app
// instead of the browser's native dialogs. Single shared sheet, built once
// and reused — calls are always sequential (a person can only be looking at
// one dialog at a time), so there's no need to queue concurrent opens.

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

function showModal({ title, message, confirmLabel, cancelLabel, showInput, inputValue, inputPlaceholder, inputType, inputMode, danger }) {
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
    confirmBtn.onclick = () => finish(showInput ? input.value : true);
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

export function confirmModal(message, { title, confirmLabel = 'Conferma', cancelLabel = 'Annulla', danger = false } = {}) {
  return showModal({ title, message, confirmLabel, cancelLabel, danger });
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
  box.onpaste = (e) => {
    e.preventDefault();
    const data = e.clipboardData;
    const file = [...(data?.files ?? [])].find((f) => f.type.startsWith('image/'))
      ?? [...(data?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
    let url = null;
    if (!file) {
      const html = data?.getData('text/html') ?? '';
      const src = html.match(/<img[^>]+src="([^"]+)"/i)?.[1];
      const text = (data?.getData('text/uri-list') || data?.getData('text/plain') || '').trim();
      url = [src, text].find((u) => u && /^https?:\/\/\S+$/i.test(u)) ?? null;
    }
    if (!file && !url) {
      box.textContent = 'Non è un\'immagine: copia la foto (tienila premuta, Copia) e riprova.';
      return;
    }
    document.getElementById('app-modal-confirm').onclick();
    close(file ? { file } : { url });
  };
  shown.then(() => close(null));
  return result;
}
