#!/usr/bin/env node
/**
 * Generate all PWA icon sizes from the canonical 512×512 source.
 * Usage: node scripts/generate-icons.js
 */
const sharp = require('sharp');
const path = require('path');

const SRC = path.join(__dirname, '..', 'frontend', 'public', 'gymvault-app-icon-512.png');
const OUT = path.join(__dirname, '..', 'frontend', 'public');
const BG = '#161d4f'; // dark theme background

async function generate() {
  const src = sharp(SRC);
  const meta = await src.metadata();
  console.log(`Source: ${meta.width}×${meta.height}`);

  // Regular icons — resize with contain + dark background so nothing is cropped
  const sizes = [
    { size: 32, name: 'gymvault-app-icon-32.png' },
    { size: 64, name: 'gymvault-app-icon-64.png' },
    { size: 180, name: 'gymvault-app-icon-180.png' },
    { size: 192, name: 'gymvault-app-icon-192.png' },
  ];

  for (const { size, name } of sizes) {
    // Add 10% padding around logo for regular icons so they breathe
    const logoSize = Math.round(size * 0.85);
    await sharp(SRC)
      .resize(logoSize, logoSize, { fit: 'contain', background: BG })
      .flatten({ background: BG })
      .extend({
        top: Math.round((size - logoSize) / 2),
        bottom: size - logoSize - Math.round((size - logoSize) / 2),
        left: Math.round((size - logoSize) / 2),
        right: size - logoSize - Math.round((size - logoSize) / 2),
        background: BG,
      })
      .png()
      .toFile(path.join(OUT, name));
    console.log(`  ✓ ${name} (${size}×${size})`);
  }

  // Maskable icons — Android adaptive icon safe zone is center 80%
  // So the logo must sit within the center 80%, meaning 20% total padding (10% each side)
  const maskableSizes = [
    { size: 192, name: 'gymvault-app-icon-192-maskable.png' },
    { size: 512, name: 'gymvault-app-icon-512-maskable.png' },
  ];

  for (const { size, name } of maskableSizes) {
    const logoSize = Math.round(size * 0.70); // logo occupies 70% — generous safe zone
    await sharp(SRC)
      .resize(logoSize, logoSize, { fit: 'contain', background: BG })
      .flatten({ background: BG })
      .extend({
        top: Math.round((size - logoSize) / 2),
        bottom: size - logoSize - Math.round((size - logoSize) / 2),
        left: Math.round((size - logoSize) / 2),
        right: size - logoSize - Math.round((size - logoSize) / 2),
        background: BG,
      })
      .png()
      .toFile(path.join(OUT, name));
    console.log(`  ✓ ${name} maskable (${size}×${size}, logo ${logoSize}px)`);
  }

  console.log('Done.');
}

generate().catch((err) => { console.error(err); process.exit(1); });
