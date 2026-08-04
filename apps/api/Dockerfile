# Imagen de desarrollo de la API (fase 0). Las imagenes multi-stage
# optimizadas y multi-arch llegan con el CI de fase 1 (docs/plan/11 §6).
FROM node:22-alpine

RUN npm install -g pnpm@10.34.5

WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@pymes/api... run build

# Debe coincidir con API_PORT (.env.local); bloque de puertos del ADR 0001.
EXPOSE 4301
CMD ["node", "apps/api/dist/main.js"]
