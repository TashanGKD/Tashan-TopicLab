ARG NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:20-slim
ARG NGINX_BASE_IMAGE=docker.m.daocloud.io/library/nginx:alpine

FROM ${NODE_BASE_IMAGE} AS builder

WORKDIR /app

ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=$VITE_BASE_PATH

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM ${NGINX_BASE_IMAGE}
COPY --from=builder /app/dist /usr/share/nginx/html
# Use root nginx config when VITE_BASE_PATH is /, else the legacy /topic-lab/ config.
ARG VITE_BASE_PATH=/
ENV WORLDWEAVE_UPSTREAM=http://host.docker.internal:3020
ENV NGINX_ENVSUBST_FILTER=^WORLDWEAVE_UPSTREAM$
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx
COPY nginx.root.conf /tmp/nginx.root.conf.template
COPY nginx.conf /tmp/nginx.conf.template
RUN mkdir -p /etc/nginx/templates && \
    if [ "$VITE_BASE_PATH" = "/" ] || [ -z "$VITE_BASE_PATH" ]; then \
      cp /tmp/nginx.root.conf.template /etc/nginx/templates/nginx.conf.template; \
    else \
      cp /tmp/nginx.conf.template /etc/nginx/templates/nginx.conf.template; \
    fi

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
