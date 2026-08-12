import type { MTMTrack } from '../game/formats';

/**
 * Course map for the level-select screen.
 *
 * Drawn straight from the road control points at low resolution with hard
 * edges, in the style of the course diagrams printed in the manual.
 */
export function renderTrackThumbnail(track: MTMTrack, width = 320, height = 200): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.className = 'thumb';

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = '#14140f';
  ctx.fillRect(0, 0, width, height);

  const points = track.road.points.map((p) => ({ x: p.pos[0], z: p.pos[2], y: p.pos[1] }));
  if (points.length < 2) return canvas;

  // Fit the course to the canvas with a margin, preserving aspect.
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  const margin = 22;
  const scale = Math.min(
    (width - margin * 2) / Math.max(1, maxX - minX),
    (height - margin * 2) / Math.max(1, maxZ - minZ),
  );
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;

  const project = (p: { x: number; z: number }): [number, number] => [
    width / 2 + (p.x - centreX) * scale,
    height / 2 + (p.z - centreZ) * scale,
  ];

  // Faint grid, as if printed on graph paper.
  ctx.strokeStyle = '#24241c';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }

  const trace = (): void => {
    ctx.beginPath();
    const [sx, sy] = project(points[0]);
    ctx.moveTo(sx, sy);
    // Quadratic midpoint smoothing approximates the Catmull-Rom the game
    // actually drives closely enough for a thumbnail.
    for (let i = 1; i <= points.length; i++) {
      const current = points[i % points.length];
      const next = points[(i + 1) % points.length];
      const [cx, cy] = project(current);
      const [nx, ny] = project(next);
      ctx.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
    }
    if (track.road.closed) ctx.closePath();
  };

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Verge, then racing surface, then centre line.
  ctx.strokeStyle = '#3a3a2a';
  ctx.lineWidth = Math.max(7, track.road.width * scale * 0.55);
  trace();
  ctx.stroke();

  ctx.strokeStyle = '#8a7450';
  ctx.lineWidth = Math.max(4, track.road.width * scale * 0.36);
  trace();
  ctx.stroke();

  ctx.strokeStyle = '#c8a870';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]);
  trace();
  ctx.stroke();
  ctx.setLineDash([]);

  // Start/finish marker at the first control point.
  const [fx, fy] = project(points[0]);
  ctx.fillStyle = '#e8e4d0';
  ctx.fillRect(fx - 5, fy - 5, 10, 10);
  ctx.fillStyle = '#1a1a18';
  ctx.fillRect(fx - 5, fy - 5, 5, 5);
  ctx.fillRect(fx, fy, 5, 5);

  // Direction arrow, pointing along the opening stretch.
  const [ax, ay] = project(points[1 % points.length]);
  const angle = Math.atan2(ay - fy, ax - fx);
  ctx.save();
  ctx.translate(fx + Math.cos(angle) * 20, fy + Math.sin(angle) * 20);
  ctx.rotate(angle);
  ctx.fillStyle = '#ffb020';
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-5, -5);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Scale bar, in metres.
  const barMetres = 100;
  const barPixels = barMetres * scale;
  if (barPixels > 24 && barPixels < width - 40) {
    ctx.fillStyle = '#6e6e5e';
    ctx.fillRect(12, height - 16, barPixels, 3);
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = '#8a8a7a';
    ctx.fillText(`${barMetres}M`, 12, height - 20);
  }

  return canvas;
}
