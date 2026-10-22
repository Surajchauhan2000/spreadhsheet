// Text width in px (same font as the grid cells). DOM-bound, so it lives outside engine/ and ai/.
let ctx = null
export function measureText(text) {
  if (!ctx) {
    ctx = document.createElement('canvas').getContext('2d')
    ctx.font = "13px 'Courier New', monospace"
  }
  return ctx.measureText(text).width
}