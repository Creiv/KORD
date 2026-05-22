export function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
}

export function drawSwipeGlyph(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, direction: string | null, size: number): void {
  ctx.beginPath();
  if (direction === "left") {
    ctx.moveTo(centerX - size * 0.55, centerY);
    ctx.lineTo(centerX - size * 0.08, centerY - size * 0.42);
    ctx.lineTo(centerX - size * 0.08, centerY - size * 0.16);
    ctx.lineTo(centerX + size * 0.55, centerY - size * 0.16);
    ctx.lineTo(centerX + size * 0.55, centerY + size * 0.16);
    ctx.lineTo(centerX - size * 0.08, centerY + size * 0.16);
    ctx.lineTo(centerX - size * 0.08, centerY + size * 0.42);
  } else if (direction === "right") {
    ctx.moveTo(centerX + size * 0.55, centerY);
    ctx.lineTo(centerX + size * 0.08, centerY - size * 0.42);
    ctx.lineTo(centerX + size * 0.08, centerY - size * 0.16);
    ctx.lineTo(centerX - size * 0.55, centerY - size * 0.16);
    ctx.lineTo(centerX - size * 0.55, centerY + size * 0.16);
    ctx.lineTo(centerX + size * 0.08, centerY + size * 0.16);
    ctx.lineTo(centerX + size * 0.08, centerY + size * 0.42);
  } else {
    ctx.moveTo(centerX, centerY - size * 0.56);
    ctx.lineTo(centerX - size * 0.42, centerY - size * 0.08);
    ctx.lineTo(centerX - size * 0.16, centerY - size * 0.08);
    ctx.lineTo(centerX - size * 0.16, centerY + size * 0.54);
    ctx.lineTo(centerX + size * 0.16, centerY + size * 0.54);
    ctx.lineTo(centerX + size * 0.16, centerY - size * 0.08);
    ctx.lineTo(centerX + size * 0.42, centerY - size * 0.08);
  }
  ctx.closePath();
  ctx.fill();
}
