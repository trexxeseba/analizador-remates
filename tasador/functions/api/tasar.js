const SYSTEM_PROMPT = `Sos el comité de compras de AMADO — operación uruguaya de reventa que cubre dos líneas: AMADO LIBROS (libros importados y usados en MLU) y AMADO VINTAGE (objetos usados, vintage, industriales, publicitarios, médicos y coleccionables en MLU e Instagram).

Recibís una imagen con tipo ya detectado (LIBRO o VINTAGE) y datos reales de MLU Uruguay. Usá esos datos como base. No inventes precios ni comparables.

REGLAS DURAS PARA AMBOS TIPOS:
- Los datos MLU provistos son reales y recientes. Usalos como base principal.
- Si MLU dice "sin comparables": marcá MERCADO NO VERIFICADO y bajá confianza.
- No uses precios de España, Argentina, eBay ni Etsy como base de PVP.
- No inventes rareza, historia, autenticidad, época ni demanda.
- Tono: rioplatense, plano, sin emojis, sin HTML.
- Cierre siempre: Amado Libros (libros) o Amado Vintage (objetos).

CONTEXTO OPERATIVO:
- Canal principal: Mercado Libre Uruguay
- Canal secundario (solo vintage fotogénico): Instagram @amadovintage
- Comisión MLU: 15%
- Envío estimado: UYU 200
- Ganancia mínima libros: UYU 300
- Tope puja vintage NEGOCIO puro: UYU 2000

FÓRMULAS:
- Bmáx MLU = (PVP × 0.84 − 400 − 500) / (1 + comisión_remate)
- Bmáx IG = (PVP × 0.95 − 400 − 500) / (1 + comisión_remate)
- Comisiones: Castells 0.1791 / Bavastro 0.1815 / Rematas 0.1331 / otra: no calcular
- Fragilidad: −15% sobre Bmáx
- Peso/volumen alto: −10% sobre Bmáx

====================
SI TIPO = LIBRO
====================

Criterio: ¿se vende en MLU Uruguay? ¿a qué precio? ¿con qué margen?
No evaluás si el libro es bueno literariamente.

No descartes por: religión, espiritualidad, autoayuda, medicina popular, historia local, folklore, esoterismo, biografías devocionales.
Penalizá fuerte: humedad, hongos, subrayado fuerte, enciclopedia incompleta, manual desactualizado, edición de club saturada.

FORMATO LIBRO:

LIBRO:
[identificación]

MERCADO REAL MLU:
[transcribir los datos MLU provistos: búsquedas, precios, títulos encontrados]

LECTURA RÁPIDA:
- Estado:
- Nicho:
- Rareza local:
- Potencial comercial:
- Riesgo principal:

NÚMEROS:
- PVP probable:
- Costo total estimado:
- Margen estimado:
- Confianza: ALTA / MEDIA / BAJA

DECISIÓN: COMPRA / SOLO SI BAJA / PASO

POR QUÉ:
- Motivo principal:
- Riesgo principal:
- Qué tendría que pasar para mejorar:

OJO LIBRERO:
[observación concreta]

TIP:
[cómo publicarlo o titularlo]

====================
SI TIPO = VINTAGE
====================

Criterio: ¿conviene comprar para revender en Uruguay? ¿MLU, IG o ambos?

No inventés rareza ni historia. Si la pieza no es fotogénica, no la fuerces a IG.
Descartá rápido si: clavo evidente, nicho chico, frágil sin compensación, sin mercado local claro.

FORMATO VINTAGE:

OBJETO:
[identificación, material, estado, época si verificable]

MERCADO REAL MLU:
[transcribir los datos MLU provistos]

DECISIÓN: COMPRAR / MIRAR / DESCARTAR
- Propósito: NEGOCIO / REPUTACIÓN / NEGOCIO+REPUTACIÓN
- Canal: MLU / IG / AMBOS
- Fotografiabilidad: ALTA / MEDIA / BAJA
- Motivo en una línea

PUNTAJES (1-10):
- Rotación:
- Margen:
- Logística:
- Visual:
- Promedio ponderado:

NÚMEROS:
- PVP_MLU:
- PVP_IG:
- Bmáx calculado:
- Tope de puja recomendado:
- Confianza: ALTA / MEDIA / BAJA

RIESGO PRINCIPAL:
[uno solo, una línea]

INTERVENCIÓN:
[NO TOCAR / LIMPIEZA MÍNIMA / RESTAURACIÓN COMERCIAL]

CIERRE COMERCIAL:
- Título MLU (máx 60 caracteres):
- Argumento MLU:
- Copy IG (si aplica):`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function calcStats(prices) {
  if (!prices.length) return { min: null, max: null, median: null };
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
  return { min: sorted[0], max: sorted[sorted.length - 1], median };
}

async function searchMLU(termino) {
  const url = `https://api.mercadolibre.com/sites/MLU/search?q=${encodeURIComponent(termino)}&limit=10`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { termino, error: `HTTP ${res.status}`, total: 0, titulos: [], stats: {} };
    const data = await res.json();
    const results = data.results ?? [];
    const titulos = results.slice(0, 5).map(i => ({
      titulo: i.title,
      precio: i.price,
      condicion: i.condition === "new" ? "nuevo" : "usado",
    }));
    const prices = results.map(i => i.price).filter(p => p > 0);
    const stats = calcStats(prices);
    return {
      termino,
      total: data.paging?.total ?? 0,
      precio_min: stats.min,
      precio_max: stats.max,
      mediana: stats.median,
      titulos,
    };
  } catch (e) {
    return { termino, error: e.message, total: 0, titulos: [], stats: {} };
  }
}

function buildMLUPromptBlock(busquedas) {
  if (!busquedas.length) return "MLU: sin búsquedas realizadas.";
  const lines = busquedas.map(b => {
    if (b.error || b.total === 0) return `"${b.termino}": Sin resultados en MLU Uruguay.`;
    const statsLine = b.mediana != null
      ? `${b.total} publicaciones | min UYU ${b.precio_min} / max UYU ${b.precio_max} / mediana UYU ${b.mediana}`
      : `${b.total} publicaciones`;
    const items = b.titulos.map(t => `  · ${t.titulo} — UYU ${t.precio} (${t.condicion})`).join("\n");
    return `"${b.termino}": ${statsLine}\n${items}`;
  });
  return lines.join("\n\n");
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

  const { images, image_base64, mime_type, tipo, titulo, terminos_busqueda, contexto, costo, pvp } = body;

  const imageList = images?.length
    ? images.slice(0, 6)
    : (image_base64 && mime_type ? [{ image_base64, mime_type }] : []);

  if (imageList.length === 0) {
    return Response.json({ error: "Se requiere al menos una imagen" }, { status: 400, headers: CORS_HEADERS });
  }

  // ── MLU searches in parallel ──
  const terminos = Array.isArray(terminos_busqueda) ? terminos_busqueda.filter(Boolean).slice(0, 3) : [];
  if (terminos.length === 0 && contexto) terminos.push(contexto.slice(0, 60));

  const busquedas = terminos.length > 0 ? await Promise.all(terminos.map(searchMLU)) : [];

  const mluBlock = buildMLUPromptBlock(busquedas);
  const mluResumen = busquedas.every(b => b.total === 0 || b.error)
    ? "Sin comparables en MLU Uruguay"
    : busquedas.map(b => b.total > 0 ? `${b.total} resultados para "${b.termino}" (mediana UYU ${b.mediana ?? '?'})` : `0 resultados para "${b.termino}"`).join(" | ");

  // ── Build user message ──
  const textParts = [
    `TIPO DETECTADO: ${tipo ?? "LIBRO"}`,
    `OBJETO: ${titulo ?? "no identificado"}`,
    `\nDATOS MLU REALES (no inventar nada fuera de esto):\n${mluBlock}`,
    `\nDATOS DEL USUARIO:\n- Costo estimado: ${costo ? `UYU ${costo}` : "no informado"}\n- PVP referencia: ${pvp ? `UYU ${pvp}` : "no informado"}\n- Contexto adicional: ${contexto || "ninguno"}`,
    `\nTasá esta pieza siguiendo el system prompt correspondiente a su tipo.`,
  ];

  const userContent = [
    ...imageList.map(img => ({
      type: "image",
      source: { type: "base64", media_type: img.mime_type, data: img.image_base64 },
    })),
    { type: "text", text: textParts.join("\n") },
  ];

  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
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

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    return Response.json({ error: `API error ${apiRes.status}: ${errText}` }, { status: 502, headers: CORS_HEADERS });
  }

  const data = await apiRes.json();
  const result = data?.content?.[0]?.text ?? "";

  const mlu_data = {
    busquedas,
    resumen: mluResumen,
  };

  return Response.json({ result, mlu_data }, { headers: CORS_HEADERS });
}
