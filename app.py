import streamlit as st
import pandas as pd
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse, parse_qs, urlencode, urlunparse
import re
import time

# --- LÓGICA ---

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "es-UY,es;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.remotes.com.uy/",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

STOPWORDS_LIBROS = {
    "lote", "libro", "libros", "coleccion", "colección", "tomo", "tomos",
    "edicion", "edición", "editorial", "ed", "vol", "volumen", "impreso",
    "buenos", "aires", "madrid", "barcelona", "uruguay", "arg", "uru",
    "usado", "buen", "estado", "original", "primera", "segunda", "usd", "uyu",
    "the", "and", "los", "las", "del", "que", "una", "con", "por", "para",
}


def _make_session(ox_user="", ox_pass=""):
    session = requests.Session()
    session.headers.update(BROWSER_HEADERS)
    if ox_user and ox_pass:
        session.proxies = {
            "http": f"http://{ox_user}:{ox_pass}@pr.oxylabs.io:7777",
            "https": f"http://{ox_user}:{ox_pass}@pr.oxylabs.io:7777",
        }
    return session


def build_ml_query(desc):
    if not desc:
        return ""
    text = re.sub(r'(?i)^\s*lote\s*\d+[\s\-:]*', '', desc)
    parts = re.split(r'\s*[-–—/]\s*', text)
    parts = [p.strip() for p in parts if p.strip()]

    title, author = "", ""
    for part in parts:
        if re.search(r'\b[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]+,\s*[A-ZÁÉÍÓÚÑÜ]', part):
            author = part
        elif not title and len(part) > 4:
            title = part

    if title and author:
        author_clean = re.sub(r',', '', author).strip()
        query = f"{title} {author_clean}"
    elif title:
        query = title
    else:
        words = [w for w in re.sub(r'[^\w\s]', ' ', text).split()
                 if len(w) > 3 and w.lower() not in STOPWORDS_LIBROS]
        query = " ".join(words[:6])

    return re.sub(r'\s+', ' ', query).strip()[:100]


@st.cache_data(ttl=3600)
def ml_search_uy(query):
    url = (
        f"https://api.mercadolibre.com/sites/MLU/search"
        f"?q={query.replace(' ', '%20')}&category=MLU1202&limit=15"
    )
    try:
        resp = requests.get(url, timeout=7)
        results = resp.json().get("results", [])
        precios = [r["price"] for r in results if r.get("price")]
        if not precios:
            return {"total": 0, "median": None}
        return {"total": len(precios), "median": sorted(precios)[len(precios) // 2]}
    except Exception:
        return {"total": 0, "median": None}


def _parse_lot_item(element, idx):
    text = element.get_text(separator=" ").strip()
    text = re.sub(r'\s+', ' ', text)

    num_match = re.search(r'(?i)lote\s*(\d+)', text)
    lote_num = int(num_match.group(1)) if num_match else idx

    precio_match = re.search(r'(?:USD|U\$S|U\$)\s*[\$]?\s*(\d[\d.,]*)', text, re.I)
    if not precio_match:
        precio_match = re.search(r'\$[Uu]?\s*(\d[\d.,]*)', text)
    if precio_match:
        raw = precio_match.group(1).replace('.', '').replace(',', '.')
        try:
            precio_usd = float(raw)
        except ValueError:
            precio_usd = 10.0
    else:
        precio_usd = 10.0

    desc = re.sub(r'(?i)lote\s*\d+', '', text)
    desc = re.sub(r'(?:USD|U\$S|U\$|UYU|\$[Uu]?)\s*[\d.,]+', '', desc)
    desc = re.sub(r'\s{2,}', ' ', desc).strip()[:200]

    return lote_num, desc, precio_usd


def _parse_page_lotes(soup, page_offset=0):
    lotes = []

    # Estrategia A: atributos específicos
    items = soup.select("[data-lote], [id^='lote-'], tr.lote, .lote-item, .lot-item")

    # Estrategia B: clase substring
    if not items:
        items = soup.find_all("div", class_=re.compile(r"lote|item|card|lot", re.I))

    # Estrategia C: elementos que contienen "Lote N" → subir al padre
    if not items:
        anchors = soup.find_all(string=re.compile(r'(?i)Lote\s*\d+'))
        parents = []
        for a in anchors:
            p = a.parent
            if p and p not in parents:
                parents.append(p)
        items = parents

    for i, item in enumerate(items):
        text = item.get_text(separator=" ").strip()
        if len(text) < 20:
            continue
        lote_num, desc, precio_usd = _parse_lot_item(item, page_offset + i + 1)
        if desc:
            lotes.append({
                "lote": lote_num,
                "descripcion": desc,
                "precio_salida_usd": precio_usd,
            })

    # Estrategia D: fallback texto completo
    if not lotes:
        full_text = soup.get_text(separator="\n")
        for line in full_text.split("\n"):
            line = line.strip()
            if re.search(r'(?i)Lote\s*\d+', line) and len(line) > 20:
                num_match = re.search(r'(?i)Lote\s*(\d+)', line)
                lote_num = int(num_match.group(1)) if num_match else len(lotes) + 1
                precio_match = re.search(r'(?:USD|U\$S|U\$|\$[Uu]?)\s*(\d[\d.,]*)', line, re.I)
                precio_usd = float(precio_match.group(1).replace(',', '')) if precio_match else 10.0
                lotes.append({
                    "lote": lote_num,
                    "descripcion": line[:200],
                    "precio_salida_usd": precio_usd,
                })

    return lotes


def _find_next_page_url(soup, current_url):
    next_texts = {"siguiente", "next", ">", "»", "›"}
    for a in soup.find_all("a", href=True):
        text = a.get_text(strip=True).lower()
        href = a["href"]
        if text in next_texts or re.search(r'[?&]p(?:age|agina)?=\d+', href):
            full = urljoin(current_url, href)
            if full != current_url:
                return full

    parsed = urlparse(current_url)
    qs = parse_qs(parsed.query)
    for param in ("page", "pagina", "p"):
        if param in qs:
            try:
                next_val = int(qs[param][0]) + 1
                qs[param] = [str(next_val)]
                new_query = urlencode({k: v[0] for k, v in qs.items()})
                return urlunparse(parsed._replace(query=new_query))
            except ValueError:
                pass
    return None


def extract_remotes_lotes(url, ox_user="", ox_pass="", status_placeholder=None):
    session = _make_session(ox_user, ox_pass)

    try:
        session.get("https://www.remotes.com.uy/", timeout=10)
        time.sleep(1.5)
    except Exception:
        pass

    all_lotes = []
    seen_descs = set()
    current_url = url
    page_num = 0
    MAX_PAGES = 20

    while current_url and page_num < MAX_PAGES:
        page_num += 1
        if status_placeholder:
            status_placeholder.info(f"Escaneando página {page_num}...")

        try:
            r = session.get(current_url, timeout=15)
        except Exception as e:
            if status_placeholder:
                status_placeholder.error(f"Error de red en página {page_num}: {e}")
            break

        if r.status_code != 200:
            if status_placeholder:
                status_placeholder.error(
                    f"HTTP {r.status_code} en página {page_num}. "
                    "Verificá las credenciales de Oxylabs o si el remate sigue activo."
                )
            break

        soup = BeautifulSoup(r.text, "lxml")
        page_lotes = _parse_page_lotes(soup, page_offset=len(all_lotes))

        new_lotes = [l for l in page_lotes if l["descripcion"][:50] not in seen_descs]
        if not new_lotes:
            break

        for l in new_lotes:
            seen_descs.add(l["descripcion"][:50])
        all_lotes.extend(new_lotes)

        next_url = _find_next_page_url(soup, current_url)
        if next_url:
            current_url = next_url
            time.sleep(1.0)
        else:
            break

    return all_lotes, page_num


# --- INTERFAZ STREAMLIT ---

st.set_page_config(page_title="Amado Libros - Analizador", page_icon="📚", layout="wide")
st.title("🔨 Analizador de Arbitraje: Remotes → ML Uruguay")

with st.sidebar:
    st.header("⚙️ Configuración")
    comision = st.number_input("Comisión Rematador (%)", value=18.0) / 100
    tipo_cambio = st.number_input("Tipo de Cambio (USD/UYU)", value=40.0)
    costo_fijo = st.number_input("Logística por Lote (UYU)", value=200)

    st.divider()
    st.subheader("🔐 Proxy Oxylabs")
    ox_user = st.text_input("Usuario", value="", type="password")
    ox_pass = st.text_input("Contraseña", value="", type="password")

url_input = st.text_input("🔗 URL del Remate (ej: remotes.com.uy/participar/remate/6480)")

if st.button("🚀 Analizar Lotes"):
    if not url_input:
        st.info("Por favor, ingresá la URL de un remate activo.")
    else:
        url = url_input.strip()
        if not url.startswith("http"):
            url = "https://" + url

        fase1 = st.empty()
        lotes, paginas = extract_remotes_lotes(url, ox_user=ox_user, ox_pass=ox_pass, status_placeholder=fase1)

        if not lotes:
            fase1.warning("No se detectaron lotes. Revisá la URL, las credenciales de Oxylabs o si el remate sigue activo.")
        else:
            fase1.success(f"Extracción completa: **{len(lotes)} lotes** encontrados en {paginas} página(s).")

            resultados = []
            progreso = st.progress(0)
            estado_ml = st.empty()

            for i, l in enumerate(lotes):
                query = build_ml_query(l["descripcion"])
                estado_ml.caption(f"Buscando en ML: {query[:60]}...")
                ml_data = ml_search_uy(query)

                precio_base_uyu = l["precio_salida_usd"] * tipo_cambio
                costo_estimado = (precio_base_uyu * 1.3 * (1 + comision)) + costo_fijo
                mediana_ml = ml_data["median"] if ml_data["median"] else 0
                margen = mediana_ml - costo_estimado

                l["Costo Total (UYU)"] = round(costo_estimado)
                l["Precio ML (UYU)"] = round(mediana_ml)
                l["Margen Est."] = round(margen)
                l["Query ML"] = query

                if mediana_ml > (costo_estimado * 1.6):
                    l["Acción"] = "✅ COMPRAR"
                elif mediana_ml > costo_estimado:
                    l["Acción"] = "🎲 ESPECULAR"
                else:
                    l["Acción"] = "❌ PASAR"

                resultados.append(l)
                progreso.progress((i + 1) / len(lotes))
                time.sleep(0.15)

            estado_ml.empty()
            progreso.empty()

            df = pd.DataFrame(resultados)

            c1, c2, c3 = st.columns(3)
            c1.metric("✅ Oportunidades", len(df[df.Acción == "✅ COMPRAR"]))
            c2.metric("🎲 Para Especular", len(df[df.Acción == "🎲 ESPECULAR"]))
            c3.metric("❌ Descartados", len(df[df.Acción == "❌ PASAR"]))

            cols_show = ["lote", "descripcion", "precio_salida_usd", "Costo Total (UYU)",
                         "Precio ML (UYU)", "Margen Est.", "Acción", "Query ML"]
            cols_show = [c for c in cols_show if c in df.columns]
            st.dataframe(df[cols_show].sort_values("Margen Est.", ascending=False), use_container_width=True)
