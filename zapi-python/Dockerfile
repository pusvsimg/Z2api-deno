FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DOWNSTREAM_KEY="" \
    UPSTREAM_TOKEN="" \
    ANON_TOKEN_ENABLED="true" \
    THINK_TAGS_MODE="strip" \
    DEBUG_MODE="false"

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
