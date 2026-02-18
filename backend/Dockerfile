FROM python:3.11-slim

# 创建非 root 用户
RUN useradd -m -u 1000 appuser

WORKDIR /app

# 配置 pip 使用阿里云镜像源，加速下载
RUN mkdir -p /home/appuser/.pip && \
    echo "[global]" > /home/appuser/.pip/pip.conf && \
    echo "index-url = https://mirrors.aliyun.com/pypi/simple/" >> /home/appuser/.pip/pip.conf && \
    echo "trusted-host = mirrors.aliyun.com" >> /home/appuser/.pip/pip.conf && \
    echo "timeout = 300" >> /home/appuser/.pip/pip.conf && \
    echo "retries = 10" >> /home/appuser/.pip/pip.conf

# 复制代码并修改所有权
COPY . .
RUN chown -R appuser:appuser /app /home/appuser/.pip

# 切换到非 root 用户
USER appuser

# 添加用户本地 bin 目录到 PATH
ENV PATH="/home/appuser/.local/bin:$PATH"

# 安装依赖（使用阿里云镜像源）
RUN pip install --no-cache-dir -e .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
