# Use node version 22 as our base image
FROM node:22

# Goes to the app directory (think of it like a cd terminal command)
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install app dependencies
# RUN npm ci
RUN npm ci --no-audit --no-fund

# Copy the rest of our app into the container
COPY . .

# Compile TypeScript into JavaScript
RUN npm run build

# Run the app
CMD ["npm", "run", "start:lis"]




