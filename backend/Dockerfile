# Backend: FastAPI + uvicorn
ARG PYTHON_IMAGE=python:3.13-slim
FROM ${PYTHON_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Pillow 在 python:3.13-slim 上有预编译 wheel，不需要额外系统库
# 先装依赖（利用 layer 缓存）
COPY requirements.txt ./
RUN pip install -r requirements.txt

# 再拷代码
COPY . .

EXPOSE 8000

# data 目录在 compose 里挂卷进来；schema 在 lifespan 启动时 apply
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--timeout-graceful-shutdown", "5"]
