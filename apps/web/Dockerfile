# Imagen de desarrollo del frontend (fase 0). Las imagenes multi-stage
# optimizadas (output standalone) llegan con el CI de fase 1.
FROM node:22-alpine

RUN npm install -g pnpm@10.34.5

WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@pymes/web... run build

# Debe coincidir con PORT (.env.local); bloque de puertos del ADR 0001.
EXPOSE 4300
CMD ["pnpm", "--filter=@pymes/web", "start"]
