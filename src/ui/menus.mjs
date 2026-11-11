import { formatQuestClock } from '../game-rules.mjs';

/* ==============================================================
   選單與畫面流程：載入、標題、任務看板、暫停、結算，以及
   操作說明／設定／確認三個對話框。只處理顯示、焦點與鍵盤導覽，
   遊戲本身的動作一律透過 onCommand 交回 main.mjs。
   ============================================================== */

const LOADING_TIPS = [
  '魔物出招前身體會閃爍，腳下也會浮現預警圈，看準時機翻滾就能以無敵時間穿過攻擊。',
  '攻擊頭部能造成更高的傷害；累積足夠的傷害後，魔物會失衡倒地。',
  '斬味會隨著命中逐漸下降，傷害也跟著降低——趁魔物喘息時使用砥石。',
  '切斷尾部之後，迴旋甩尾的範圍與威力都會減弱。',
  '大劍的蓄力重斬分為三段，蓄得越久威力越高，但也更容易被打斷。',
  '魔物受傷到一定程度會咆哮並陷入狂暴，動作變得更快，先拉開距離觀察。',
  '耐力不足時無法翻滾或出招，別把耐力用到見底。'
];

const WEAPON_LABELS = { greatsword: '大劍', dualblades: '雙劍' };

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled)';

export function createMenus({ audio, settings, onCommand, onSettingsChange }) {
  const $ = (id) => document.getElementById(id);
  const screens = {
    loading: $('screen-loading'),
    title: $('screen-title'),
    quest: $('screen-quest'),
    pause: $('screen-pause'),
    result: $('screen-result')
  };
  const dialogs = {
    controls: $('dialog-controls'),
    settings: $('dialog-settings'),
    confirm: $('dialog-confirm')
  };
  const el = {
    loadingFill: $('loading-fill'),
    loadingBar: $('loading-bar'),
    loadingStatus: $('loading-status'),
    loadingTip: $('loading-tip'),
    titleContinue: $('title-continue'),
    titleContinueNote: $('title-continue-note'),
    titleRecord: $('title-record'),
    pauseTime: $('pause-time'),
    pauseWeapon: $('pause-weapon'),
    pauseLoad: $('pause-load'),
    saveStatus: $('save-status'),
    settingsSaveNote: $('settings-save-note'),
    result: $('result'),
    resultSub: $('result-sub'),
    resultTitle: $('result-title'),
    resultReason: $('result-reason'),
    resultSeal: $('result-seal'),
    resultRank: $('result-rank'),
    resultLedger: $('result-ledger'),
    resultRecord: $('result-record'),
    confirmTitle: $('confirm-title'),
    confirmText: $('confirm-text'),
    confirmYes: $('confirm-yes')
  };

  let weaponChoice = 'greatsword';
  let confirmResolver = null;
  /** 開啟中的對話框堆疊；最上層擁有鍵盤焦點。 */
  const dialogStack = [];
  const returnFocus = new Map();

  const openScreens = () => Object.values(screens).filter((screen) => screen.classList.contains('is-open'));
  const topLayer = () => dialogStack[dialogStack.length - 1] || openScreens().pop() || null;

  function focusFirst(container) {
    const preferred = container.querySelector('[data-autofocus]:not(:disabled)')
      || container.querySelector('.btn--primary:not(:disabled)')
      || container.querySelector('[data-menu] button:not(:disabled)')
      || container.querySelector(FOCUSABLE);
    // 先讓版面與轉場生效，避免焦點落在仍為 visibility:hidden 的元素上
    requestAnimationFrame(() => preferred?.focus({ preventScroll: true }));
  }

  function openScreen(name) {
    const screen = screens[name];
    if (!screen || screen.classList.contains('is-open')) return;
    screen.classList.add('is-open');
    if (name !== 'loading') focusFirst(screen);
  }

  function closeScreen(name) {
    screens[name]?.classList.remove('is-open');
  }

  function showOnly(name) {
    Object.keys(screens).forEach((key) => {
      if (key === name) openScreen(key);
      else closeScreen(key);
    });
    while (dialogStack.length) closeDialog(false);
    if (!name) document.activeElement?.blur?.();
  }

  function openDialog(name) {
    const dialog = dialogs[name];
    if (!dialog || dialogStack.includes(dialog)) return;
    returnFocus.set(dialog, document.activeElement);
    dialogStack.push(dialog);
    dialog.classList.add('is-open');
    focusFirst(dialog);
  }

  function closeDialog(playSound = true) {
    const dialog = dialogStack.pop();
    if (!dialog) return;
    dialog.classList.remove('is-open');
    if (dialog === dialogs.confirm && confirmResolver) {
      const resolve = confirmResolver;
      confirmResolver = null;
      resolve(false);
    }
    if (playSound) audio.playUiBack();
    const previous = returnFocus.get(dialog);
    returnFocus.delete(dialog);
    if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
  }

  function confirm({ title, text, confirmLabel = '確定' }) {
    el.confirmTitle.textContent = title;
    el.confirmText.textContent = text;
    el.confirmYes.textContent = confirmLabel;
    openDialog('confirm');
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function resolveConfirm(value) {
    const resolve = confirmResolver;
    confirmResolver = null;
    closeDialog(false);
    resolve?.(value);
  }

  // ---------- 指令分派 ----------

  function runCommand(command, source) {
    switch (command) {
      case 'new-hunt':
        audio.playUiConfirm();
        closeScreen('title');
        openScreen('quest');
        break;
      case 'quest-back':
        audio.playUiBack();
        closeScreen('quest');
        openScreen('title');
        break;
      case 'controls':
      case 'settings':
        audio.playUiConfirm();
        openDialog(command);
        break;
      case 'close-dialog':
        closeDialog();
        break;
      case 'confirm-yes':
        audio.playUiConfirm();
        resolveConfirm(true);
        break;
      case 'confirm-no':
        audio.playUiBack();
        resolveConfirm(false);
        break;
      case 'depart':
        audio.playUiConfirm();
        onCommand('depart', { weapon: weaponChoice });
        break;
      default:
        if (source?.disabled) return;
        if (command === 'resume') audio.playUiBack();
        else audio.playUiConfirm();
        onCommand(command, {});
    }
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest?.('[data-command]');
    if (trigger && !trigger.disabled) {
      runCommand(trigger.dataset.command, trigger);
      return;
    }
    const weaponCard = event.target.closest?.('[data-weapon-choice]');
    if (weaponCard) {
      audio.playUiMove();
      setWeaponChoice(weaponCard.dataset.weaponChoice);
      return;
    }
    const option = event.target.closest?.('[data-setting-option]');
    if (option) {
      audio.playUiMove();
      updateSetting(option.dataset.settingOption, option.dataset.value);
    }
  });

  // 滑鼠移入與鍵盤移動焦點時給同一個輕微的提示音
  document.addEventListener('pointerover', (event) => {
    const item = event.target.closest?.('.menu__item, .btn, .loadout__card');
    if (!item || item.disabled || item.contains(event.relatedTarget)) return;
    if (event.pointerType === 'mouse') audio.playUiMove();
  });

  /** 處理選單鍵盤操作；有畫面或對話框攔截按鍵時回傳 true。 */
  function handleKey(event) {
    const layer = topLayer();
    if (!layer || layer === screens.loading) return false;
    const key = event.key;
    const isRange = event.target instanceof HTMLInputElement && event.target.type === 'range';

    if (key === 'Escape') {
      event.preventDefault();
      if (dialogStack.length) {
        if (layer === dialogs.confirm) {
          audio.playUiBack();
          resolveConfirm(false);
        } else {
          closeDialog();
        }
      } else if (layer === screens.quest) {
        runCommand('quest-back');
      } else if (layer === screens.pause) {
        runCommand('resume');
      }
      return true;
    }

    const lower = key.toLowerCase();
    const next = key === 'ArrowDown' || lower === 's' || (key === 'ArrowRight' && !isRange);
    const previous = key === 'ArrowUp' || lower === 'w' || (key === 'ArrowLeft' && !isRange);
    if (next || previous) {
      const items = Array.from(layer.querySelectorAll(FOCUSABLE)).filter((item) => item.offsetParent !== null);
      if (items.length > 0) {
        event.preventDefault();
        const current = items.indexOf(document.activeElement);
        const index = current === -1
          ? (next ? 0 : items.length - 1)
          : (current + (next ? 1 : -1) + items.length) % items.length;
        items[index].focus({ preventScroll: false });
        audio.playUiMove();
      }
      return true;
    }

    if (key === 'Tab') {
      // 讓 Tab 留在目前這一層，不會跑到被遮住的畫面
      const items = Array.from(layer.querySelectorAll(FOCUSABLE)).filter((item) => item.offsetParent !== null);
      if (items.length > 0) {
        event.preventDefault();
        const current = items.indexOf(document.activeElement);
        const step = event.shiftKey ? -1 : 1;
        items[(current + step + items.length) % items.length].focus();
      }
      return true;
    }

    return true;
  }

  // ---------- 任務看板：武器選擇 ----------

  function setWeaponChoice(mode) {
    weaponChoice = mode === 'dualblades' ? 'dualblades' : 'greatsword';
    document.querySelectorAll('[data-weapon-choice]').forEach((card) => {
      card.setAttribute('aria-checked', String(card.dataset.weaponChoice === weaponChoice));
    });
  }

  // ---------- 設定 ----------

  function syncSettingsForm() {
    document.querySelectorAll('[data-setting]').forEach((input) => {
      const value = settings[input.dataset.setting];
      if (input.type === 'checkbox') {
        input.checked = Boolean(value);
      } else {
        const scale = Number(input.dataset.scale || 1);
        input.value = String(Math.round(value * scale));
        const min = Number(input.min);
        const max = Number(input.max);
        input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
        const output = document.querySelector(`[data-output="${input.dataset.setting}"]`);
        if (output) output.textContent = `${input.value}%`;
      }
    });
    document.querySelectorAll('[data-setting-option]').forEach((button) => {
      button.setAttribute('aria-checked', String(settings[button.dataset.settingOption] === button.dataset.value));
    });
  }

  function updateSetting(key, value) {
    settings[key] = value;
    syncSettingsForm();
    onSettingsChange(settings, key);
  }

  document.querySelectorAll('[data-setting]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.setting;
      if (input.type === 'checkbox') {
        audio.playUiMove();
        updateSetting(key, input.checked);
      } else {
        updateSetting(key, Number(input.value) / Number(input.dataset.scale || 1));
      }
    });
  });

  // ---------- 各畫面的資料 ----------

  function setLoading(progress, status) {
    const value = Math.min(1, Math.max(0.04, progress));
    el.loadingFill.style.setProperty('--value', value.toFixed(3));
    el.loadingBar.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    if (status) el.loadingStatus.textContent = status;
  }

  function setTitleState({ hasSave, saveSummary, stats, records }) {
    el.titleContinue.disabled = !hasSave;
    el.titleContinueNote.textContent = hasSave ? saveSummary : '尚無存檔';
    const parts = [`狩獵紀錄　<b>${stats.victories}</b> 勝 <b>${stats.defeats}</b> 敗`];
    if (records.bestTimeSeconds !== null) {
      parts.push(`最快討伐　<b>${formatQuestClock(records.bestTimeSeconds)}</b>`);
    }
    if (records.bestRank) parts.push(`最高評價　<b>${records.bestRank}</b>`);
    el.titleRecord.innerHTML = parts.map((part) => `<span>${part}</span>`).join('');
    el.settingsSaveNote.textContent = hasSave ? saveSummary : '尚無存檔';
  }

  function setPauseState({ remainingSeconds, weaponMode, hasSave }) {
    el.pauseTime.textContent = formatQuestClock(remainingSeconds);
    el.pauseWeapon.textContent = WEAPON_LABELS[weaponMode] || WEAPON_LABELS.greatsword;
    el.pauseLoad.disabled = !hasSave;
  }

  function setSaveStatus(message) {
    el.saveStatus.textContent = message;
  }

  function showResult({ victory, reason, rank, rows, recordHtml }) {
    el.result.dataset.outcome = victory ? 'clear' : 'failed';
    el.resultSub.textContent = victory ? 'QUEST COMPLETE' : 'QUEST FAILED';
    el.resultTitle.textContent = victory ? '任務達成' : '任務失敗';
    el.resultReason.textContent = reason;
    el.resultSeal.dataset.rank = rank || 'none';
    el.resultRank.textContent = rank || '—';
    el.resultSeal.setAttribute('aria-label', rank ? `任務評價 ${rank}` : '未取得評價');
    el.resultLedger.replaceChildren(...rows.map(({ label, value, unit = '', tone = '' }) => {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      if (tone) detail.dataset.tone = tone;
      if (unit) {
        const small = document.createElement('small');
        small.textContent = unit;
        detail.appendChild(small);
      }
      row.append(term, detail);
      return row;
    }));
    el.resultRecord.innerHTML = recordHtml;
    showOnly('result');
  }

  el.loadingTip.textContent = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];
  syncSettingsForm();

  return {
    openScreen,
    closeScreen,
    showOnly,
    openDialog,
    confirm,
    handleKey,
    isOpen: () => Boolean(topLayer()),
    setLoading,
    setTitleState,
    setPauseState,
    setSaveStatus,
    showResult,
    setWeaponChoice,
    syncSettingsForm
  };
}
