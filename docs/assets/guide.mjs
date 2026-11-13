// Fixed teaching example from SPEC.md §7. No rendering engine or motion layer.
export const GRID_RULE = {
  from: [0, 3],
  to: 0,
  repeat: [
    { count: 2, from_stride: 3, to_stride: 6 },
    { count: 2, from_stride: 0, to_stride: 3 },
  ],
};

/** Expand an at rule in axis declaration order, then source-range order. */
export function expandAt({ from: [a, b], to, repeat = [] }) {
  const span = b - a;
  const placements = [];
  function visit(axisIndex, sourceShift, targetShift, axes) {
    if (axisIndex === repeat.length) {
      for (let j = 0; j < span; j += 1) {
        placements.push({ source: a + j + sourceShift, target: to + j + targetShift, axes: [...axes] });
      }
      return;
    }
    const axis = repeat[axisIndex];
    for (let k = 0; k < axis.count; k += 1) {
      visit(axisIndex + 1,
        sourceShift + k * (axis.from_stride ?? 0),
        targetShift + k * (axis.to_stride ?? span),
        [...axes, k]);
    }
  }
  visit(0, 0, 0, []);
  return placements;
}

function setupRepeat(document) {
  const output = document.getElementById('repeat-output');
  const detail = document.getElementById('repeat-detail');
  const buttons = [...document.querySelectorAll('[data-repeat-block]')];
  if (!output || !detail || buttons.length !== 4) return;
  const placements = expandAt(GRID_RULE);
  const blockSize = GRID_RULE.from[1] - GRID_RULE.from[0];
  function selectBlock(index) {
    for (const button of buttons) {
      const selected = Number(button.dataset.repeatBlock) === index;
      button.setAttribute('aria-pressed', String(selected));
      button.closest('[data-repeat-row]').classList.toggle('is-selected', selected);
    }
    const block = placements.slice(index * blockSize, (index + 1) * blockSize);
    output.textContent = block.map(({ source, target }) => `B[${source}] → Grid[${target}]`).join(' · ');
  }
  for (const button of buttons) {
    button.hidden = false;
    button.addEventListener('click', () => selectBlock(Number(button.dataset.repeatBlock)));
  }
  detail.hidden = false;
  selectBlock(0);
}

/** The fallback also works over plain HTTP and file:// when Clipboard is absent. */
async function copyText(text, document) {
  const clipboard = document.defaultView.navigator.clipboard;
  if (document.defaultView.isSecureContext && clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // A denied Clipboard permission need not disable the user-triggered fallback.
    }
  }
  const previousFocus = document.activeElement;
  const selection = document.getSelection();
  const ranges = [];
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i += 1) ranges.push(selection.getRangeAt(i).cloneRange());
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.className = 'copy-fallback';
  field.setAttribute('aria-label', '코드 복사용 임시 필드');
  field.readOnly = true;
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('Copy was not accepted');
  } finally {
    field.remove();
    previousFocus?.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}

function setupCopy(document) {
  const status = document.getElementById('copy-status');
  for (const button of document.querySelectorAll('[data-copy]')) {
    const code = document.getElementById(button.dataset.copy);
    if (!code) continue;
    button.hidden = false;
    let copying = false;
    button.addEventListener('click', async () => {
      if (copying) return;
      copying = true;
      button.setAttribute('aria-busy', 'true');
      button.setAttribute('aria-disabled', 'true');
      status.textContent = '';
      try {
        await copyText(code.textContent, document);
        status.textContent = '코드를 복사했습니다.';
      } catch {
        status.textContent = '복사하지 못했습니다. 코드를 직접 선택해 복사해 주세요.';
      } finally {
        copying = false;
        button.removeAttribute('aria-busy');
        button.removeAttribute('aria-disabled');
      }
    });
  }
}

if (typeof document !== 'undefined') {
  setupRepeat(document);
  setupCopy(document);
}
