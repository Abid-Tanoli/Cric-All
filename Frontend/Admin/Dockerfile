FROM node:22-alpine AS build

WORKDIR /workspace/Admin

COPY Admin/package*.json ./
RUN npm ci

COPY Admin ./
COPY Shared ../Shared

ARG VITE_API_URL
ARG VITE_SOCKET_URL
# Admin nav feature flags (src/config/features.js). Each is opt-in, so an unset
# flag here falls through to the frontend default (both sections hidden). They
# are forwarded as build args so a compose env var can reveal them without a
# code change.
ARG VITE_SHOW_ADMIN_INTERNATIONAL
ARG VITE_SHOW_ADMIN_HANDLER_REQUESTS
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
ENV VITE_SHOW_ADMIN_INTERNATIONAL=$VITE_SHOW_ADMIN_INTERNATIONAL
ENV VITE_SHOW_ADMIN_HANDLER_REQUESTS=$VITE_SHOW_ADMIN_HANDLER_REQUESTS

RUN npm run build && test -s dist/index.html

FROM node:22-alpine AS production

RUN npm install --global serve@14.2.4

WORKDIR /app
COPY --from=build /workspace/Admin/dist/ ./dist/
RUN test -s dist/index.html

ENV PORT=3001
EXPOSE 3001

CMD ["sh", "-c", "serve -s dist -l tcp://0.0.0.0:${PORT:-3001}"]
