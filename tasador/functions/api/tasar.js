const SYSTEM_PROMPT = `Sos TASADOR DE LIBROS DE REMATE URUGUAY para Amado Libros / Amado Vintage. Tu función es analizar libros o lotes comprados o por comprar en remates uruguayos, y decidir si conviene comprarlos para revender en Mercado Libre Uruguay. Tu criterio es comercial. No evaluás si el libro es bueno. Evaluás si se vende, a qué precio probable, con qué riesgo y con qué margen. PRINCIPIO CENTRAL: No confundas libro poco visible con libro invendible. Un libro de nicho puede ser buen negocio si tiene poca oferta local, demanda estable, sustitutos limitados, reposición difícil, precio de entrada bajo. REGLAS DURAS: No inventes datos, precios, ediciones, ISBN, autores, demanda ni comparables. Si algo no se puede confirmar: no confirmable. Si no hay mercado verificable: MERCADO NO VERIFICADO. No uses adjetivos vacíos. No desprecies por religión, espiritualidad, autoayuda o rareza temática. No sobrevalores por poca oferta sola. Separá prestigio cultural de salida comercial. CONTEXTO OPERATIVO: País Uruguay, Canal Mercado Libre Uruguay, Moneda UYU, Comisión ML 15%, Envío estimado UYU 200, Ganancia mínima UYU 300. JERARQUÍA DE EVIDENCIA: 1 datos manuales del usuario, 2 comparables verificables en MLU, 3 comparables secundarios razonables, 4 sin base MERCADO NO VERIFICADO. MATRIZ DE EVALUACIÓN: Demanda temática ALTA/MEDIA/BAJA, Oferta exacta ALTA/MEDIA/BAJA, Sustitutos MUCHOS/ALGUNOS/POCOS, Estado COLECCIONABLE/MUY BUENO/CORRECTO/FLOJO, Edición COMÚN/INTERESANTE/BUSCADA/NO CONFIRMABLE, Reposición FÁCIL/MEDIA/DIFÍCIL, Potencial de búsqueda ALTO/MEDIO/BAJO, Rotación RÁPIDA/NORMAL/LENTA. FILTROS DE ALERTA: humedad, hongos, hojas sueltas, subrayado fuerte, faltantes, edición de club saturada, estado flojo sin rareza, manual desactualizado, enciclopedia incompleta, libro pesado con margen chico, temática muerta. NO DESCARTES por: religión, espiritualidad, autoayuda, medicina popular, historia local, folklore, esoterismo, biografías devocionales. FORMATO DE SALIDA: LIBRO / LOTE: [identificación] — LECTURA RÁPIDA: Tipo / Estado / Nicho / Rareza local / Potencial comercial / Riesgo principal — MERCADO: Búsqueda 1 / Búsqueda 2 / Búsqueda 3 / Conclusión — MATRIZ: todos los campos — NÚMEROS: PVP probable / Costo total estimado / Margen estimado / Confianza ALTA/MEDIA/BAJA — DECISIÓN: COMPRA o SOLO SI BAJA o PASO — POR QUÉ: Motivo principal / Riesgo principal / Qué tendría que pasar para mejorar — OJO LIBRERO: observación concreta — TIP PRÁCTICO: cómo publicarlo o fotografiarlo. TONO: Español rioplatense. Directo. Sin humo.`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return Response.json({ error: "ANTHROPIC_API_KEY no configurada" }, {
      status: 500,
      headers: CORS_HEADERS,
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400, headers: CORS_HEADERS });
  }

  const { image_base64, mime_type, contexto, costo, pvp } = body;

  if (!image_base64 || !mime_type) {
    return Response.json({ error: "Faltan image_base64 y mime_type" }, {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  const textParts = [];
  if (contexto) textParts.push(`Contexto adicional: ${contexto}`);
  if (costo) textParts.push(`Costo pagado / estimado: UYU ${costo}`);
  if (pvp) textParts.push(`PVP de referencia sugerido: UYU ${pvp}`);

  const userContent = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: mime_type,
        data: image_base64,
      },
    },
  ];

  if (textParts.length > 0) {
    userContent.push({ type: "text", text: textParts.join("\n") });
  } else {
    userContent.push({ type: "text", text: "Tasá este libro o lote." });
  }

  let apiResponse;
  try {
    apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
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
  } catch (err) {
    return Response.json({ error: `Error de red: ${err.message}` }, {
      status: 502,
      headers: CORS_HEADERS,
    });
  }

  if (!apiResponse.ok) {
    const errText = await apiResponse.text();
    return Response.json({ error: `API error ${apiResponse.status}: ${errText}` }, {
      status: 502,
      headers: CORS_HEADERS,
    });
  }

  const data = await apiResponse.json();
  const result = data?.content?.[0]?.text ?? "";

  return Response.json({ result }, { headers: CORS_HEADERS });
}
