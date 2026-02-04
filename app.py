import streamlit as st
import pandas as pd
import requests
from bs4 import BeautifulSoup
import re
import time

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
