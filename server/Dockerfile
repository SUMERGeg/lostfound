FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM dependencies AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 8080
CMD ["npm", "run", "dev"]

FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY migrations ./migrations
COPY src ./src
USER node
EXPOSE 8080
CMD ["sh", "-c", "npm run migrate && npm start"]
