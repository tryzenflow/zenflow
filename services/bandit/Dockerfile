# Zenflow bandit service — FastAPI + LinUCB, called over internal HTTP by the API.
FROM python:3.12-slim

RUN pip install --no-cache-dir uv

WORKDIR /app

# Deps first for layer caching. The project itself is not packaged
# (no [build-system]); uv installs only the third-party deps.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --no-dev --frozen --no-install-project

COPY src ./src

EXPOSE 8000

CMD ["uv", "run", "--no-dev", "uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8000"]
