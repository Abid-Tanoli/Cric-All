FROM node:22-alpine AS build

WORKDIR /workspace/User

COPY User/package*.json ./
RUN npm ci

COPY User ./
COPY Shared ../Shared

ARG VITE_API_URL
ARG VITE_SOCKET_URL
ARG VITE_GOOGLE_CLIENT_ID
# Navigation feature flags (src/config/features.js). Each is opt-in/opt-out per
# that module's contract, so an unset flag here simply falls through to the
# default the frontend already uses. They are forwarded as build args so a
# docker-compose env var can hide or restore a nav section without a deploy.
ARG VITE_SHOW_INTERNATIONAL
ARG VITE_SHOW_HIGHLIGHTS
ARG VITE_SHOW_CRICKET_NEWS
ARG VITE_SHOW_VIDEOS
ARG VITE_SHOW_RANKINGS
ARG VITE_SHOW_COMPARISON
ARG VITE_SHOW_BLOGS
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_SHOW_INTERNATIONAL=$VITE_SHOW_INTERNATIONAL
ENV VITE_SHOW_HIGHLIGHTS=$VITE_SHOW_HIGHLIGHTS
ENV VITE_SHOW_CRICKET_NEWS=$VITE_SHOW_CRICKET_NEWS
ENV VITE_SHOW_VIDEOS=$VITE_SHOW_VIDEOS
ENV VITE_SHOW_RANKINGS=$VITE_SHOW_RANKINGS
ENV VITE_SHOW_COMPARISON=$VITE_SHOW_COMPARISON
ENV VITE_SHOW_BLOGS=$VITE_SHOW_BLOGS

RUN npm run build && test -s dist/index.html

FROM node:22-alpine AS production

RUN npm install --global serve@14.2.4

WORKDIR /app
COPY --from=build /workspace/User/dist ./dist
RUN test -s dist/index.html

ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "serve -s dist -l tcp://0.0.0.0:${PORT:-3000}"]
