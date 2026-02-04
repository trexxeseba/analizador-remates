import streamlit as st
import pandas as pd
import requests
from bs4 import BeautifulSoup
import re
import time
from datetime import datetime
from functools import lru_cache

# --- FUNCIONES DE APOYO (SCRAPING & API) ---

def build_ml_query(desc):
    """Limpia la descripción del remate para buscar en ML UY"""
    if not desc: return ""
    # Quita la palabra 'Lote' y números al inicio, limpia caracteres raros
    query = re.sub(r'(?i)Lote\s*\d+', '', desc)
    query = re.sub(r'[^\w\s]', ' ', query)
    return " ".join(query.split()[:6]) # Toma las primeras 6 palabras clave

@st.cache_data(ttl=3600)
def ml_search_uy_cached(query, limit=50):
    """Busca en la API de Mercado Libre Uruguay"""
    if not query: return []
    url = f"https://api.mercadolibre.com/sites/MLU/search?q={query.replace(' ', '%20')}&limit={limit}"
    try:
        resp = requests.get(url, timeout=10)
        return resp.json().get("results", [])
    except:
        return []

def summarize_ml(results):
    """Calcula precios promedio y medianos de ML"""
    if not results:
        return {"total": 0, "median": None, "min": None}
    prices = sorted([r["price"] for r in results if r.get("price")])
    if not prices:
        return {"total": 0, "median": None, "min": None}
    
    return {
        "total": len(prices),
        "median": prices[len(prices)//2],
        "min": prices[0],
        "max": prices[-1]
    }

def extract_remotes_lotes(url):
    """Scraping de Remotes.com.uy"""
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        r = requests.get(url, headers=headers, timeout=15)
        soup = BeautifulSoup(r.text, 'lxml')
        
        lotes_data = []
        # Buscador de elementos de lote (ajustar según el selector real de Remotes)
        items = soup.find_all("div", class_="lote-item") or soup.select(".card-lote")
        
        for i, item in enumerate(items):
            desc = item.get_text(separator=" ").strip()
            precio_texto = re.search(r'USD\s*(\d+)', desc)
            precio = float(precio_texto.group(1)) if precio_texto else 10.0
            
            lotes_data.append({
                "lote": i + 1,
                "descripcion": desc[:200],
                "precio_salida": precio
            })
        return {"lotes": lotes_data}
    except Exception as e:
        return {"error": str(e), "lotes": []}

def score_lote(lote, comision=0.20, logistica_fija=200):
    """Lógica de decisión para Sebastián (Amado Libros)"""
    salida = float(lote.get("precio_salida", 0))
    # Estimamos que el precio sube un 40% en la puja
    martillo_est = salida * 1.40 
    costo_total = (martillo_est * (1 + comision)) + logistica_fija
    
    ml = lote.get("ml", {})
    mediana_ml = ml.get("median")
    
    res = {
        "lote": lote.get("lote"),
        "descripcion": lote.get("descripcion"),
        "precio_salida": salida,
        "costo_total": round(costo_total, 2),
        "precio_venta_probable": mediana_ml,
        "recomendacion": "PASAR",
        "margen_pct": 0,
        "razon": ""
    }

    if not mediana_ml:
        res["recomendacion"] = "ESPECULAR"
        res["razon"] = "Sin datos en ML para comparar"
        return res

    margen = mediana_ml - costo_total
    res["margen_pct"] = round((margen / costo_total) * 100, 1)

    if res["margen_pct"] > 40:
        res["recomendacion"] = "COMPRAR"
        res["razon"] = f"Margen excelente ({res['margen_pct']}%)"
    elif res["margen_pct"] > 15:
        res["recomendacion"] = "ESPECULAR"
        res["razon"] = "Margen ajustado"
    else:
        res["razon"] = "Margen insuficiente o negativo"
    
    return res

# --- INTERFAZ STREAMLIT ---

st.set_page_config(page_title="Analizador Amado Libros", page_icon="📚", layout="wide")
st.title("🔨 Analizador de Remates → ML Uruguay")

with st.sidebar:
    st.header("⚙️ Ajustes de Costos")
    comision = st.number_input("Comisión Rematador (%)", value=20.0) / 100
    logistica = st.number_input("Costo Logística (UYU)", value=200)

remate_url = st.text_input("🔗 URL del Remate en Remotes.com.uy")

if st.button("🚀 Iniciar Análisis", type="primary"):
    if not remate_url:
        st.error("Por favor, pegá una URL.")
    else:
        with st.spinner("Buscando lotes y comparando con Mercado Libre..."):
            data = extract_remotes_lotes(remate_url)
            
            if data.get("lotes"):
                enriquecidos = []
                for l in data["lotes"]:
                    query = build_ml_query(l["descripcion"])
                    ml_raw = ml_search_uy_cached(query)
                    l["ml"] = summarize_ml(ml_raw)
                    enriquecidos.append(score_lote(l, comision, logistica))
                
                df = pd.DataFrame(enriquecidos)
                
                # Resumen visual
                c1, c2, c3 = st.columns(3)
                c1.metric("✅ COMPRAR", len(df[df.recomendacion == "COMPRAR"]))
                c2.metric("🎲 ESPECULAR", len(df[df.recomendacion == "ESPECULAR"]))
                c3.metric("❌ PASAR", len(df[df.recomendacion == "PASAR"]))
                
                st.dataframe(df.sort_values("margen_pct", ascending=False), use_container_width=True)
                
                # Botón de descarga
                csv = df.to_csv(index=False).encode('utf-8')
                st.download_button("📥 Descargar Excel (CSV)", csv, "analisis.csv", "text/csv")
            else:
                st.warning("No se encontraron lotes. Verificá la URL.")