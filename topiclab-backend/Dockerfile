ARG PYTHON_BASE_IMAGE=docker.m.daocloud.io/library/python:3.11-slim
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
ARG PIP_TRUSTED_HOST=mirrors.aliyun.com
ARG PIP_TIMEOUT=120
ARG PIP_RETRIES=3
FROM ${PYTHON_BASE_IMAGE}
ARG PIP_INDEX_URL
ARG PIP_TRUSTED_HOST
ARG PIP_TIMEOUT
ARG PIP_RETRIES

RUN useradd -m -u 1000 appuser

WORKDIR /app

# 配置 pip 镜像源（可通过 build-arg 覆盖，阿里云超时时可改用 PyPI）
ENV PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST} \
    PIP_DEFAULT_TIMEOUT=${PIP_TIMEOUT} \
    PIP_RETRIES=${PIP_RETRIES}

RUN mkdir -p /root/.pip /home/appuser/.pip && \
    echo "[global]" > /root/.pip/pip.conf && \
    printf "index-url = %s\n" "${PIP_INDEX_URL}" >> /root/.pip/pip.conf && \
    printf "trusted-host = %s\n" "${PIP_TRUSTED_HOST}" >> /root/.pip/pip.conf && \
    printf "timeout = %s\n" "${PIP_TIMEOUT}" >> /root/.pip/pip.conf && \
    printf "retries = %s\n" "${PIP_RETRIES}" >> /root/.pip/pip.conf && \
    cp /root/.pip/pip.conf /home/appuser/.pip/pip.conf

COPY pyproject.toml .
COPY app ./app
COPY main.py .
# 阿里云超时时可重试，或改用 PyPI: --build-arg PIP_INDEX_URL=https://pypi.org/simple/ --build-arg PIP_TRUSTED_HOST=pypi.org
RUN for i in 1 2 3; do \
      pip install --no-cache-dir -e . && exit 0; \
      echo "pip attempt $i failed, retrying in 20s..."; \
      sleep 20; \
    done; \
    exit 1

COPY . .
RUN chown -R appuser:appuser /app /home/appuser/.pip

USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
