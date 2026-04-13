# Stage 1: build frontend
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: build Go binary (always on native builder arch, cross-compile for target)
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS backend
ARG TARGETARCH
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend /app/frontend/dist ./frontend/dist
RUN GOARCH=$TARGETARCH go build -o groceries .

# Stage 3: minimal runtime image
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend /app/groceries .
EXPOSE 8080
CMD ["./groceries", "--db", "/data/groceries.db", "--port", "8080"]
