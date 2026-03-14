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
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
