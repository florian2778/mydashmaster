FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY src ./src
COPY views ./views
COPY public ./public
COPY data ./data

RUN mkdir -p /app/data/layouts /app/data/devices /app/data/device-auth /app/data/users \
  && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "start"]
