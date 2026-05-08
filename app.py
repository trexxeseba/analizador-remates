import streamlit as st
import pandas as pd
import requests
from bs4 import BeautifulSoup
import re
import time
import json

# --- CONFIGURACIÓN Y LÓGICA ---

def build_ml_query(desc):
    if not desc: return ""
    # Quitamos 'Lote X' y caracteres especiales
    query = re.sub(r'(?i)Lote\s*\d+', '', desc)
    query = re.sub(r'[^\w\s]', ' ', query)
    palabras = [p for p in query.split() if len(p) > 2]
    return " ".join(palabras[:5])

@st.cache_data(ttl=3600)
def ml_search_uy(query):
    url = f"https://api.mercadolibre.com/sites/MLU/search?q={query.replace(' ', '%20')}&limit=15"
    try:
        resp = requests.get(url, timeout=7)
        results = resp.json().get("results", [])
        precios = [r["price"] for r in results if r.get("price")]
        if not precios: return {"total": 0, "median": None}
        return {"total": len(precios), "median": sorted(precios)[len(precios)//2]}
    except:
        return {"total": 0, "median": None}

def extract_remotes_lotes(url):
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        r = requests.get(url, headers=headers, timeout=15)
        soup = BeautifulSoup(r.text, 'lxml')
        lotes_data = []

        # Selector mejorado para Remotes.com.uy
        items = soup.find_all("div", class_=re.compile("lote|item|card", re.I))
        
        for i, item in enumerate(items):
            texto = item.get_text(separator=" ").strip()
            # Buscamos patrones de "Lote" seguidos de texto
            if "Lote" in texto and len(texto) > 40:
                # Extraer precio base en USD
                precio_match = re.search(r'USD\s*(\d+)', texto)
                precio_usd = float(precio_match.group(1)) if precio_match else 10.0
                
                # Limpiar descripción (tomar solo la parte relevante)
                desc_limpia = texto.replace("\n", " ").strip()[:150]
                
                lotes_data.append({
                    "lote": len(lotes_data) + 1,
                    "descripcion": desc_limpia,
                    "precio_salida_usd": precio_usd
                })
        
        # Eliminar duplicados si los hay
        seen = set()
        lotes_finales = []
        for l in lotes_data:
            if l["descripcion"][:50] not in seen:
                seen.add(l["descripcion"][:50])
                lotes_finales.append(l)
                
        return lotes_finales
    except Exception as e:
        st.error(f"Error de conexión: {e}")
        return []

# --- INTERFAZ STREAMLIT ---
st.set_page_config(page_title="Amado Libros - Analizador", page_icon="📚", layout="wide")
st.title("🔨 Analizador de Arbitraje: Remotes → ML Uruguay")

with st.sidebar:
    st.header("⚙️ Configuración")
    comision = st.number_input("Comisión Rematador (%)", value=18.0) / 100
    tipo_cambio = st.number_input("Tipo de Cambio (USD/UYU)", value=40.0)
    costo_fijo = st.number_input("Logística por Lote (UYU)", value=200)

url_input = st.text_input("🔗 URL del Remate (ej: remotes.com.uy/participar/remate/5866)")

if st.button("🚀 Analizar Lotes"):
    if url_input:
        with st.spinner("Escaneando lotes y comparando con Mercado Libre..."):
            lotes = extract_remotes_lotes(url_input)
            
            if not lotes:
                st.warning("No se detectaron lotes. Probá con otra URL o revisá si el remate sigue activo.")
            else:
                resultados = []
                progreso = st.progress(0)
                for i, l in enumerate(lotes):
                    query = build_ml_query(l["descripcion"])
                    ml_data = ml_search_uy(query)
                    
                    # Cálculos financieros de Sebastián
                    precio_base_uyu = l["precio_salida_usd"] * tipo_cambio
                    # Estimamos que el precio final sube un 30% en la puja
                    costo_estimado = (precio_base_uyu * 1.3 * (1 + comision)) + costo_fijo
                    
                    mediana_ml = ml_data["median"] if ml_data["median"] else 0
                    margen = mediana_ml - costo_estimado
                    
                    l["Costo Total (UYU)"] = round(costo_estimado)
                    l["Precio ML (UYU)"] = round(mediana_ml)
                    l["Margen Est."] = round(margen)
                    
                    if mediana_ml > (costo_estimado * 1.6):
                        l["Acción"] = "✅ COMPRAR"
                    elif mediana_ml > costo_estimado:
                        l["Acción"] = "🎲 ESPECULAR"
                    else:
                        l["Acción"] = "❌ PASAR"
                    
                    resultados.append(l)
                    progreso.progress((i + 1) / len(lotes))

                df = pd.DataFrame(resultados)
                
                # Mostrar métricas
                c1, c2, c3 = st.columns(3)
                c1.metric("✅ Oportunidades", len(df[df.Acción == "✅ COMPRAR"]))
                c2.metric("🎲 Para Especular", len(df[df.Acción == "🎲 ESPECULAR"]))
                c3.metric("❌ Descartados", len(df[df.Acción == "❌ PASAR"]))

                st.dataframe(df.sort_values("Margen Est.", ascending=False), use_container_width=True)
    else:
        st.info("Por favor, ingresá la URL de un remate activo.")

# ─────────────────────────────────────────────
# SECCIÓN: Calculadora de Envío por ISBN (ARS)
# ─────────────────────────────────────────────
st.divider()
st.header("📦 Calculadora de Envío por ISBN → Pesos Argentinos")

with st.expander("⚙️ Tasas de conversión", expanded=True):
    c1, c2, c3 = st.columns(3)
    tarifa_usd_kg  = c1.number_input("Tarifa envío (USD/kg)", value=15.0, step=0.5)
    tc_usd_uyu     = c2.number_input("USD → UYU", value=40.0, step=1.0)
    tc_uyu_ars     = c3.number_input("UYU → ARS", value=37.0, step=1.0)

st.markdown("**Ingresá los ISBNs y el costo existente en ARS** (uno por línea, separados por coma):")
st.caption("Formato: `ISBN,costo_ars`  —  el costo_ars es opcional")

ejemplo = "9789871603541,14000\n9789875001374,11830\n9786075488240,10800\n9788418450532,18320\n9789875000094,17220\n9789502415802,20930\n9786073170789"
isbn_input = st.text_area("ISBNs", value=ejemplo, height=180)


@st.cache_data(ttl=86400)
def buscar_peso_isbn(isbn: str) -> dict:
    """Busca peso (grs) en Open Library; fallback Google Books."""
    isbn = isbn.strip()

    # 1) Open Library
    try:
        url = f"https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data"
        r = requests.get(url, timeout=8)
        data = r.json()
        libro = data.get(f"ISBN:{isbn}", {})
        titulo = libro.get("title", "")
        peso_raw = libro.get("weight", "")
        if peso_raw:
            nums = re.findall(r"[\d.,]+", str(peso_raw))
            if nums:
                val = float(nums[0].replace(",", "."))
                # Open Library puede reportar en libras o gramos
                if "pound" in str(peso_raw).lower() or "lb" in str(peso_raw).lower():
                    val = round(val * 453.592)
                elif val < 5:  # probablemente kg
                    val = round(val * 1000)
                else:
                    val = round(val)
                return {"isbn": isbn, "titulo": titulo, "peso_grs": val, "fuente": "Open Library"}
    except Exception:
        pass

    # 2) Google Books
    try:
        url = f"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}"
        r = requests.get(url, timeout=8)
        items = r.json().get("items", [])
        if items:
            info = items[0].get("volumeInfo", {})
            titulo = titulo or info.get("title", "")
            # Google Books no tiene campo peso — sólo retornamos título
            return {"isbn": isbn, "titulo": titulo, "peso_grs": None, "fuente": "Google Books (sin peso)"}
    except Exception:
        pass

    return {"isbn": isbn, "titulo": "", "peso_grs": None, "fuente": "No encontrado"}


def calcular_envio_ars(peso_grs, tarifa, tc_usd_uyu, tc_uyu_ars):
    if peso_grs is None or peso_grs <= 0:
        return None
    return round((peso_grs / 1000) * tarifa * tc_usd_uyu * tc_uyu_ars)


if st.button("🔍 Buscar pesos y calcular envío"):
    filas = []
    for linea in isbn_input.strip().splitlines():
        partes = linea.strip().split(",")
        isbn   = partes[0].strip()
        costo_ars = partes[1].strip() if len(partes) > 1 else ""
        if isbn:
            filas.append({"isbn": isbn, "costo_ars_orig": costo_ars})

    if not filas:
        st.warning("No hay ISBNs para procesar.")
    else:
        with st.spinner("Consultando Open Library y Google Books..."):
            resultados = []
            prog = st.progress(0)
            for i, f in enumerate(filas):
                info = buscar_peso_isbn(f["isbn"])
                resultados.append({
                    "ISBN":         info["isbn"],
                    "Título":       info["titulo"] or "—",
                    "Fuente":       info["fuente"],
                    "Peso (grs)":   info["peso_grs"],
                    "Costo orig (ARS)": f["costo_ars_orig"],
                })
                prog.progress((i + 1) / len(filas))

        st.info("✏️ Podés editar los pesos manualmente si la API no los encontró.")
        df_edit = st.data_editor(
            pd.DataFrame(resultados),
            column_config={
                "Peso (grs)": st.column_config.NumberColumn("Peso (grs)", min_value=0, step=1),
            },
            use_container_width=True,
            num_rows="fixed",
            key="tabla_pesos",
        )

        st.subheader("📋 Resultado final")
        salida = []
        for _, row in df_edit.iterrows():
            peso = row["Peso (grs)"]
            envio_ars = calcular_envio_ars(peso, tarifa_usd_kg, tc_usd_uyu, tc_uyu_ars)
            costo_orig = row["Costo orig (ARS)"]

            if envio_ars is not None:
                if costo_orig:
                    fmt = f"arg. {costo_orig} + arg. {envio_ars:,}".replace(",", ".")
                else:
                    fmt = f"arg. {envio_ars:,}".replace(",", ".")
            else:
                fmt = f"arg. {costo_orig} + ⚠️ peso desconocido" if costo_orig else "⚠️ peso desconocido"

            salida.append({
                "ISBN":              row["ISBN"],
                "Título":            row["Título"],
                "Peso (grs)":        f"{int(peso)} grs" if peso else "—",
                "Envío USD":         f"${round((peso/1000)*tarifa_usd_kg, 2):.2f}" if peso else "—",
                "Envío ARS":         f"arg. {envio_ars:,}".replace(",", ".") if envio_ars else "—",
                "Celda final":       fmt,
            })

        df_salida = pd.DataFrame(salida)
        st.dataframe(df_salida, use_container_width=True)

        # Exportar como texto copiable
        st.subheader("📋 Copiar al portapapeles")
        texto_final = "\n".join(df_salida["Celda final"].tolist())
        st.code(texto_final, language=None)
