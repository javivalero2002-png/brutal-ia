#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Detecta colores rgba() usados como base para concatenar opacidad.
//
// La UI genera variantes así:  style={{background: color + '18'}}
// Con un hex sale '#1B5FFA18' (hex de 8 dígitos, válido). Con un rgba sale
// 'rgba(27,95,250,0.9)18', que es basura: el navegador descarta la declaración
// ENTERA —sin error y sin nada en consola— y el elemento se pinta sin fondo ni
// borde. Ya ha pasado ocho veces en este repo y nunca se vio en la consola.
//
// Se usa el AST de TypeScript, no expresiones regulares: tres intentos con regex
// fallaron porque en un ternario `cond ? BLU : 'rgba(...)'` el texto plano parece
// asignarle el rgba a BLU, que es hex.
//
// PRECISIÓN POR ENCIMA DE COBERTURA. Solo se avisa cuando se puede seguir el
// enlace hasta el literal de verdad; lo que no se puede resolver se calla. Un
// checker que grita 118 veces con 3 aciertos no lo usa nadie, y este va a correr
// en cada build.
//
// Resuelve tres formas, que son las que usa este código:
//   const X = 'rgba(...)'              →  X + '18'
//   [{c:'rgba(...)'}].map(o => …)      →  o.c + '18'
//   const OBJ = {a:{color:'rgba(…)'}}  →  OBJ[k].color + '18'
//
// Uso:  node scripts/check-color-opacity.mjs      (sale 1 si encuentra algo)
// ─────────────────────────────────────────────────────────────────────────────
import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RGBA = /^rgba?\(/i
const SUFIJO = /^[0-9a-fA-F]{2}$/

function ficheros(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) ficheros(p, out)
    else if (/\.tsx?$/.test(p) && !p.includes('__tests__')) out.push(p)
  }
  return out
}

// ¿Este nodo puede evaluar a un rgba? Atraviesa ternarios y `||`.
function esRgba(n) {
  if (!n) return false
  if (ts.isStringLiteral(n)) return RGBA.test(n.text)
  if (ts.isConditionalExpression(n)) return esRgba(n.whenTrue) || esRgba(n.whenFalse)
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return esRgba(n.left) || esRgba(n.right)
  }
  if (ts.isParenthesizedExpression(n)) return esRgba(n.expression)
  return false
}

// Todos los valores que un literal (objeto o array de objetos) da a `prop`.
function valoresDe(nodo, prop, out = []) {
  if (!nodo) return out
  if (ts.isAsExpression(nodo) || ts.isParenthesizedExpression(nodo)) return valoresDe(nodo.expression, prop, out)
  if (ts.isArrayLiteralExpression(nodo)) { for (const el of nodo.elements) valoresDe(el, prop, out); return out }
  if (ts.isObjectLiteralExpression(nodo)) {
    for (const p of nodo.properties) {
      if (!ts.isPropertyAssignment(p)) continue
      const nm = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null
      if (nm === prop) out.push(p.initializer)
      // Un nivel de anidamiento: const PRI = { urgent:{color:'…'} } → PRI[k].color
      else if (ts.isObjectLiteralExpression(p.initializer)) valoresDe(p.initializer, prop, out)
    }
  }
  return out
}

const hallazgos = []

for (const file of ficheros('src')) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  // Índice de variables del fichero → su inicializador.
  const varsDecl = new Map()
  const idx = n => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) varsDecl.set(n.name.text, n.initializer)
    ts.forEachChild(n, idx)
  }
  idx(sf)

  // El nodo del que sale el objeto sobre el que se accede a `.prop`.
  // Para `opt` en `[…].map(opt => …)` devuelve el array literal.
  function origenDe(ident, desde) {
    const nombre = ident.text
    let n = desde
    while (n) {
      if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parameters.some(p => ts.isIdentifier(p.name) && p.name.text === nombre)) {
        const call = n.parent
        if (call && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)
            && ['map', 'forEach', 'filter', 'flatMap'].includes(call.expression.name.text)) {
          const recep = call.expression.expression
          return ts.isIdentifier(recep) ? varsDecl.get(recep.text) : recep
        }
        return null
      }
      n = n.parent
    }
    return varsDecl.get(nombre) || null
  }

  // ¿La expresión base de la concatenación puede ser un rgba?
  function baseEsRgba(expr) {
    if (ts.isIdentifier(expr)) return esRgba(varsDecl.get(expr.text))
    if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
      const prop = ts.isPropertyAccessExpression(expr)
        ? expr.name.text
        : (ts.isStringLiteral(expr.argumentExpression) ? expr.argumentExpression.text : null)
      if (!prop) return false
      // Raíz: `PRI[level].color` → PRI ; `opt.c` → opt
      let raiz = expr.expression
      while (ts.isPropertyAccessExpression(raiz) || ts.isElementAccessExpression(raiz)) raiz = raiz.expression
      if (!ts.isIdentifier(raiz)) return false
      const origen = origenDe(raiz, expr)
      return valoresDe(origen, prop).some(esRgba)
    }
    return false
  }

  const revisa = (expr, sufijo, pos) => {
    if (!baseEsRgba(expr)) return
    const { line } = sf.getLineAndCharacterOfPosition(pos)
    hallazgos.push({ file, line: line + 1, expr: expr.getText(sf).slice(0, 40), sufijo })
  }

  const rec = n => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken
        && ts.isStringLiteral(n.right) && SUFIJO.test(n.right.text)) {
      revisa(n.left, n.right.text, n.getStart(sf))
    }
    if (ts.isTemplateExpression(n)) {
      for (const span of n.templateSpans) {
        const lit = span.literal.text
        if (lit.length >= 2 && SUFIJO.test(lit.slice(0, 2))) revisa(span.expression, lit.slice(0, 2), span.getStart(sf))
      }
    }
    ts.forEachChild(n, rec)
  }
  rec(sf)
}

if (hallazgos.length === 0) {
  console.log('✅ Ningún color rgba() usado como base de opacidad.')
  process.exit(0)
}

console.error(`❌ ${hallazgos.length} colores rgba() concatenados con opacidad — el navegador descarta esas declaraciones:\n`)
for (const h of hallazgos) console.error(`   ${h.file}:${h.line}   ${h.expr} + '${h.sufijo}'`)
console.error('\nArregla usando un hex #RRGGBB como base (design-tokens.ts tiene AMBAR = #FFB020).')
process.exit(1)
