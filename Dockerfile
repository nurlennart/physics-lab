FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
# The npm cache survives between image builds; the layer itself is reused while the lockfile is unchanged.
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --no-fund
COPY . .
# Typecheck and tests are the release gate's job (scripts/check.sh, enforced by scripts/deploy.sh).
RUN npx vite build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --start-interval=1s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
