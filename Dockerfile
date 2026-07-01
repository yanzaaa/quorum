# Deployable image for Alibaba Cloud (ECS / Simple Application Server) or any Docker host.
# Build:  docker build -t quorum .
# Run:    docker run -p 3000:3000 -e DASHSCOPE_API_KEY=sk-... quorum
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "start"]
