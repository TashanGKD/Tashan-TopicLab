ARG PYTHON_BASE_IMAGE=docker.m.daocloud.io/library/python:3.11-slim
FROM ${PYTHON_BASE_IMAGE}

RUN useradd -m -u 1000 appuser

WORKDIR /app

# 配置 pip 使用阿里云镜像源（root + appuser，都能生效）
ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
    PIP_TRUSTED_HOST=mirrors.aliyun.com \
    PIP_DEFAULT_TIMEOUT=300 \
    PIP_RETRIES=10

RUN mkdir -p /root/.pip /home/appuser/.pip && \
    echo "[global]" > /root/.pip/pip.conf && \
    echo "index-url = https://mirrors.aliyun.com/pypi/simple/" >> /root/.pip/pip.conf && \
    echo "trusted-host = mirrors.aliyun.com" >> /root/.pip/pip.conf && \
    echo "timeout = 300" >> /root/.pip/pip.conf && \
    echo "retries = 10" >> /root/.pip/pip.conf && \
    cp /root/.pip/pip.conf /home/appuser/.pip/pip.conf

COPY pyproject.toml .
COPY app ./app
COPY main.py .
RUN pip install --no-cache-dir -e .

COPY . .
RUN chown -R appuser:appuser /app /home/appuser/.pip

USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
