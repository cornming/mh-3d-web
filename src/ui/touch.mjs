/* ==============================================================
   觸控操作：畫面左半為浮動類比搖桿，右半拖曳旋轉視角，
   右下角動作鍵則直接對應獵人的招式。
   ============================================================== */

const STICK_RADIUS_REM = 3.6;
const DEAD_ZONE = 0.14;

export function createTouchControls({ surface, isHunting, onAction, onActionEnd, onLook }) {
  const stick = document.getElementById('touch-stick');
  const knob = document.getElementById('touch-knob');
  const move = { x: 0, y: 0 };
  let stickPointer = null;
  let lookPointer = null;
  let origin = { x: 0, y: 0 };
  let lastLook = { x: 0, y: 0 };

  const stickRadius = () => STICK_RADIUS_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);

  function placeStick(x, y) {
    stick.style.transform = `translate(${x}px, ${y}px)`;
  }

  function restStick() {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    placeStick(rem * 7.4, window.innerHeight - rem * 8.2);
    knob.style.transform = '';
    stick.classList.remove('is-active');
  }

  function releaseStick() {
    stickPointer = null;
    move.x = 0;
    move.y = 0;
    restStick();
  }

  surface.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || !isHunting()) return;
    event.preventDefault();
    if (stickPointer === null && event.clientX < window.innerWidth * 0.45) {
      stickPointer = event.pointerId;
      origin = { x: event.clientX, y: event.clientY };
      placeStick(origin.x, origin.y);
      stick.classList.add('is-active');
    } else if (lookPointer === null) {
      lookPointer = event.pointerId;
      lastLook = { x: event.clientX, y: event.clientY };
    }
  });

  window.addEventListener('pointermove', (event) => {
    if (event.pointerId === stickPointer) {
      const radius = stickRadius();
      let dx = event.clientX - origin.x;
      let dy = event.clientY - origin.y;
      const length = Math.hypot(dx, dy);
      if (length > radius) {
        dx = (dx / length) * radius;
        dy = (dy / length) * radius;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const magnitude = Math.min(1, length / radius);
      if (magnitude < DEAD_ZONE) {
        move.x = 0;
        move.y = 0;
      } else {
        move.x = dx / radius;
        move.y = dy / radius;
      }
    } else if (event.pointerId === lookPointer) {
      onLook(event.clientX - lastLook.x, event.clientY - lastLook.y);
      lastLook = { x: event.clientX, y: event.clientY };
    }
  });

  const endPointer = (event) => {
    if (event.pointerId === stickPointer) releaseStick();
    if (event.pointerId === lookPointer) lookPointer = null;
  };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  document.querySelectorAll('#touch-controls [data-action]').forEach((button) => {
    const action = button.dataset.action;
    const release = (event) => {
      event?.preventDefault?.();
      if (!button.classList.contains('is-held')) return;
      button.classList.remove('is-held');
      onActionEnd(action);
    };
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.classList.add('is-held');
      button.setPointerCapture?.(event.pointerId);
      onAction(action);
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  });

  window.addEventListener('resize', () => {
    if (stickPointer === null) restStick();
  });
  restStick();

  return {
    /** 類比移動向量：x 向右為正、y 向下為正，長度不超過 1。 */
    move,
    reset() {
      releaseStick();
      lookPointer = null;
      document.querySelectorAll('#touch-controls .is-held').forEach((button) => button.classList.remove('is-held'));
    }
  };
}
