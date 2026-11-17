# 외부 패키지가 없는 Node 서버라 설치 · 빌드 단계 없이 단일 스테이지로 만든다.
FROM node:24-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV TZ=Asia/Seoul
COPY --chown=node:node . .
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
