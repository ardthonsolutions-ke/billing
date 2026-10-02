require('dotenv').config();
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');

// Theme colors
const BRAND  = '#1a4a8a';
const ACCENT = '#e85d2c';
const WHITE  = '#ffffff';

/**
 * Build a geometric icon SVG — no text, no fonts, no pango.
 * The icon is a rounded square with a stylized "billing slip" mark.
 *
 * @param {object} opts
 * @param {string} opts.bg       Background hex
 * @param {string} opts.fg       Foreground hex (icon strokes)
 * @param {number} opts.size     Square size in pixels
 * @param {boolean} opts.maskable If true, no rounded corners (full-bleed for Android)
 * @param {number} opts.scheme   1 or 2 — visual variant (1 = receipt, 2 = circle mark)
 */
function buildSVG({ bg, fg, size, maskable, scheme = 1 }) {
  const radius = maskable ? 0 : Math.round(size * 0.18);

  // The inner mark occupies the middle ~54% of the canvas
  const pad = maskable ? size * 0.28 : size * 0.24;   // extra padding for maskable safe zone
  const inner = size - pad * 2;
  const x0 = pad;
  const y0 = pad;
  const strokeW = Math.round(size * 0.055);
  const gap = Math.round(size * 0.06);

  let mark = '';

  if (scheme === 1) {
    // Receipt: rounded rect with 3 lines inside
    const rx = Math.round(inner * 0.12);
    mark = `
      <rect x="${x0}" y="${y0}" width="${inner}" height="${inner}" rx="${rx}" ry="${rx}"
            fill="none" stroke="${fg}" stroke-width="${strokeW}"/>
      <line x1="${x0 + gap}" y1="${y0 + inner * 0.30}" x2="${x0 + inner - gap}" y2="${y0 + inner * 0.30}"
            stroke="${fg}" stroke-width="${strokeW}" stroke-linecap="round"/>
      <line x1="${x0 + gap}" y1="${y0 + inner * 0.52}" x2="${x0 + inner - gap}" y2="${y0 + inner * 0.52}"
            stroke="${fg}" stroke-width="${strokeW}" stroke-linecap="round"/>
      <line x1="${x0 + gap}" y1="${y0 + inner * 0.74}" x2="${x0 + inner * 0.65}" y2="${y0 + inner * 0.74}"
            stroke="${fg}" stroke-width="${strokeW}" stroke-linecap="round"/>
    `;
  } else {
    // Circular money symbol: outer circle + vertical bar + horizontal bar (like a stylized ₭)
    const cx = size / 2;
    const cy = size / 2;
    const r = inner / 2;
    mark = `
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${fg}" stroke-width="${strokeW}"/>
      <line x1="${cx - r * 0.45}" y1="${cy - r * 0.55}" x2="${cx - r * 0.45}" y2="${cy + r * 0.55}"
            stroke="${fg}" stroke-width="${strokeW}" stroke-linecap="round"/>
      <line x1="${cx - r * 0.55}" y1="${cy - r * 0.10}" x2="${cx + r * 0.55}" y2="${cy - r * 0.10}"
            stroke="${fg}" stroke-width="${strokeW}" stroke-linecap="round"/>
      <line x1="${cx - r * 0.10}" y1="${cy - r * 0.55}" x2="${cx + r * 0.55}" y2="${cy + r * 0.10}"
            stroke="${fg}" stroke-width="${strokeW}" stroke-linecap="round"/>
      <line x1="${cx - r * 0.10}" y1="${cy + r * 0.55}" x2="${cx + r * 0.55}" y2="${cy - r * 0.10}"
            stroke="${fg}" stroke-width="${strokeW}" stroke-linecap="round"/>
    `;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${bg}"/>
    ${mark}
  </svg>`;
}

async function writeIcon(name, svg) {
  const out = path.join(OUT_DIR, name);
  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toFile(out);
  const stats = fs.statSync(out);
  console.log('  ✓', name.padEnd(30), stats.size, 'bytes');
}

async function main() {
  console.log('Generating icons into', OUT_DIR);
  console.log('');

  console.log('Admin (receipt mark, brand navy):');
  await writeIcon('admin-192.png',        buildSVG({ bg: BRAND,  fg: WHITE, size: 192, maskable: false, scheme: 1 }));
  await writeIcon('admin-512.png',        buildSVG({ bg: BRAND,  fg: WHITE, size: 512, maskable: false, scheme: 1 }));
  await writeIcon('admin-maskable-512.png',buildSVG({ bg: BRAND, fg: WHITE, size: 512, maskable: true,  scheme: 1 }));
  await writeIcon('admin-180.png',        buildSVG({ bg: BRAND,  fg: WHITE, size: 180, maskable: false, scheme: 1 }));

  console.log('');
  console.log('Portal (money mark, accent orange):');
  await writeIcon('portal-192.png',        buildSVG({ bg: ACCENT, fg: WHITE, size: 192, maskable: false, scheme: 2 }));
  await writeIcon('portal-512.png',        buildSVG({ bg: ACCENT, fg: WHITE, size: 512, maskable: false, scheme: 2 }));
  await writeIcon('portal-maskable-512.png',buildSVG({ bg: ACCENT, fg: WHITE, size: 512, maskable: true,  scheme: 2 }));
  await writeIcon('portal-180.png',        buildSVG({ bg: ACCENT, fg: WHITE, size: 180, maskable: false, scheme: 2 }));

  console.log('');
  console.log('Favicon:');
  await writeIcon('favicon-32.png', buildSVG({ bg: BRAND, fg: WHITE, size: 32, maskable: false, scheme: 1 }));

  console.log('');
  console.log('Done.');
}

main().catch(err => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});

// NOTE: appended ico generation below
