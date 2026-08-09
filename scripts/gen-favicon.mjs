// Genera icon-192.png, icon-512.png y apple-touch-icon.png desde el SVG de la "B"
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const require = createRequire(import.meta.url)
const sharp = require('sharp')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '../public')

// Diseño sin depender de fuentes del sistema — la "B" se construye con paths SVG
const svgTemplate = (size) => {
  const r = Math.round(size * 0.18)
  const barH = Math.round(size * 0.04)
  const barX = Math.round(size * 0.16)
  const barW = size - barX * 2

  // "B" construida con paths para no depender de fuentes del sistema
  // Coordenadas normalizadas para un viewBox de 100x100 escaladas a `size`
  const s = size / 100

  // Trazo vertical izquierdo de la B
  const stemX = 24 * s
  const stemW = 9 * s
  const topY = 14 * s
  const botY = 85 * s

  // Bump superior: rectángulo + semicírculo derecho
  const bump1TopY = 14 * s
  const bump1BotY = 48 * s
  const bump1RightX = 60 * s
  const bump1R = (bump1BotY - bump1TopY) / 2

  // Bump inferior (más grande): rectángulo + semicírculo derecho
  const bump2TopY = 48 * s
  const bump2BotY = 85 * s
  const bump2RightX = 68 * s
  const bump2R = (bump2BotY - bump2TopY) / 2

  const cx1 = bump1RightX - bump1R
  const cy1 = (bump1TopY + bump1BotY) / 2
  const cx2 = bump2RightX - bump2R
  const cy2 = (bump2TopY + bump2BotY) / 2

  // Path de la B
  const bPath = [
    `M ${stemX} ${topY}`,
    // top of B
    `H ${cx1}`,
    // upper bump arc
    `A ${bump1R} ${bump1R} 0 0 1 ${cx1} ${bump1BotY}`,
    // mid line back to stem inner
    `H ${stemX + stemW}`,
    // lower bump (wider)
    `H ${cx2}`,
    `A ${bump2R} ${bump2R} 0 0 1 ${cx2} ${bump2BotY}`,
    // bottom back
    `H ${stemX}`,
    `Z`,
    // inner cutout upper
    `M ${stemX + stemW} ${topY + stemW}`,
    `H ${cx1}`,
    `A ${bump1R - stemW} ${bump1R - stemW} 0 0 1 ${cx1} ${bump1BotY - stemW}`,
    `H ${stemX + stemW}`,
    `Z`,
    // inner cutout lower
    `M ${stemX + stemW} ${bump2TopY + stemW}`,
    `H ${cx2}`,
    `A ${bump2R - stemW} ${bump2R - stemW} 0 0 1 ${cx2} ${bump2BotY - stemW}`,
    `H ${stemX + stemW}`,
    `Z`,
  ].join(' ')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <!-- Fondo -->
  <rect width="${size}" height="${size}" rx="${r}" fill="#030308"/>
  <!-- Barra azul superior -->
  <rect x="${barX}" y="0" width="${barW}" height="${barH}" rx="${Math.round(barH/2)}" fill="#1B5FFA"/>
  <!-- Letra B con fill-rule para el cutout -->
  <path fill-rule="evenodd" d="${bPath}" fill="#FFFFFF"/>
</svg>`
}

const sizes = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
]

for (const { file, size } of sizes) {
  const svg = svgTemplate(size)
  const outPath = path.join(OUT, file)
  await sharp(Buffer.from(svg)).png().toFile(outPath)
  const stat = fs.statSync(outPath)
  console.log(`✓ ${file} (${size}×${size}, ${stat.size} bytes)`)
}

console.log('Favicons generados correctamente.')
