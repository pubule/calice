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

function showModal({ title, message, confirmLabel, cancelLabel, showInput, inputValue, inputPlaceholder, inputType, danger }) {
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
  input.type = inputType ?? 'text';
  input.value = inputValue ?? '';
  input.placeholder = inputPlaceholder ?? '';
  confirmBtn.textContent = confirmLabel;
  confirmBtn.classList.toggle('danger', !!danger);
  cancelBtn.style.display = cancelLabel == null ? 'none' : '';
  cancelBtn.textContent = cancelLabel ?? '';

  overlay.classList.add('open');
  if (showInput) requestAnimationFrame(() => { input.focus(); input.select(); });

  return new Promise((resolve) => {
    const finish = (value) => {
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

export function promptModal(message, { title, defaultValue = '', placeholder = '', confirmLabel = 'Salva', cancelLabel = 'Annulla', inputType = 'text' } = {}) {
  return showModal({
    title,
    message,
    confirmLabel,
    cancelLabel,
    showInput: true,
    inputValue: defaultValue,
    inputPlaceholder: placeholder,
    inputType,
  });
}
