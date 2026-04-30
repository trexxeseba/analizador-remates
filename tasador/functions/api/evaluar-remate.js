// Evaluador de remate completo: scrape remotes.com.uy → MLU → Claude Amado Vintage v2.2
// Casa soportada automáticamente: Rematas (×1.1331). Otras: pasar casa_remate en el body.

const COMISIONES = {
  rematas: 0.1331,
  castells: 0.1791,
  bavastro: 0.1815,
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Sistema Amado Vintage v2.2 Modo Rápido (texto, sin imagen) ──────────────
const SYSTEM_PROMPT = `Sos el comité de compras de Amado Vintage, negocio uruguayo de reventa de objetos usados, vintage, industriales, publicitarios, médicos, de oficio, decorativos, curiosidades y coleccionables. Operás como equipo profesional, sin romanticismo de anticuario.

Comité interno, hablan en una sola voz: Gerente de Comercialización, Experto MLU, Analista IG+MLU, Copy, Storytelling (solo si suma plata), Control de Riesgo.

OBJETIVO: Necesitás vender, generar movimiento en MercadoLibre Uruguay, levantar reputación, recuperar caja. No comprás para tener piezas lindas. Comprás barato para vender realista.

CANALES: MLU (principal), Instagram @amadovintage (solo piezas visuales con relato), Lotes/combos, Venta rápida.

COMISIONES DE REMATE (IVA incluido):
- Castells: × 1,1791
- Bavastro: × 1,1815
- Rematas: × 1,1331
- Zorrilla / Castelar / otra: se informa en el lote

COSTO FIJO MLU (elegí y justificá):
- Chica simple no frágil: $500
- Algo delicada: $600
- Frágil: $700
- Muy frágil: $850
- Pesada o voluminosa: $800

INGRESO DISPONIBLE:
- MLU: Ingreso = PVP_MLU × 0,82 − costo fijo
- IG: Ingreso = PVP_IG × 0,95 − costo fijo (solo si aplica)

TRES NIVELES DE PUJA (calcular SIEMPRE los tres):
1. TECHO (equilibrio): Ingreso / (1 + comisión). Máximo absoluto. No pasar.
2. PUJA MOVIMIENTO (margen 30%): Ingreso / ((1 + comisión) × 1,30). Margen 25% si es muy fácil/chica/simple.
3. PUJA NEGOCIO (margen 60%): Ingreso / ((1 + comisión) × 1,60). Margen 100% si es lenta/dudosa/nicho/pesada/frágil.
Redondear hacia abajo a múltiplo de $50.

CRITERIO DE RECOMENDACIÓN:
- Rotación rápida + fotogénica alta + score alto → Movimiento
- Rotación normal + nicho específico → Negocio
- Rotación lenta o pieza dudosa → Negocio o menos
- Saturación stock similar (2+ sin vender 60d+) → Negocio − 25%
- PVP incierto (<3 comparables) → Negocio − 20% con advertencia

CLASIFICACIÓN: MOVIMIENTO / NEGOCIO / REPUTACIÓN / NEGOCIO + REPUTACIÓN / LOTE-COMBO / DESCARTE
FOTOGRAFIABILIDAD: ALTA / MEDIA / BAJA
ROTACIÓN: RÁPIDA (<30d) / NORMAL (30-90d) / LENTA (>90d) / MUY LENTA (riesgo clavo)
SCORE: ALTO (rotación RÁPIDA + margen ≥60% + riesgo BAJO) / MEDIO (dos de tres) / BAJO (una o ninguna)

REGLAS DURAS:
- No inventés rareza, historia ni demanda.
- No uses precios España/Argentina/eBay como PVP para Uruguay.
- No uses tono anticuario inflado.
- Si es clavo obvio, DESCARTAR.
- Si sirve solo para lote, decilo.
- Sin datos de mercado MLU, aclarar PVP estimado con advertencia.
- Para lotes sin foto: evaluá solo por descripción y avisá que no se vio la pieza.

FORMATO MODO RÁPIDO para cada lote:

--- LOTE [N]: [DESCRIPCIÓN CORTA] ---

1. QUE ES — Una o dos líneas. Material, estado, dudas.

2. DECISION
- Acción: COMPRAR / MIRAR / COMPRAR SOLO BARATO / COMPRAR PARA LOTE / DESCARTAR
- Propósito: MOVIMIENTO / NEGOCIO / REPUTACIÓN / NEGOCIO+REPUTACIÓN / LOTE / DESCARTE
- Canal: MLU / IG / ambos / lote / venta rápida
- Fotografiabilidad: ALTA / MEDIA / BAJA
- Rotación: RÁPIDA / NORMAL / LENTA / MUY LENTA
- Score: ALTO / MEDIO / BAJO

3. MOTIVO — Una línea directa.

4. CALCULO
- PVP MLU estimado / PVP IG (si aplica)
- Costo fijo (justificación corta)
- Comisión remate
- Ingreso disponible

5. NIVELES DE PUJA
- Techo / Puja movimiento / Puja negocio
- Recomendada: $___ (cuál nivel y por qué)

6. TERMINOS PARA VALIDAR EN MLU
3 búsquedas exactas, de específica a general.

7. CIERRE OPERATIVO
Una línea: [ACCIÓN] hasta $___ por [motivo en 5 palabras]

Tono rioplatense (vos, no tú). Plano, sin humo, sin emojis, sin HTML, sin markdown decorativo. Listas con guiones simples.`;

// ── Oxylabs fetch ────────────────────────────────────────────────────────────

async function oxyFetch(url, oxUser, oxPass, geo = "Uruguay") {
  const res = await fetch("https://realtime.oxylabs.io/v1/queries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + btoa(`${oxUser}:${oxPass}`),
    },
    body: JSON.stringify({
      source: "universal",
      url,
      render: "html",
      geo_location: geo,
    }),
  });
  if (!res.ok) throw new Error(`Oxylabs HTTP ${res.status}`);
  const data = await res.json();
  if (data.job?.status !== "done") throw new Error(`Oxylabs job ${data.job?.status}`);
  return data.results?.[0]?.content ?? "";
}

// ── Parser de remotes.com.uy ──────────────────────────────────────────────────

function parseFromNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const root = JSON.parse(m[1]);
    const pp = root?.props?.pageProps;
    const candidates = [
      pp?.remate?.lotes,
      pp?.lotes,
      pp?.items,
      pp?.data?.lotes,
      pp?.data?.items,
      pp?.remate?.items,
    ];
    for (const arr of candidates) {
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((l, i) => ({
          numero: l.numero ?? l.number ?? l.lote ?? l.id ?? i + 1,
          descripcion: l.descripcion ?? l.titulo ?? l.title ?? l.nombre ?? l.name ?? "",
          precio_base_usd: Number(l.precio_base ?? l.base_price ?? l.precio ?? l.price ?? 0),
          precio_actual_usd: Number(l.precio_actual ?? l.current_price ?? l.precio_base ?? l.precio ?? l.price ?? 0),
        }));
      }
    }
    // Try to find any array of objects with a "descripcion" or "titulo" key
    const json = JSON.stringify(root);
    const arrayMatches = [...json.matchAll(/"(?:descripcion|titulo|title)":\s*"([^"]{10,})"/g)];
    if (arrayMatches.length > 3) return null; // fallback to HTML
  } catch { /* fall through */ }
  return null;
}

function parseFromWindowState(html) {
  const patterns = [
    /window\.__(?:INITIAL_STATE|PRELOADED_STATE|APP_STATE|DATA)__\s*=\s*(\{[\s\S]*?\});\s*(?:<\/script>|window\.)/,
    /window\.__STATE__\s*=\s*(\{[\s\S]*?\});/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (!m) continue;
    try {
      const root = JSON.parse(m[1]);
      const json = JSON.stringify(root);
      const lots = [];
      const loteMatches = [...json.matchAll(/"(?:descripcion|titulo)":\s*"([^"]{5,120})"/g)];
      if (loteMatches.length > 2) return null; // too complex, skip
    } catch { /* ignore */ }
  }
  return null;
}

function parseFromHTML(html) {
  const lotes = [];

  // Look for lot sections: patterns like "Lote 1", "Lote N" as headings or labels
  const lotBlocks = [...html.matchAll(/(?:lote|lot)\s*#?\s*(\d+)[^<]*<[^>]*>([^<]{5,200})/gi)];

  // Alternative: look for structured price + description pairs
  const pricePattern = /USD\s*\$?\s*([\d,\.]+)/gi;

  // Extract descriptions near "Lote" keywords
  const textChunks = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const loteMatches = [...textChunks.matchAll(/Lote\s+(\d+)[:\s\-–]+([^\.]{10,200})/gi)];
  const seen = new Set();

  for (const m of loteMatches) {
    const num = parseInt(m[1]);
    const desc = m[2].trim().slice(0, 200);
    if (seen.has(num) || !desc) continue;
    seen.add(num);

    // Look for USD price near this lot mention
    const chunk = textChunks.slice(Math.max(0, m.index - 50), m.index + 300);
    const priceM = chunk.match(/USD\s*\$?\s*([\d,\.]+)/i);
    const precio = priceM ? parseFloat(priceM[1].replace(",", ".")) : 0;

    lotes.push({ numero: num, descripcion: desc, precio_base_usd: precio, precio_actual_usd: precio });
  }

  // If very few lots found, try broader extraction
  if (lotes.length < 3) {
    const broadMatches = [...textChunks.matchAll(/(\d+)\s*[:\-–\.]\s*([A-ZÁÉÍÓÚÑÜ][^\.]{15,150})/g)];
    for (const m of broadMatches.slice(0, 50)) {
      const num = parseInt(m[1]);
      if (num < 1 || num > 500 || seen.has(num)) continue;
      const desc = m[2].trim();
      if (desc.split(" ").length < 3) continue;
      seen.add(num);
      lotes.push({ numero: num, descripcion: desc, precio_base_usd: 0, precio_actual_usd: 0 });
    }
  }

  return lotes.sort((a, b) => a.numero - b.numero);
}

function parseLotes(html) {
  const fromNext = parseFromNextData(html);
  if (fromNext && fromNext.length > 0) return fromNext;

  const fromHTML = parseFromHTML(html);
  if (fromHTML && fromHTML.length > 0) return fromHTML;

  return [];
}

// ── MLU search (igual que tasar.js) ─────────────────────────────────────────

function calcStats(prices) {
  if (!prices.length) return { min: null, max: null, median: null };
  const s = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
  return { min: s[0], max: s[s.length - 1], median };
}

function parseMLUHtml(html, termino) {
  const items = [];
  const starts = [...html.matchAll(/"id":"(MLU\d+)","type":"(?:PRODUCT|ITEM)"/g)];
  for (const s of starts.slice(0, 20)) {
    const chunk = html.slice(s.index, s.index + 8000);
    const titleM = chunk.match(/"title":"([^"]{5,80})"/);
    const priceM = chunk.match(/"price":([\d]+(?:\.\d+)?),"currency_id":"UYU"/);
    if (titleM && priceM) {
      const price = Math.round(Number(priceM[1]));
      if (price > 100) items.push({ titulo: titleM[1], precio: price });
    }
  }
  const seen = new Set();
  const unique = items.filter(i => seen.has(i.titulo) ? false : seen.add(i.titulo));
  const stats = calcStats(unique.map(i => i.precio));
  return {
    termino,
    total: unique.length,
    precio_min: stats.min,
    precio_max: stats.max,
    mediana: stats.median,
    titulos: unique.slice(0, 4),
  };
}

async function searchMLU(termino, oxUser, oxPass) {
  try {
    const slug = termino.trim().replace(/\s+/g, "-").toLowerCase().replace(/[^a-z0-9\-áéíóúñü]/g, "");
    const url = `https://listado.mercadolibre.com.uy/${slug}_Condition_2230581`;
    const html = await oxyFetch(url, oxUser, oxPass);
    return parseMLUHtml(html, termino);
  } catch (e) {
    return { termino, total: 0, error: e.message };
  }
}

// ── Build MLU block for prompt ───────────────────────────────────────────────

function mluBlock(busquedas) {
  if (!busquedas.length) return "MLU: sin búsquedas.";
  return busquedas.map(b => {
    if (b.error) return `"${b.termino}": ERROR — ${b.error}`;
    if (!b.total) return `"${b.termino}": Sin resultados en MLU Uruguay.`;
    const stats = `${b.total} publicaciones | min UYU ${b.precio_min} / max UYU ${b.precio_max} / mediana UYU ${b.mediana}`;
    const items = b.titulos.map(t => `  - ${t.titulo} — UYU ${t.precio}`).join("\n");
    return `"${b.termino}": ${stats}\n${items}`;
  }).join("\n\n");
}

// ── Auto-detect casa from URL ────────────────────────────────────────────────

function detectCasa(url) {
  if (/remotes\.com\.uy/i.test(url)) return "rematas";
  if (/castells/i.test(url)) return "castells";
  if (/bavastro/i.test(url)) return "bavastro";
  return null;
}

// ── Build MLU search terms from lot description ──────────────────────────────

function buildTerminos(descripcion) {
  const cleaned = descripcion
    .replace(/lote\s*\d+/gi, "")
    .replace(/[^\w\s]/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(w => w.length > 3);
  if (!words.length) return [cleaned.slice(0, 50)];
  // Term 1: first 4 words (specific)
  const t1 = words.slice(0, 4).join(" ");
  // Term 2: first 2 words (broader)
  const t2 = words.slice(0, 2).join(" ");
  // Term 3: key noun (first word)
  const t3 = words[0];
  return [...new Set([t1, t2, t3].filter(Boolean))].slice(0, 3);
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const { ANTHROPIC_API_KEY: apiKey, OXYLABS_USER: oxUser, OXYLABS_PASS: oxPass } = env;

  if (!apiKey) return Response.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 500, headers: CORS_HEADERS });
  if (!oxUser || !oxPass) return Response.json({ error: "OXYLABS_USER/PASS no configurados" }, { status: 500, headers: CORS_HEADERS });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400, headers: CORS_HEADERS });
  }

  const { url, casa_remate, tipo_cambio = 43, max_lotes = 30 } = body;

  if (!url) return Response.json({ error: "Se requiere url del remate" }, { status: 400, headers: CORS_HEADERS });

  const casaKey = (casa_remate ?? detectCasa(url) ?? "rematas").toLowerCase();
  const comision = COMISIONES[casaKey] ?? COMISIONES.rematas;
  const casaNombre = casaKey.charAt(0).toUpperCase() + casaKey.slice(1);

  // 1. Scrape remate page
  let html;
  try {
    html = await oxyFetch(url, oxUser, oxPass);
  } catch (e) {
    return Response.json({ error: `No se pudo scrapear el remate: ${e.message}` }, { status: 502, headers: CORS_HEADERS });
  }

  // 2. Parse lots
  let lotes = parseLotes(html);

  if (!lotes.length) {
    return Response.json({
      error: "No se detectaron lotes en la página. El remate puede requerir autenticación o la estructura HTML cambió.",
      html_preview: html.slice(0, 500),
    }, { status: 422, headers: CORS_HEADERS });
  }

  lotes = lotes.slice(0, max_lotes);

  // 3. Search MLU for each lot (parallelized, max 8 concurrent)
  const CONCURRENCY = 8;
  const lotesConMLU = [];

  for (let i = 0; i < lotes.length; i += CONCURRENCY) {
    const batch = lotes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (l) => {
        const terminos = buildTerminos(l.descripcion);
        const busquedas = await Promise.all(terminos.map(t => searchMLU(t, oxUser, oxPass)));
        return { ...l, busquedas };
      })
    );
    lotesConMLU.push(...results);
  }

  // 4. Build prompt with all lots
  const lotesPrompt = lotesConMLU.map(l => {
    const precioInfo = l.precio_actual_usd > 0
      ? `Precio base/actual: USD ${l.precio_actual_usd} (UYU ${Math.round(l.precio_actual_usd * tipo_cambio)} aprox)`
      : "Precio base: no disponible";
    return `=== LOTE ${l.numero} ===\nDescripción: ${l.descripcion}\n${precioInfo}\nCasa: ${casaNombre} (comisión ${(comision * 100).toFixed(2)}%)\nTipo de cambio: USD 1 = UYU ${tipo_cambio}\n\nDatos MLU Uruguay:\n${mluBlock(l.busquedas)}`;
  }).join("\n\n");

  const userMessage = `Evaluá los siguientes lotes del remate ${url} según el criterio Amado Vintage v2.2 Modo Rápido. No hay fotos disponibles; evaluá por descripción y datos MLU. Indicá claramente qué lotes conviene comprar y hasta qué precio.\n\n${lotesPrompt}`;

  // 5. Claude evaluation
  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!apiRes.ok) {
    const err = await apiRes.text();
    return Response.json({ error: `Claude API error ${apiRes.status}: ${err}` }, { status: 502, headers: CORS_HEADERS });
  }

  const claudeData = await apiRes.json();
  const analisis = claudeData?.content?.[0]?.text ?? "";

  return Response.json({
    url,
    casa: casaNombre,
    comision_pct: (comision * 100).toFixed(2),
    tipo_cambio,
    total_lotes: lotes.length,
    lotes_data: lotesConMLU.map(l => ({
      numero: l.numero,
      descripcion: l.descripcion,
      precio_base_usd: l.precio_base_usd,
      mlu_resumen: l.busquedas.map(b => b.total > 0
        ? `${b.total} resultados "${b.termino}" (mediana UYU ${b.mediana})`
        : `0 resultados "${b.termino}"`
      ).join(" | "),
    })),
    analisis,
  }, { headers: CORS_HEADERS });
}
