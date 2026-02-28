FROM node:20-alpine

WORKDIR /app
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./

RUN pnpm install --frozen-lockfile

COPY assets ./assets
COPY discord ./discord
COPY languages ./languages
COPY misc ./misc
COPY valorant ./valorant

COPY SkinPeek.js ./

CMD ["pnpm", "start"]
