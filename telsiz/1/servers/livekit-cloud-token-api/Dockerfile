FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
USER node
CMD ["npm", "start"]
