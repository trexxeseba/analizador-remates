const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SYSTEM = `Leé exactamente el texto visible en la imagen. No inventes ni inferás nada que no esté escrito. Devolvé ÚNICAMENTE JSON válido sin markdown ni texto extra:
{"tipo":"LIBRO" o "VINTAGE","titulo":"texto exacto del título visible","autor":"texto exacto del autor si está visible o null","terminos_busqueda":["término1","término2","término3"],"casa_remate":null}
Para terminos_busqueda usá palabras reales del título y autor visibles, no descripciones.
Para libros: poné el título exacto y el autor exacto como términos.
Para vintage: poné el texto visible en el objeto, material y función observable.
Si hay poco texto visible, poné solo lo que se lee claramente.`;

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

  const { images, image_base64, mime_type, contexto } = body;

  const imageList = images?.length
    ? images.slice(0, 6)
    : (image_base64 && mime_type ? [{ image_base64, mime_type }] : []);

  if (imageList.length === 0) {
    return Response.json({ error: "Se requiere al menos una imagen" }, { status: 400, headers: CORS_HEADERS });
  }

  const { image_base64: firstB64, mime_type: firstMime } = imageList[0];

  const userParts = [
    { type: "image", source: { type: "base64", media_type: firstMime, data: firstB64 } },
    { type: "text", text: contexto ? `Identificá este objeto. Contexto: ${contexto}` : "Identificá este objeto." },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: SYSTEM,
      messages: [{ role: "user", content: userParts }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return Response.json({ error: `API error ${res.status}: ${err}` }, { status: 502, headers: CORS_HEADERS });
  }

  const data = await res.json();
  const raw = data?.content?.[0]?.text ?? "";

  let identified = {
    tipo: "LIBRO",
    titulo: "Objeto no identificado",
    terminos_busqueda: [],
    casa_remate: null,
  };
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) identified = { ...identified, ...JSON.parse(match[0]) };
  } catch { /* use defaults */ }

  return Response.json(identified, { headers: CORS_HEADERS });
}
