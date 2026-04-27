FROM mcr.microsoft.com/playwright:v1.51.1-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

ENTRYPOINT ["node", "src/cli.js"]
CMD ["check", "--config", "config.yaml"]
