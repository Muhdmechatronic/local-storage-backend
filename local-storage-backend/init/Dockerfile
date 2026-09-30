FROM golang:1.24-alpine AS builder
RUN go install github.com/minio/mc@latest

FROM alpine:3.20
RUN apk add --no-cache ca-certificates bash curl
COPY --from=builder /go/bin/mc /usr/bin/mc
COPY init.sh /usr/bin/init.sh
RUN sed -i 's/\r$//' /usr/bin/init.sh && chmod +x /usr/bin/init.sh /usr/bin/mc

ENTRYPOINT ["/usr/bin/init.sh"]
