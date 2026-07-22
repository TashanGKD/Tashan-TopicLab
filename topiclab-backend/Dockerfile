ARG PYTHON_BASE_IMAGE=docker.m.daocloud.io/library/python:3.11-slim
ARG NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:20-slim
ARG APT_MIRROR=http://mirrors.aliyun.com/debian
ARG APT_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
ARG PIP_TRUSTED_HOST=mirrors.aliyun.com
ARG PIP_TIMEOUT=120
ARG PIP_RETRIES=3
FROM ${NODE_BASE_IMAGE} AS node-runtime
FROM ${PYTHON_BASE_IMAGE}
ARG APT_MIRROR
ARG APT_SECURITY_MIRROR
ARG PIP_INDEX_URL
ARG PIP_TRUSTED_HOST
ARG PIP_TIMEOUT
ARG PIP_RETRIES

RUN useradd -m -u 1000 appuser

# Debian's npm package expands to hundreds of small downloads. Reuse the
# configured Node image and keep APT limited to the Git runtime required by
# Critic.
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx && \
    node --version && npm --version

RUN for source_file in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
      [ ! -f "$source_file" ] || sed -i \
        -e "s|https\?://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
        -e "s|https\?://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
        -e "s|https\?://deb.debian.org/debian|${APT_MIRROR}|g" \
        "$source_file"; \
    done && \
    printf '%s\n' \
      'Acquire::Retries "5";' \
      'Acquire::http::Pipeline-Depth "0";' \
      'Acquire::http::Timeout "30";' \
      'Acquire::https::Timeout "30";' \
      > /etc/apt/apt.conf.d/80-topiclab-mirror && \
    apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/80-topiclab-mirror

WORKDIR /app

# 配置国内 pip 镜像源（可通过 build-arg 覆盖）
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
RUN for i in 1 2 3; do \
      pip install --no-cache-dir -e . && exit 0; \
      echo "pip attempt $i failed, retrying in 20s..."; \
      sleep 20; \
    done; \
    exit 1

COPY . .
RUN mkdir -p /app/critic-state && \
    chown -R appuser:appuser /app /home/appuser/.pip

USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
