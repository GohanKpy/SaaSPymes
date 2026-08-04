# Imagen de desarrollo del worker (fase 0). Las imagenes multi-stage
# optimizadas y multi-arch llegan con el CI de fase 1 (docs/plan/11 §6).
FROM node:22-alpine

RUN npm install -g pnpm@10.34.5

WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@pymes/worker... run build

CMD ["node", "apps/worker/dist/main.js"]
