#!/bin/sh
set -e

echo "=================================================="
echo " Starting MinIO Automated Bucket Setup Script"
echo "=================================================="

# Wait for MinIO to become reachable
echo "Waiting for MinIO Server to be ready at minio:9000..."
until mc alias set localminio http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" > /dev/null 2>&1; do
  echo "MinIO is starting up, retrying in 2 seconds..."
  sleep 2
done

echo "Successfully authenticated with MinIO server."

# Create default bucket if it does not exist
BUCKET_NAME=${MINIO_DEFAULT_BUCKET:-app-images}
echo "Ensuring bucket '$BUCKET_NAME' exists..."
mc mb --ignore-existing localminio/"$BUCKET_NAME"

# Set download policy so images are publicly accessible for apps
echo "Configuring public download policy on '$BUCKET_NAME'..."
mc anonymous set download localminio/"$BUCKET_NAME"

echo "=================================================="
echo " MinIO Bucket '$BUCKET_NAME' is READY and PUBLIC!"
echo "=================================================="
