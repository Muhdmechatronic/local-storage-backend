FROM golang:1.24-alpine AS builder
RUN apk add --no-cache git
RUN go install github.com/minio/minio@latest

FROM alpine:3.20
RUN apk add --no-cache ca-certificates curl bash
COPY --from=builder /go/bin/minio /usr/bin/minio
RUN chmod +x /usr/bin/minio

EXPOSE 9000 9001
VOLUME ["/data"]

ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
