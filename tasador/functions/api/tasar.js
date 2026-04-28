const SYSTEM_PROMPT = `Sos TASADOR DE LIBROS DE REMATE URUGUAY para Amado Libros / Amado Vintage.
Evaluás si un libro conviene comprarlo para revender en Mercado Libre Uruguay. Criterio comercial puro.

REGLAS:
- No inventes precios ni datos. Si no hay mercado verificable: UYU ? en PVP y margen.
- Usá los datos reales de MLU que te pasan como evidencia primaria.
- Comisión ML: 15%. Envío estimado: UYU 200. Ganancia mínima aceptable: UYU 300.
- No descartes por tema: religión, espiritualidad, autoayuda, historia local, folklore, esoterismo son válidos.
- Penalizá fuerte: humedad, hongos, faltantes, enciclopedia incompleta, manual desactualizado, libro pesado con margen chico.

FORMATO DE SALIDA — exactamente este, sin agregar secciones extra:

TÍTULO: [nombre del libro o descripción del lote]

DECISIÓN: [COMPRA / SOLO SI BAJA / PASO]

NÚMEROS:
PVP: UYU [número o ?]
Margen: UYU [número o ?]
Confianza: [ALTA / MEDIA / BAJA]

POR QUÉ:
+ [razón principal a favor, 1 oración]
- [riesgo principal, 1 oración]

OJO: [observación concreta del librero, 1 oración]

TIP: [cómo publicarlo o fotografiarlo, 1 oración]

TONO: Español rioplatense. Directo. Sin humo. Sin relleno.`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MLU_BOOKS_CATEGORY = "MLU1168";

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
      max_tokens: 150,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          { type: "text", text: 'Identificá este libro o lote. Respondé SOLO con JSON sin markdown: {"titulo":"...","autor":"...","queries":["query1","query2","query3"]} donde queries son 3 búsquedas distintas para encontrarlo en Mercado Libre Uruguay (variar: con autor, sin autor, por tema/colección). Si es un lote, poné el título del libro más valioso visible.' },
        ],
      }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.content?.[0]?.text ?? "";
  try {
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function searchMLU(query) {
  const url = `https://api.mercadolibre.com/sites/MLU/search?q=${encodeURIComponent(query)}&category=${MLU_BOOKS_CATEGORY}&limit=8`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "tasador-amado-libros/1.0" } });
    if (!res.ok) return null;
    const data = await res.json();
    const items = (data.results ?? []).map(item => ({
      titulo: item.title,
      precio: item.price,
      moneda: item.currency_id,
      vendidos: item.sold_quantity ?? 0,
      condicion: item.condition,
      link: item.permalink,
    }));
    return { query, total: data.paging?.total ?? 0, items };
  } catch {
    return null;
  }
}

function formatMLUResults(searches) {
  const valid = searches.filter(Boolean);
  if (valid.length === 0) return "No se obtuvieron resultados de Mercado Libre Uruguay.";

  return valid.map(s => {
    const header = `Búsqueda MLU: "${s.query}" — ${s.total} publicaciones totales`;
    if (s.items.length === 0) return `${header}\nSin resultados.`;
    const lines = s.items.map(i =>
      `  - ${i.titulo} | UYU ${i.precio} | ${i.condicion} | vendidos: ${i.vendidos}`
    ).join("\n");
    return `${header}\n${lines}`;
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

  // accept array (new) or single image (legacy)
  const imageList = images?.length
    ? images.slice(0, 6)
    : (image_base64 && mime_type ? [{ image_base64, mime_type }] : []);

  if (imageList.length === 0) {
    return Response.json({ error: "Se requiere al menos una imagen" }, { status: 400, headers: CORS_HEADERS });
  }

  const { image_base64: firstB64, mime_type: firstMime } = imageList[0];

  // Step 1: identify book + Step 2: search MLU — run identification first, then parallel searches
  const identified = await identifyBook(apiKey, firstB64, firstMime);

  let mluContext = "";
  if (identified?.queries?.length) {
    const searches = await Promise.all(identified.queries.slice(0, 3).map(searchMLU));
    mluContext = formatMLUResults(searches);
  } else {
    mluContext = "No se pudo identificar el libro para buscar en MLU.";
  }

  // Step 3: full analysis with real market data
  const textParts = [
    `DATOS DE MERCADO REALES (Mercado Libre Uruguay — consultado ahora):\n${mluContext}`,
  ];
  if (identified?.titulo) textParts.push(`Título identificado: ${identified.titulo}${identified.autor ? ` — Autor: ${identified.autor}` : ""}`);
  if (contexto) textParts.push(`Contexto adicional: ${contexto}`);
  if (costo) textParts.push(`Costo pagado / estimado: UYU ${costo}`);
  if (pvp) textParts.push(`PVP de referencia sugerido: UYU ${pvp}`);
  textParts.push("Usá los datos de MLU como evidencia primaria para PVP y margen. No inventes precios. Seguí el formato de salida exacto.");

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

  return Response.json({ result }, { headers: CORS_HEADERS });
}
