# Use an official Node.js runtime as a parent image
FROM node:18-alpine As builder

WORKDIR /app

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install app dependencies
# Using npm ci for faster, more reliable installs in CI/CD environments
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Create necessary directories and set permissions if needed
# These are created by server.js on startup, but good to declare volumes or create them here too.
RUN mkdir -p uploads generated logs && \
    chown -R node:node uploads generated logs

# Expose the port the app runs on
EXPOSE 3000

# Specify the user to run the application
USER node

# Define the command to run your app
CMD ["npm", "start"]