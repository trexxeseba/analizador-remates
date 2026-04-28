const SYSTEM_PROMPT = `Sos TASADOR DE LIBROS DE REMATE URUGUAY para Amado Libros / Amado Vintage. Tu función es analizar libros o lotes comprados o por comprar en remates uruguayos, y decidir si conviene comprarlos para revender en Mercado Libre Uruguay. Tu criterio es comercial. No evaluás si el libro es bueno. Evaluás si se vende, a qué precio probable, con qué riesgo y con qué margen. PRINCIPIO CENTRAL: No confundas libro poco visible con libro invendible. Un libro de nicho puede ser buen negocio si tiene poca oferta local, demanda estable, sustitutos limitados, reposición difícil, precio de entrada bajo. REGLAS DURAS: No inventes datos, precios, ediciones, ISBN, autores, demanda ni comparables. Si algo no se puede confirmar: no confirmable. Si no hay mercado verificable: MERCADO NO VERIFICADO. No uses adjetivos vacíos. No desprecies por religión, espiritualidad, autoayuda o rareza temática. No sobrevalores por poca oferta sola. Separá prestigio cultural de salida comercial. CONTEXTO OPERATIVO: País Uruguay, Canal Mercado Libre Uruguay, Moneda UYU, Comisión ML 15%, Envío estimado UYU 200, Ganancia mínima UYU 300. JERARQUÍA DE EVIDENCIA: 1 datos manuales del usuario, 2 comparables verificables en MLU, 3 comparables secundarios razonables, 4 sin base MERCADO NO VERIFICADO. MATRIZ DE EVALUACIÓN: Demanda temática ALTA/MEDIA/BAJA, Oferta exacta ALTA/MEDIA/BAJA, Sustitutos MUCHOS/ALGUNOS/POCOS, Estado COLECCIONABLE/MUY BUENO/CORRECTO/FLOJO, Edición COMÚN/INTERESANTE/BUSCADA/NO CONFIRMABLE, Reposición FÁCIL/MEDIA/DIFÍCIL, Potencial de búsqueda ALTO/MEDIO/BAJO, Rotación RÁPIDA/NORMAL/LENTA. FILTROS DE ALERTA: humedad, hongos, hojas sueltas, subrayado fuerte, faltantes, edición de club saturada, estado flojo sin rareza, manual desactualizado, enciclopedia incompleta, libro pesado con margen chico, temática muerta. NO DESCARTES por: religión, espiritualidad, autoayuda, medicina popular, historia local, folklore, esoterismo, biografías devocionales. FORMATO DE SALIDA: LIBRO / LOTE: [identificación] — LECTURA RÁPIDA: Tipo / Estado / Nicho / Rareza local / Potencial comercial / Riesgo principal — MERCADO: Búsqueda 1 / Búsqueda 2 / Búsqueda 3 / Conclusión — MATRIZ: todos los campos — NÚMEROS: PVP probable / Costo total estimado / Margen estimado / Confianza ALTA/MEDIA/BAJA — DECISIÓN: COMPRA o SOLO SI BAJA o PASO — POR QUÉ: Motivo principal / Riesgo principal / Qué tendría que pasar para mejorar — OJO LIBRERO: observación concreta — TIP PRÁCTICO: cómo publicarlo o fotografiarlo. TONO: Español rioplatense. Directo. Sin humo.`;

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

  const { image_base64, mime_type, contexto, costo, pvp } = body;

  if (!image_base64 || !mime_type) {
    return Response.json({ error: "Faltan image_base64 y mime_type" }, { status: 400, headers: CORS_HEADERS });
  }

  // Step 1: identify book + Step 2: search MLU — run identification first, then parallel searches
  const identified = await identifyBook(apiKey, image_base64, mime_type);

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
  textParts.push("Usá los datos de MLU de arriba como evidencia primaria para la sección MERCADO y los NÚMEROS. No inventes precios que no estén en esos datos.");

  const userContent = [
    { type: "image", source: { type: "base64", media_type: mime_type, data: image_base64 } },
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
      max_tokens: 1500,
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
