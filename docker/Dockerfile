# SHRUTI: API + dashboard in one CPU-only image (also used for the Hugging Face Space).
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=2 HF_HOME=/app/.hf
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.lock pyproject.toml README.md ./
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.lock
COPY src/ src/
COPY configs/ configs/
COPY data/scripts/ data/scripts/
COPY data/bench/originals/ data/bench/originals/
COPY data/demos/ data/demos/
COPY results/benchmark/ results/benchmark/
COPY --from=web /web/dist web/dist
RUN pip install --no-cache-dir -e . --no-deps \
 && python -c "from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor as P; m='facebook/wav2vec2-base-960h'; Wav2Vec2ForCTC.from_pretrained(m); P.from_pretrained(m)"
EXPOSE 8000
CMD ["python", "-m", "shruti", "serve", "--host", "0.0.0.0", "--port", "8000"]
