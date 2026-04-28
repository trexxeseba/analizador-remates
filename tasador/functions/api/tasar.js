const SYSTEM_PROMPT = `Sos TASADOR DE LIBROS DE REMATE URUGUAY para Amado Libros / Amado Vintage.
Evaluás si un libro conviene comprarlo para revender en Mercado Libre Uruguay. Criterio comercial puro.

REGLAS CRÍTICAS:
- Los datos de MLU que te pasan son REALES y ACTUALES — usalos como única fuente de precios.
- Si el bloque MLU dice "Sin resultados" o total=0: poné UYU ? en PVP y margen, Confianza: BAJA.
- NUNCA inventes precios. Si no hay datos verificables, decilo explícitamente.
- Comisión ML: 15%. Envío estimado: UYU 200. Ganancia mínima aceptable: UYU 300.
- No descartes por tema: religión, autoayuda, historia local, folklore, esoterismo son válidos.
- Penalizá fuerte: humedad, hongos, faltantes, enciclopedia incompleta, manual desactualizado.
- Para calcular PVP usá la mediana de MLU si hay datos. Para margen: PVP × 0.85 − 200 − costo.

FORMATO DE SALIDA — exactamente este, sin agregar ni quitar secciones:

TÍTULO: [nombre del libro o descripción del lote]

DECISIÓN: [COMPRA / SOLO SI BAJA / PASO]

NÚMEROS:
PVP: UYU [número basado en mediana MLU, o ?]
Margen: UYU [número calculado, o ?]
Confianza: [ALTA / MEDIA / BAJA]

POR QUÉ:
+ [razón principal a favor, 1 oración]
- [riesgo principal, 1 oración]

OJO: [observación concreta del librero, 1 oración]

TIP: [cómo publicarlo o fotografiarlo, 1 oración]

TONO: Español rioplatense. Directo. Sin humo.`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function identifyBook(apiKey, imageBase64, mimeType) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          {
            type: "text",
            text: 'Identificá este libro. Respondé ÚNICAMENTE con JSON válido (sin markdown, sin texto extra): {"titulo":"...","autor":"...","queries":["q1","q2","q3"]} — queries: 3 términos de búsqueda distintos para MLU Uruguay (1: título+autor corto, 2: solo título, 3: tema/género). Si es lote, usá el libro más valioso visible.',
          },
        ],
      }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const raw = data?.content?.[0]?.text ?? "";
  try {
    // strip any markdown fences or leading/trailing text
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    return null;
  }
}

function calcStats(prices) {
  if (!prices.length) return { min: null, max: null, median: null };
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
  return { min: sorted[0], max: sorted[sorted.length - 1], median };
}

async function searchMLU(query) {
  // No category filter — more permissive, catches more listings
  const url = `https://api.mercadolibre.com/sites/MLU/search?q=${encodeURIComponent(query)}&limit=10`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { query, error: `HTTP ${res.status}`, total: 0, items: [], stats: {} };
    const data = await res.json();
    const items = (data.results ?? []).slice(0, 5).map(item => ({
      titulo: item.title,
      precio: item.price,
      condicion: item.condition === "new" ? "nuevo" : "usado",
      vendidos: item.sold_quantity ?? 0,
    }));
    const allPrices = (data.results ?? []).map(i => i.price).filter(p => p > 0);
    const stats = calcStats(allPrices);
    return { query, total: data.paging?.total ?? 0, items, stats };
  } catch (e) {
    return { query, error: e.message, total: 0, items: [], stats: {} };
  }
}

function buildMLUPromptBlock(searches) {
  if (!searches.length) return "MLU: sin búsquedas realizadas.";
  return searches.map(s => {
    if (s.error) return `MLU "${s.query}": error (${s.error})`;
    if (s.total === 0) return `MLU "${s.query}": Sin resultados.`;
    const { min, max, median } = s.stats;
    const statsLine = min != null
      ? `Precios: mín UYU ${min} / máx UYU ${max} / mediana UYU ${median}`
      : "Sin precios disponibles";
    const titles = s.items.map(i => `  • ${i.titulo} — UYU ${i.precio} (${i.condicion})`).join("\n");
    return `MLU "${s.query}": ${s.total} publicaciones. ${statsLine}\n${titles}`;
  }).join("\n\n");
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return Response.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 500, headers: CORS_HEADERS });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400, headers: CORS_HEADERS });
  }

  const { images, image_base64, mime_type, contexto, costo, pvp } = body;

  const imageList = images?.length
    ? images.slice(0, 6)
    : (image_base64 && mime_type ? [{ image_base64, mime_type }] : []);

  if (imageList.length === 0) {
    return Response.json({ error: "Se requiere al menos una imagen" }, { status: 400, headers: CORS_HEADERS });
  }

  const { image_base64: firstB64, mime_type: firstMime } = imageList[0];

  // ── Step 1: identify ──
  const identified = await identifyBook(apiKey, firstB64, firstMime);

  // ── Step 2: search MLU in parallel ──
  let mluSearches = [];
  const queries = identified?.queries?.filter(Boolean).slice(0, 3) ?? [];

  // fallback: use contexto as last-resort query
  if (queries.length === 0 && contexto) queries.push(contexto.slice(0, 60));

  if (queries.length > 0) {
    mluSearches = await Promise.all(queries.map(searchMLU));
  }

  // ── Step 3: build prompt and call Sonnet ──
  const mluBlock = buildMLUPromptBlock(mluSearches);

  const textParts = [
    `=== DATOS REALES DE MERCADO LIBRE URUGUAY (consultado ahora) ===\n${mluBlock}\n=== FIN DATOS MLU ===`,
  ];
  if (identified?.titulo) {
    textParts.push(`Libro identificado: ${identified.titulo}${identified.autor ? ` — ${identified.autor}` : ""}`);
  }
  if (contexto) textParts.push(`Contexto del usuario: ${contexto}`);
  if (costo)    textParts.push(`Costo pagado/estimado: UYU ${costo}`);
  if (pvp)      textParts.push(`PVP sugerido por usuario: UYU ${pvp}`);
  textParts.push("Usá EXCLUSIVAMENTE los datos de MLU de arriba para fundamentar PVP y margen. Si no hay datos: UYU ?");

  const userContent = [
    ...imageList.map(img => ({
      type: "image",
      source: { type: "base64", media_type: img.mime_type, data: img.image_base64 },
    })),
    { type: "text", text: textParts.join("\n\n") },
  ];

  const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!apiResponse.ok) {
    const errText = await apiResponse.text();
    return Response.json({ error: `API error ${apiResponse.status}: ${errText}` }, { status: 502, headers: CORS_HEADERS });
  }

  const data = await apiResponse.json();
  const result = data?.content?.[0]?.text ?? "";

  // Return MLU data alongside result so frontend can display it
  return Response.json({ result, mlu: mluSearches }, { headers: CORS_HEADERS });
}
