// Works around a known Chromium/WebView2 bug where a native scrollbar-thumb
// drag gets stuck "captured" after a click - typically triggered by precision
// touchpad drivers that emit mousemove without a matching mouseup right after
// the click. Symptom: click a scrollbar once, then any further pointer motion
// keeps dragging it as if the button were still held down. Long lists (the
// Packages / Debloater views) are where this is actually noticed.
//
// Only acts if we saw a mousedown with no matching mouseup yet - `e.buttons
// === 0` on a subsequent mousemove then means the OS-reported button state
// disagrees with what we're tracking, i.e. the real mouseup happened but
// wasn't delivered as an event. That's the stuck-drag signature; a synthetic
// mouseup nudges the browser's internal scrollbar-drag state to release.
export function installScrollbarDragFix() {
  let mouseIsDown = false

  window.addEventListener('mousedown', () => { mouseIsDown = true }, { capture: true })
  window.addEventListener('mouseup', () => { mouseIsDown = false }, { capture: true })

  window.addEventListener(
    'mousemove',
    (e: MouseEvent) => {
      if (mouseIsDown && e.buttons === 0) {
        mouseIsDown = false
        window.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            clientX: e.clientX,
            clientY: e.clientY,
          })
        )
      }
    },
    { capture: true }
  )
}
