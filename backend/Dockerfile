# ============================================================
# SINAPSIS API — Dockerfile de producción (Railway)
# ============================================================

FROM mcr.microsoft.com/playwright/python:v1.40.0-jammy

WORKDIR /app

# Dependencias del sistema para psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

# Dependencias Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Navegador Chromium para Playwright
RUN playwright install chromium

# Código de la aplicación
COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]