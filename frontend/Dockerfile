ARG NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:20-slim
ARG NGINX_BASE_IMAGE=docker.m.daocloud.io/library/nginx:alpine

FROM ${NODE_BASE_IMAGE} AS builder

WORKDIR /app

ARG VITE_BASE_PATH=/topic-lab/
ENV VITE_BASE_PATH=$VITE_BASE_PATH

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM ${NGINX_BASE_IMAGE}
COPY --from=builder /app/dist /usr/share/nginx/html
# Use root nginx config when VITE_BASE_PATH is / (for world.tashan.chat), else /topic-lab/
ARG VITE_BASE_PATH=/topic-lab/
COPY nginx.root.conf /tmp/nginx.root.conf
COPY nginx.conf /tmp/nginx.conf
RUN if [ "$VITE_BASE_PATH" = "/" ] || [ -z "$VITE_BASE_PATH" ]; then \
      cp /tmp/nginx.root.conf /etc/nginx/nginx.conf; \
    else \
      cp /tmp/nginx.conf /etc/nginx/nginx.conf; \
    fi

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
