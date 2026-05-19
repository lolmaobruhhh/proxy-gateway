FROM node:20-slim

RUN useradd -m -u 1000 appuser

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /data && chown -R appuser:appuser /data /app

USER appuser

EXPOSE 7860

ENV PORT=7860
ENV DATA_DIR=/data
ENV DELETE_PASSWORD=changeme

CMD ["node", "server.js"]
